/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Obstacle, ObstacleType, SafeZone, PlayerState } from '../types';
import { Play, RotateCcw, Shield, Trophy, Zap, AlertTriangle, Info, Volume2, ShieldAlert } from 'lucide-react';
import { audio } from '../utils/audio';

interface GameCanvasProps {
  safeZones: SafeZone[];
  isPoseJumping: boolean;
  isPoseSquatting: boolean;
  playerX: number; // 0-100 position from pose tracker
  isPlaying: boolean;
  onGameOver: (finalScore: number) => void;
  onStartGame: () => void;
}

interface Particle3D {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
}

export default function GameCanvas({
  safeZones,
  isPoseJumping,
  isPoseSquatting,
  playerX,
  isPlaying,
  onGameOver,
  onStartGame
}: GameCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const requestRef = useRef<number | null>(null);
  const previousTimeRef = useRef<number | null>(null);

  // Core Game State Refs to avoid re-binds interrupting the drawing loop
  const stateRef = useRef<PlayerState>({
    score: 0,
    highScore: Number(localStorage.getItem('floor_lava_hs') || '500'),
    lives: 3,
    combo: 1,
    timeElapsed: 0,
    chestHeight: 60, // default standing height percentage
    isJumping: false,
    isSquatting: false,
    isInsideSafeZone: false,
    lastAction: null,
    activityStrength: 10
  });

  const [uiState, setUiState] = useState({
    score: 0,
    highScore: Number(localStorage.getItem('floor_lava_hs') || '500'),
    lives: 3,
    combo: 1,
    timeElapsed: 0,
    isSafe: false,
  });

  const obstaclesRef = useRef<Obstacle[]>([]);
  const lastSpawnTimeRef = useRef<number>(0);
  const lavaLevelRef = useRef<number>(98); // Starts lower down at 98% to provide solid ground at first
  const isProtectedRef = useRef<boolean>(false);
  const gracePeriodRef = useRef<number>(0); // 4 seconds invulnerability at start!

  // React state for HUD rendering
  const [graceCountdown, setGraceCountdown] = useState<number>(0);

  // Sync inputs to Game loops via refs
  const inputsRef = useRef({
    isJumping: false,
    isSquatting: false,
    playerX: 50
  });

  // Track state change of safe zone entry to play arpeggio chime exactly once
  const wasSafeRef = useRef<boolean>(false);

  useEffect(() => {
    inputsRef.current = {
      isJumping: isPoseJumping,
      isSquatting: isPoseSquatting,
      playerX: playerX
    };
  }, [isPoseJumping, isPoseSquatting, playerX]);

  // Restart trigger
  const handleStart = () => {
    // Locate center coordinate of first SafeZone sofa
    const startX = safeZones.length > 0 ? Math.round(safeZones[0].x + safeZones[0].width / 2) : 50;

    // Reset parameters
    stateRef.current = {
      score: 0,
      highScore: Number(localStorage.getItem('floor_lava_hs') || '500'),
      lives: 3,
      combo: 1,
      timeElapsed: 0,
      chestHeight: safeZones.length > 0 ? safeZones[0].y : 82, // start standing on couch
      isJumping: false,
      isSquatting: false,
      isInsideSafeZone: true,
      lastAction: null,
      activityStrength: 10
    };

    setUiState({
      score: 0,
      highScore: stateRef.current.highScore,
      lives: 3,
      combo: 1,
      timeElapsed: 0,
      isSafe: true
    });

    obstaclesRef.current = [];
    lastSpawnTimeRef.current = Date.now();
    lavaLevelRef.current = 98; // Very deep lava floor level on launch
    gracePeriodRef.current = 4.0; // 4 seconds of absolute invulnerability!
    wasSafeRef.current = true;

    // Initialize position directly centered on available couch to survive
    inputsRef.current = {
      isJumping: false,
      isSquatting: false,
      playerX: startX
    };

    // Clean Three.js dynamic meshes
    if (threeRef.current) {
      const { scene, obstacleMeshes, zoneMeshes } = threeRef.current;
      // Wipe old obstacles
      Object.keys(obstacleMeshes).forEach(id => {
        scene.remove(obstacleMeshes[id]);
        disposeHierarchy(obstacleMeshes[id]);
        delete obstacleMeshes[id];
      });
    }

    onStartGame();
  };

  // Helper helper to dispose geometries/materials in Three.js
  const disposeHierarchy = (obj: THREE.Object3D) => {
    obj.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      }
    });
  };

  // Three.js References Store
  const threeRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    playerGroup: THREE.Group;
    jetFlame: THREE.Mesh;
    lavaMesh: THREE.Mesh;
    ambientLight: THREE.AmbientLight;
    dirLight: THREE.DirectionalLight;
    pointLight: THREE.PointLight;
    zoneMeshes: { [id: string]: THREE.Group };
    obstacleMeshes: { [id: string]: THREE.Group };
    particles: Particle3D[];
    playerLeftLeg: THREE.Object3D;
    playerRightLeg: THREE.Object3D;
    playerLeftArm: THREE.Object3D;
    playerRightArm: THREE.Object3D;
    clock: THREE.Clock;
    isThreeReady: boolean;
  } | null>(null);

  // Set visual interpolation states for smooth transitions
  const playerVisualPositionX = useRef<number>(0);
  const playerVisualJumpY = useRef<number>(0);
  const playerVisualSquatScale = useRef<number>(1.0);
  const rotationClock = useRef<number>(0);
  const prevXRef = useRef<number>(50);

  // 3D Engine Initialization Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      // 1. Initialize Scene and Camera
      const scene = new THREE.Scene();
      scene.background = null; // transparent outer, rendered over canvas background gradient
      
      const camera = new THREE.PerspectiveCamera(45, 800 / 450, 0.1, 100);
      camera.position.set(0, 3, 22);
      camera.lookAt(0, -0.5, 0);

      // 2. Initialize Renderer
      const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance'
      });
      renderer.setSize(800, 450);
      renderer.shadowMap.enabled = true;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

      // 3. Ambient and Spot Lighting
      const ambientLight = new THREE.AmbientLight(0x1e2230, 1.4);
      scene.add(ambientLight);

      const dirLight = new THREE.DirectionalLight(0xfff0dd, 2.5);
      dirLight.position.set(5, 15, 10);
      dirLight.castShadow = true;
      scene.add(dirLight);

      // Heat glow point light rising from lava bottom floor
      const pointLight = new THREE.PointLight(0xff4500, 4.0, 30);
      pointLight.position.set(0, -4, 0);
      scene.add(pointLight);

      // 4. Room environment details
      // Back Wallpaper Grid plane
      const wallGeom = new THREE.PlaneGeometry(50, 20);
      const wallMat = new THREE.MeshStandardMaterial({
        color: 0x070c17,
        roughness: 0.95,
        metalness: 0.1
      });
      const wallMesh = new THREE.Mesh(wallGeom, wallMat);
      wallMesh.position.set(0, 5, -8);
      scene.add(wallMesh);

      // Cute structural neon line along the horizon
      const gridHelper = new THREE.GridHelper(40, 40, 0x1e293b, 0x0f172a);
      gridHelper.position.set(0, -2, 0);
      scene.add(gridHelper);

      // 5. Liquid Magma Lava Plane
      const lavaGeom = new THREE.PlaneGeometry(60, 40, 24, 24);
      lavaGeom.rotateX(-Math.PI / 2);
      const lavaMat = new THREE.MeshStandardMaterial({
        color: 0xff4500,
        emissive: 0xff2200,
        roughness: 0.2,
        metalness: 0.8,
        flatShading: true
      });
      const lavaMesh = new THREE.Mesh(lavaGeom, lavaMat);
      // Positioned low under the floor helper initially
      lavaMesh.position.set(0, -5, 0);
      scene.add(lavaMesh);

      // 6. Styled Cyber Robot / Astronaut Character construction
      const playerGroup = new THREE.Group();

      // Torso Box
      const torsoGeom = new THREE.BoxGeometry(1.2, 1.6, 1.0);
      const metalMaterial = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.1, metalness: 0.7 });
      const blueNeonMat = new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x22d3ee, roughness: 0.01 });
      const redNeonMat = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xef4444, roughness: 0.01 });

      const torso = new THREE.Mesh(torsoGeom, metalMaterial);
      torso.position.y = 1.0;
      torso.castShadow = true;
      playerGroup.add(torso);

      // Shiny Android Visor / Head Sphere
      const headGeom = new THREE.SphereGeometry(0.55, 16, 16);
      const headJoint = new THREE.Group();
      headJoint.position.set(0, 2.15, 0);
      
      const helmet = new THREE.Mesh(headGeom, metalMaterial);
      const visorGeom = new THREE.BoxGeometry(0.7, 0.35, 0.4);
      const visor = new THREE.Mesh(visorGeom, blueNeonMat);
      visor.position.set(0, 0.1, 0.4);
      
      headJoint.add(helmet);
      headJoint.add(visor);
      playerGroup.add(headJoint);

      // Futuristic Jetpack on back
      const jetpackGeom = new THREE.BoxGeometry(0.8, 1.1, 0.5);
      const jetpack = new THREE.Mesh(jetpackGeom, new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.3 }));
      jetpack.position.set(0, 0.9, -0.6);
      playerGroup.add(jetpack);

      // Cylinder Glowing Jet flame (scaled up during visual airborne states)
      const flameGeom = new THREE.ConeGeometry(0.2, 0.9, 8);
      const flameMat = new THREE.MeshBasicMaterial({ color: 0xffad22 });
      const jetFlame = new THREE.Mesh(flameGeom, flameMat);
      jetFlame.position.set(0, 0.1, -0.6);
      jetFlame.rotateX(Math.PI);
      jetFlame.scale.set(0.1, 0.1, 0.1); // hidden on start
      playerGroup.add(jetFlame);

      // Limbs: Modular Legs
      const limbGeom = new THREE.BoxGeometry(0.38, 0.9, 0.38);
      
      const leftLegAnchor = new THREE.Group();
      leftLegAnchor.position.set(-0.4, 0.25, 0);
      const leftLeg = new THREE.Mesh(limbGeom, metalMaterial);
      leftLeg.position.y = -0.45;
      leftLegAnchor.add(leftLeg);
      playerGroup.add(leftLegAnchor);

      const rightLegAnchor = new THREE.Group();
      rightLegAnchor.position.set(0.4, 0.25, 0);
      const rightLeg = new THREE.Mesh(limbGeom, metalMaterial);
      rightLeg.position.y = -0.45;
      rightLegAnchor.add(rightLeg);
      playerGroup.add(rightLegAnchor);

      // Limbs: Modular Arms
      const leftArmAnchor = new THREE.Group();
      leftArmAnchor.position.set(-0.75, 1.5, 0);
      const leftArm = new THREE.Mesh(limbGeom, metalMaterial);
      leftArm.position.y = -0.45;
      leftArmAnchor.add(leftArm);
      playerGroup.add(leftArmAnchor);

      const rightArmAnchor = new THREE.Group();
      rightArmAnchor.position.set(0.75, 1.5, 0);
      const rightArm = new THREE.Mesh(limbGeom, metalMaterial);
      rightArm.position.y = -0.45;
      rightArmAnchor.add(rightArm);
      playerGroup.add(rightArmAnchor);

      scene.add(playerGroup);

      // Write parameters
      threeRef.current = {
        scene,
        camera,
        renderer,
        playerGroup,
        jetFlame,
        lavaMesh,
        ambientLight,
        dirLight,
        pointLight,
        zoneMeshes: {},
        obstacleMeshes: {},
        particles: [],
        playerLeftLeg: leftLegAnchor,
        playerRightLeg: rightLegAnchor,
        playerLeftArm: leftArmAnchor,
        playerRightArm: rightArmAnchor,
        clock: new THREE.Clock(),
        isThreeReady: true
      };

    } catch (e) {
      console.warn("WebGL initialization failed, falling back to 2D view Mode.", e);
    }

    return () => {
      if (threeRef.current) {
        const { renderer, scene } = threeRef.current;
        renderer.dispose();
        scene.traverse((obj) => disposeHierarchy(obj));
        threeRef.current = null;
      }
    };
  }, []);

  // Main Canvas Tick Loop
  const gameLoop = (timestamp: number) => {
    if (!isPlaying) return; // Stop scheduling if not playing

    if (!previousTimeRef.current) {
      previousTimeRef.current = timestamp;
    }
    const dt = Math.min(0.05, (timestamp - previousTimeRef.current) / 1000);
    previousTimeRef.current = timestamp;

    updateGamePhysics(dt);
    renderGameGraphics(dt);

    requestRef.current = requestAnimationFrame(gameLoop);
  };

  useEffect(() => {
    if (!isPlaying) {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
        requestRef.current = null;
      }
      return;
    }
    requestRef.current = requestAnimationFrame(gameLoop);
    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
        requestRef.current = null;
      }
    };
  }, [isPlaying, safeZones]);

  // Compute boundaries, interactions, actions
  const updateGamePhysics = (dt: number) => {
    const state = stateRef.current;
    
    // 1. Tick elapsed time
    state.timeElapsed += dt;

    // 2. Slow rising base dangerous line
    // Standard scale: reaches max tide level of 42% height across 150s
    // Starts at 98%, making the ground completely safe for the first few moments, then rises!
    const maxTideLevel = 42; 
    const currentBaseLavaWatermark = Math.max(maxTideLevel, 98 - (state.timeElapsed * 0.45));
    lavaLevelRef.current = currentBaseLavaWatermark;

    // 3. Invulnerability grace decrement
    if (gracePeriodRef.current > 0) {
      gracePeriodRef.current -= dt;
      setGraceCountdown(Math.ceil(gracePeriodRef.current));
    } else {
      if (graceCountdown > 0) setGraceCountdown(0);
    }

    // 4. User position translation & Safe Zone evaluations
    const px = inputsRef.current.playerX;
    
    // Is user standing on any mapped platform?
    let currentOccupiedZone: SafeZone | null = null;
    for (const zone of safeZones) {
      const zoneStart = zone.x;
      const zoneEnd = zone.x + zone.width;
      if (px >= zoneStart && px <= zoneEnd) {
        currentOccupiedZone = zone;
        break;
      }
    }

    state.isInsideSafeZone = !!currentOccupiedZone;
    isProtectedRef.current = state.isInsideSafeZone;

    // Play SafeZone enter chime exactly once
    if (state.isInsideSafeZone && !wasSafeRef.current) {
      audio.playSafeZoneEnter();
      wasSafeRef.current = true;
    } else if (!state.isInsideSafeZone && wasSafeRef.current) {
      wasSafeRef.current = false;
    }

    // Calculate avatar elevation Y. Standing on platform elevates above lava floor!
    let avatarTargetTopY = 82; // default ground level
    if (currentOccupiedZone) {
      // Elevate corresponding to the height of the safe couch platform
      avatarTargetTopY = currentOccupiedZone.y;
    }

    // Adjust standing line dynamically
    state.chestHeight = avatarTargetTopY;

    state.isJumping = inputsRef.current.isJumping;
    state.isSquatting = inputsRef.current.isSquatting;

    // 5. Score ticking per frame
    let scoreMultiplier = state.combo;
    if (state.isInsideSafeZone) {
      // Gain survival score bonus on couch
      state.score += Math.round(18 * dt * scoreMultiplier);
    } else {
      // On floor, score increments
      state.score += Math.round(5 * dt * scoreMultiplier);
    }

    if (state.score > state.highScore) {
      state.highScore = state.score;
      localStorage.setItem('floor_lava_hs', String(state.score));
    }

    // 6. Obstacle spawners
    // Obstacle frequency starts slow and scales up
    const spawnRate = Math.max(1.5, 3.5 - (state.timeElapsed * 0.03));
    const speedScale = 1.0 + (state.timeElapsed * 0.015);

    if (Date.now() - lastSpawnTimeRef.current > spawnRate * 1000) {
      // Ensure we don't spawn obstacles in the first 2 seconds of grace
      if (state.timeElapsed > 3.0) {
        spawnNewObstacle(speedScale);
        lastSpawnTimeRef.current = Date.now();
      }
    }

    // Update Obstacles sweep
    const activeObstacles = obstaclesRef.current;
    for (let i = activeObstacles.length - 1; i >= 0; i--) {
      const obstacle = activeObstacles[i];
      obstacle.x -= obstacle.speed * dt * 100; // translate speed percentage

      // Collision evaluation bounds
      const obstacleLeft = 100 - obstacle.x - obstacle.width;
      const obstacleRight = 100 - obstacle.x;
      const hoverMargin = 5.0; // horizontal hit frame tolerance

      const isAlignedHorizontally = (px + hoverMargin >= obstacleLeft) && (px - hoverMargin <= obstacleRight);

      if (isAlignedHorizontally && !obstacle.passed) {
        let isHit = false;

        // Player is immune if grace period is active
        if (gracePeriodRef.current <= 0) {
          if (obstacle.type === 'LOW_WALL') {
            if (!state.isJumping) {
              isHit = true;
            }
          } else if (obstacle.type === 'HIGH_BEAM') {
            if (!state.isSquatting) {
              isHit = true;
            }
          } else if (obstacle.type === 'VOLCANIC_ROCK') {
            if (!state.isJumping && !state.isInsideSafeZone) {
              isHit = true;
            }
          }
        }

        if (isHit) {
          obstacle.passed = true;
          handleObstacleCollision(obstacle);
        }
      }

      // Complete obstacle and gain combo credits
      if (100 - obstacle.x > px + 6 && !obstacle.passed) {
        obstacle.passed = true;
        state.combo += 1;
        state.score += 75 * state.combo;
        audio.playHighScore(); // cheerful chime
        createExplosionBurst(100 - obstacle.x, obstacle.y, 0xfacc15, 12); // Yellow celebration burst
      }

      // Delete off-viewport obstacles
      if (obstacle.x < -20) {
        activeObstacles.splice(i, 1);
      }
    }

    // 7. Lava damage checker
    const playerVerticalFloorLevel = state.isJumping ? state.chestHeight - 25 : state.chestHeight;
    const isTouchingLava = playerVerticalFloorLevel > lavaLevelRef.current;

    if (isTouchingLava && !state.isInsideSafeZone && gracePeriodRef.current <= 0) {
      // Occasional tick checks for lava damage (takes roughly 1.5s contact to sizzle/take hit)
      if (Math.random() < 0.04) {
        audio.playWarning();
        createExplosionBurst(px, playerVerticalFloorLevel, 0xf97316, 6);
        
        state.lives = Math.max(0, state.lives - 1);
        state.combo = 1;

        if (state.lives <= 0) {
          triggerGameOver();
        }
      }
    }

    // Update state to trigger React HUD updates
    setUiState({
      score: state.score,
      highScore: state.highScore,
      lives: state.lives,
      combo: state.combo,
      timeElapsed: Math.round(state.timeElapsed),
      isSafe: state.isInsideSafeZone
    });
  };

  const spawnNewObstacle = (speedScale: number) => {
    const index = Math.floor(Math.random() * 3);
    const types: ObstacleType[] = ['LOW_WALL', 'HIGH_BEAM', 'VOLCANIC_ROCK'];
    const selectedType = types[index];

    let y = 72; // default low wall height
    let width = 12;
    let height = 15;
    let speed = (0.24 + Math.random() * 0.12) * speedScale;

    if (selectedType === 'HIGH_BEAM') {
      y = 42; // suspended high bar
      height = 14;
      width = 15;
    } else if (selectedType === 'VOLCANIC_ROCK') {
      y = 66; // falling meteor height
      height = 11;
      width = 11;
      speed = (0.33 + Math.random() * 0.16) * speedScale;
    }

    obstaclesRef.current.push({
      id: 'obs_' + Date.now() + Math.random(),
      type: selectedType,
      x: -12, // spawn off edge
      y,
      width,
      height,
      speed,
      passed: false
    });
  };

  const handleObstacleCollision = (obs: Obstacle) => {
    audio.playHit();
    createExplosionBurst(inputsRef.current.playerX, obs.y, 0xf43f5e, 20);

    const state = stateRef.current;
    state.lives = Math.max(0, state.lives - 1);
    state.combo = 1;

    if (state.lives <= 0) {
      triggerGameOver();
    }
  };

  const triggerGameOver = () => {
    audio.playGameOver();
    onGameOver(stateRef.current.score);
  };

  // Spark burst helper
  const createExplosionBurst = (pX: number, pY: number, colorHex: number, count: number = 10) => {
    if (!threeRef.current) return;
    const { scene, particles } = threeRef.current;

    // Map 2D percentage coords back into the 3D grid
    const startX3d = (pX - 50) * 0.32;
    const startY3d = (82 - pY) * 0.15 - 1.8;

    const sparkGeom = new THREE.DodecahedronGeometry(0.14, 0);
    const sparkMat = new THREE.MeshBasicMaterial({ color: colorHex });

    for (let i = 0; i < count; i++) {
      const sparkMesh = new THREE.Mesh(sparkGeom, sparkMat);
      sparkMesh.position.set(
        startX3d + (Math.random() - 0.5) * 0.5,
        startY3d + (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * 1.5
      );
      
      scene.add(sparkMesh);
      
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.0 + Math.random() * 5.0;
      
      particles.push({
        mesh: sparkMesh,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed + (Math.random() * 2.0), // upward thermal draft
        vz: (Math.random() - 0.5) * speed * 0.6,
        life: 0,
        maxLife: 20 + Math.floor(Math.random() * 20)
      });
    }
  };

  // Three.js renderer loop
  const renderGameGraphics = (dt: number) => {
    if (!threeRef.current || !threeRef.current.isThreeReady) {
      // 2D Canvas Fallback render logic
      render2DCanvasFallback();
      return;
    }

    const {
      scene,
      camera,
      renderer,
      playerGroup,
      jetFlame,
      lavaMesh,
      pointLight,
      zoneMeshes,
      obstacleMeshes,
      particles,
      playerLeftLeg,
      playerRightLeg,
      playerLeftArm,
      playerRightArm
    } = threeRef.current;

    // 1. Move magma waves
    const time = Date.now() * 0.003;
    const posAttr = lavaMesh.geometry.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const vx = posAttr.getX(i);
      const vz = posAttr.getZ(i);
      const wave = Math.sin(vx * 0.15 + time) * 0.28 + Math.cos(vz * 0.25 + time * 0.8) * 0.22;
      posAttr.setY(i, wave);
    }
    posAttr.needsUpdate = true;

    // Adjust global vertical Y coordinate of 3D Lava plane based on watermark level
    const lavaY3d = (82 - lavaLevelRef.current) * 0.15 - 1.8;
    lavaMesh.position.y = lavaY3d;
    // Glow intensifies as lava rises closer
    pointLight.position.y = lavaY3d + 2.0;
    pointLight.intensity = Math.max(3.0, 4.0 + (lavaY3d * 0.6));

    // 2. Synchronize Character horizontal and vertical positions
    const px = inputsRef.current.playerX;
    const targetX3d = (px - 50) * 0.32;
    // Interpolate smoothly for cinematic physics feel
    playerVisualPositionX.current = THREE.MathUtils.lerp(playerVisualPositionX.current, targetX3d, 0.25);

    // Coordinate standing target
    const targetBaseY3d = (82 - stateRef.current.chestHeight) * 0.15 - 1.8;
    
    // Jump Vertical offsets
    if (inputsRef.current.isJumping) {
      playerVisualJumpY.current = THREE.MathUtils.lerp(playerVisualJumpY.current, 3.8, 0.16);
      jetFlame.scale.set(1.5, 1.5, 1.5); // fire bursts
    } else {
      playerVisualJumpY.current = THREE.MathUtils.lerp(playerVisualJumpY.current, 0, 0.2);
      jetFlame.scale.set(0.1, 0.1, 0.1); // shrink flame
    }

    // Squat scaling compression
    if (inputsRef.current.isSquatting) {
      playerVisualSquatScale.current = THREE.MathUtils.lerp(playerVisualSquatScale.current, 0.45, 0.25);
    } else {
      playerVisualSquatScale.current = THREE.MathUtils.lerp(playerVisualSquatScale.current, 1.0, 0.15);
    }

    const currentChestY = targetBaseY3d + playerVisualJumpY.current;
    
    playerGroup.position.set(playerVisualPositionX.current, currentChestY, 0);
    playerGroup.scale.set(1.0, playerVisualSquatScale.current, 1.0);

    // Limb animations during running shifts
    const deltaX = px - prevXRef.current;
    prevXRef.current = px;

    if (Math.abs(deltaX) > 0.03) {
      rotationClock.current += Math.abs(deltaX) * 0.15 + 0.05;
      playerLeftLeg.rotation.x = Math.sin(rotationClock.current) * 0.65;
      playerRightLeg.rotation.x = -Math.sin(rotationClock.current) * 0.65;
      playerLeftArm.rotation.x = -Math.sin(rotationClock.current) * 0.5;
      playerRightArm.rotation.x = Math.sin(rotationClock.current) * 0.5;
    } else {
      // Gentle standing breathe bob
      const idleTime = Date.now() * 0.003;
      playerGroup.position.y += Math.sin(idleTime) * 0.06;
      
      // Decelerate limb rotations back to zero default standing posture
      playerLeftLeg.rotation.x = THREE.MathUtils.lerp(playerLeftLeg.rotation.x, 0, 0.15);
      playerRightLeg.rotation.x = THREE.MathUtils.lerp(playerRightLeg.rotation.x, 0, 0.15);
      playerLeftArm.rotation.x = THREE.MathUtils.lerp(playerLeftArm.rotation.x, 0, 0.15);
      playerRightArm.rotation.x = THREE.MathUtils.lerp(playerRightArm.rotation.x, 0, 0.15);
    }

    // 3. Synchronize Safe Zone Sofa Meshes
    // Keep 3D platforms perfectly matched with dynamic room maps
    safeZones.forEach((zone) => {
      let zoneGroup = zoneMeshes[zone.id];
      const isPlayerSinkingHere = px >= zone.x && px <= zone.x + zone.width;

      if (!zoneGroup) {
        // Build beautiful 3D Couch
        zoneGroup = new THREE.Group();

        const zCenterX = (zone.x + zone.width / 2 - 50) * 0.32;
        const zWidth3d = zone.width * 0.32;
        const zHeight3d = zone.height * 0.15;
        const zY3d = (82 - zone.y) * 0.15 - 1.8 - (zHeight3d / 2);

        // Couch Main Cushion Block
        const couchCushionGeom = new THREE.BoxGeometry(zWidth3d, zHeight3d, 3.2);
        // Rich retro material
        const couchMat = new THREE.MeshStandardMaterial({
          color: zone.id === 'zone_1' ? 0x059669 : 0x0369a1, // emerald or deep blue
          roughness: 0.6,
          metalness: 0.1
        });
        const cushion = new THREE.Mesh(couchCushionGeom, couchMat);
        cushion.receiveShadow = true;
        cushion.castShadow = true;
        zoneGroup.add(cushion);

        // Sofa backrest block
        const backrestGeom = new THREE.BoxGeometry(zWidth3d, zHeight3d * 1.5, 0.6);
        const backrest = new THREE.Mesh(backrestGeom, couchMat);
        backrest.position.set(0, zHeight3d * 0.8, -1.3);
        zoneGroup.add(backrest);

        // Armrests
        const armGeom = new THREE.BoxGeometry(0.7, zHeight3d * 1.1, 3.3);
        const leftArm = new THREE.Mesh(armGeom, couchMat);
        leftArm.position.set(-zWidth3d / 2 + 0.25, zHeight3d * 0.1, 0);
        const rightArm = new THREE.Mesh(armGeom, couchMat);
        rightArm.position.set(zWidth3d / 2 - 0.25, zHeight3d * 0.1, 0);
        zoneGroup.add(leftArm);
        zoneGroup.add(rightArm);

        // Glowing Neon Front Rim to display safety status
        const stripGeom = new THREE.BoxGeometry(zWidth3d - 1.0, 0.15, 0.15);
        const rimMesh = new THREE.Mesh(stripGeom, new THREE.MeshStandardMaterial({
          color: 0x10b981,
          emissive: 0x10b981,
          roughness: 0.1
        }));
        rimMesh.position.set(0, -zHeight3d / 2.5, 1.62);
        rimMesh.name = "neonStrip";
        zoneGroup.add(rimMesh);

        zoneGroup.position.set(zCenterX, zY3d, 0);
        scene.add(zoneGroup);
        zoneMeshes[zone.id] = zoneGroup;
      } else {
        // Adjust status colors based on active standing indicators
        const neon = zoneGroup.getObjectByName("neonStrip") as THREE.Mesh;
        if (neon) {
          const mat = neon.material as THREE.MeshStandardMaterial;
          if (isPlayerSinkingHere) {
            mat.color.setHex(0x10b981); // Bright emerald active green
            mat.emissive.setHex(0x10b981);
          } else {
            mat.color.setHex(0x1e293b); // Slate passive matching
            mat.emissive.setHex(0x111827);
          }
        }
      }
    });

    // Remove any 3D safe zone couch mesh that has been removed from mapped variables
    Object.keys(zoneMeshes).forEach((id) => {
      if (!safeZones.some((z) => z.id === id)) {
        scene.remove(zoneMeshes[id]);
        disposeHierarchy(zoneMeshes[id]);
        delete zoneMeshes[id];
      }
    });

    // 4. Synchronize Active Obstacle Meshes
    const obstacles = obstaclesRef.current;
    
    // Create or translate 3D Obstacle meshes
    obstacles.forEach((obs) => {
      let obsGroup = obstacleMeshes[obs.id];

      if (!obsGroup) {
        obsGroup = new THREE.Group();

        const obsWidth3d = obs.width * 0.32;
        const obsHeight3d = obs.height * 0.15;
        const obsY3d = (82 - obs.y) * 0.15 - 1.8;

        if (obs.type === 'LOW_WALL') {
          // Futuristic laser hurdle fence
          const frameMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.9, roughness: 0.1 });
          const laserMat = new THREE.MeshStandardMaterial({
            color: 0xef4444,
            emissive: 0xef4444,
            transparent: true,
            opacity: 0.82
          });

          // Post cylinders on left and right
          const poleGeom = new THREE.CylinderGeometry(0.15, 0.15, obsHeight3d, 8);
          const leftPole = new THREE.Mesh(poleGeom, frameMat);
          leftPole.position.set(-obsWidth3d / 2, 0, 0);
          
          const rightPole = new THREE.Mesh(poleGeom, frameMat);
          rightPole.position.set(obsWidth3d / 2, 0, 0);

          obsGroup.add(leftPole);
          obsGroup.add(rightPole);

          // Translucent warning glow panel
          const laserPaneGeom = new THREE.BoxGeometry(obsWidth3d - 0.3, obsHeight3d * 0.9, 0.15);
          const panel = new THREE.Mesh(laserPaneGeom, laserMat);
          obsGroup.add(panel);

        } else if (obs.type === 'HIGH_BEAM') {
          // Cyber Overhead bar emitting horizontal laser energy
          const emitterGeom = new THREE.CylinderGeometry(0.24, 0.24, 0.5, 8);
          const emitterMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8, roughness: 0.2 });
          
          const leftEmit = new THREE.Mesh(emitterGeom, emitterMat);
          leftEmit.rotateZ(Math.PI / 2);
          leftEmit.position.set(-obsWidth3d * 0.6, 0, 0);
          
          const rightEmit = new THREE.Mesh(emitterGeom, emitterMat);
          rightEmit.rotateZ(Math.PI / 2);
          rightEmit.position.set(obsWidth3d * 0.6, 0, 0);

          obsGroup.add(leftEmit);
          obsGroup.add(rightEmit);

          // Laser beam
          const laserBeamGeom = new THREE.CylinderGeometry(0.12, 0.12, obsWidth3d * 1.1, 8);
          const laserBeamMat = new THREE.MeshStandardMaterial({
            color: 0x06b6d4,
            emissive: 0x06b6d4,
            roughness: 0.01
          });
          const beam = new THREE.Mesh(laserBeamGeom, laserBeamMat);
          beam.rotateZ(Math.PI / 2);
          obsGroup.add(beam);

        } else {
          // Dark volcano meteor rock sphere
          const meteorGeom = new THREE.DodecahedronGeometry(obsWidth3d * 0.45, 1);
          const meteorMat = new THREE.MeshStandardMaterial({
            color: 0x1c1917,
            emissive: 0x7c2d12,
            roughness: 0.9,
            metalness: 0.1,
            flatShading: true
          });
          const meteor = new THREE.Mesh(meteorGeom, meteorMat);
          meteor.castShadow = true;
          meteor.name = "meteorSphere";
          obsGroup.add(meteor);
        }

        obsGroup.position.set(18, obsY3d, 0);
        scene.add(obsGroup);
        obstacleMeshes[obs.id] = obsGroup;
      } else {
        // Linear alignment coordinates sync
        const currentTargetX3d = ((100 - obs.x - obs.width / 2) - 50) * 0.32;
        const obsY3d = (82 - obs.y) * 0.15 - 1.8;
        obsGroup.position.set(currentTargetX3d, obsY3d, 0);

        // Rotate the craggy meteor rock over time!
        const meteor = obsGroup.getObjectByName("meteorSphere");
        if (meteor) {
          meteor.rotation.y += dt * 3.5;
          meteor.rotation.z += dt * 2.5;
        }
      }
    });

    // Wipe any 3D meshes for completed obstacles
    Object.keys(obstacleMeshes).forEach((id) => {
      if (!obstacles.some((o) => o.id === id)) {
        scene.remove(obstacleMeshes[id]);
        disposeHierarchy(obstacleMeshes[id]);
        delete obstacleMeshes[id];
      }
    });

    // 5. Update Ember Spark Point particles
    for (let k = particles.length - 1; k >= 0; k--) {
      const part = particles[k];
      part.mesh.position.x += part.vx * dt;
      part.mesh.position.y += part.vy * dt;
      part.mesh.position.z += part.vz * dt;
      
      // Decelerate thermal draft
      part.vy -= 9.8 * dt * 0.4; 
      
      part.life += 1;
      
      // Shrink sparks visually as they decay
      const lifePct = part.life / part.maxLife;
      part.mesh.scale.setScalar(1.0 - lifePct);

      if (part.life >= part.maxLife) {
        scene.remove(part.mesh);
        part.mesh.geometry.dispose();
        if (Array.isArray(part.mesh.material)) {
          part.mesh.material.forEach((m) => m.dispose());
        } else {
          part.mesh.material.dispose();
        }
        particles.splice(k, 1);
      }
    }

    // 6. Execute Render trigger!
    renderer.render(scene, camera);
  };

  // 2D Canvas Fallback painting method (if WebGL crashes or lacks frames)
  const render2DCanvasFallback = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0b0f19';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 13px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('LOADING AMAZING 3D WORKSPACE WORLD...', canvas.width / 2, canvas.height / 2);
  };

  return (
    <div 
      ref={containerRef}
      className="relative flex flex-col items-center bg-slate-950/80 rounded-2xl border border-slate-800 p-5 overflow-hidden w-full h-full min-h-[480px]"
    >
      {/* Game HUD Panel Bar */}
      <div className="w-full grid grid-cols-2 sm:grid-cols-4 gap-4 bg-slate-900/60 border border-slate-800 rounded-xl p-3 mb-4 select-none z-10">
        
        <div className="text-left">
          <span className="text-[10px] uppercase tracking-wider font-mono text-slate-500 font-bold block">CORE SCORE</span>
          <span className="font-sans font-extrabold text-slate-100 text-lg md:text-xl tracking-tight text-glow">
            {uiState.score} <span className="font-mono text-xs font-medium text-emerald-400">PTS</span>
          </span>
        </div>

        <div className="text-left">
          <span className="text-[10px] uppercase tracking-wider font-mono text-slate-500 font-bold block">STABILITY LIVES</span>
          <div className="flex items-center gap-1 mt-1">
            {Array.from({ length: 3 }).map((_, idx) => (
              <span 
                key={idx} 
                className={`w-3 h-3 rounded-full transition-all ${
                  idx < uiState.lives 
                  ? 'bg-rose-500 shadow-md shadow-rose-500/50' 
                  : 'bg-slate-800'
                }`}
              />
            ))}
          </div>
        </div>

        <div className="text-left">
          <span className="text-[10px] uppercase tracking-wider font-mono text-slate-500 font-bold block">COMBO MULTIPLIER</span>
          <span className="font-sans font-extrabold text-yellow-400 text-lg md:text-xl block">
            x{uiState.combo} <span className="text-[10px] text-slate-400 font-normal">STREAK</span>
          </span>
        </div>

        <div className="text-left">
          <span className="text-[10px] uppercase tracking-wider font-mono text-slate-500 font-bold block">ELAPSED TIME</span>
          <span className="font-sans font-extrabold text-slate-100 text-lg md:text-xl block">
            {uiState.timeElapsed}s <span className="text-[10px] text-slate-400 font-normal">ELAPSED</span>
          </span>
        </div>

      </div>

      {/* Primary HTML5 Canvas Frame */}
      <div className="relative aspect-[16/9] w-full rounded-xl overflow-hidden border border-slate-800 shadow-2xl bg-slate-950">
        
        <canvas
          ref={canvasRef}
          width={800}
          height={450}
          className="w-full h-full object-cover"
          id="floor-lava-game-canvas"
        />

        {/* Dynamic Ready/Go Overlay Countdown under Grace Period */}
        {isPlaying && graceCountdown > 0 && (
          <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center select-none pointer-events-none animate-fade-in">
            <div className="bg-gradient-to-r from-yellow-500/20 to-red-500/20 border border-yellow-500/30 rounded-2xl p-6 max-w-sm">
              <span className="text-[10px] uppercase tracking-widest font-mono text-yellow-400 font-bold block mb-1">STABILIZING SENSORS</span>
              <h2 className="text-4xl font-sans font-black text-white uppercase tracking-tight">GET READY!</h2>
              <p className="text-xs text-slate-300 mt-2">Standing safely on Sofa. Ready your jumps & squats!</p>
              <div className="text-6xl font-black text-yellow-400 font-mono mt-4 animate-ping">
                {graceCountdown}
              </div>
            </div>
          </div>
        )}

        {/* Mapped Platforms indicator sidebar alert */}
        {isPlaying && (
          <div className="absolute top-4 left-4 p-2 bg-slate-950/85 backdrop-blur-md border border-slate-800 rounded-lg flex items-center gap-2 select-none pointer-events-none">
            <Shield className={`w-4 h-4 ${uiState.isSafe ? 'text-emerald-400 animate-pulse' : 'text-slate-400'}`} />
            <div className="text-left">
              <span className="text-[9px] text-slate-500 block leading-none font-bold uppercase">SURFACE STATUS</span>
              <span className={`text-[10px] font-mono font-bold ${uiState.isSafe ? 'text-emerald-400' : 'text-slate-400'}`}>
                {uiState.isSafe ? 'PLATFORM ACTIVE' : 'LAVA TIDE RISES'}
              </span>
            </div>
          </div>
        )}

        {/* Invulnerable notification shield */}
        {isPlaying && graceCountdown > 0 && (
          <div className="absolute bottom-4 left-4 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-mono py-1 px-2.5 rounded-lg flex items-center gap-1.5 animate-pulse select-none">
            <ShieldAlert className="w-3.5 h-3.5" />
            CORE ABSOLUTE INVULNERABLE ({graceCountdown}s)
          </div>
        )}

        {/* Dynamic warning if Lava tides are dangerously close */}
        {isPlaying && !uiState.isSafe && graceCountdown === 0 && (
          <div className="absolute top-4 right-4 bg-orange-500/10 border border-orange-500/30 text-orange-400 text-[10px] font-mono py-1 px-2.5 rounded-lg flex items-center gap-1.5 animate-pulse select-none">
            <AlertTriangle className="w-3.5 h-3.5" />
            FLOOR LAVA FLOWING! GET TO COUCH NOW!
          </div>
        )}

        {/* Menu overlay state if not currently running */}
        {!isPlaying && (
          <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center select-none">
            <div className="p-4 rounded-full bg-orange-500/10 border border-orange-500/20 mb-4 animate-pulse">
              <RotateCcw className="w-12 h-12 text-orange-400 transform rotate-45" />
            </div>

            <h3 className="font-sans font-black text-2xl md:text-3xl tracking-tight text-white uppercase bg-gradient-to-r from-orange-400 to-yellow-400 bg-clip-text text-transparent">
              THE FLOOR IS LAVA 3D
            </h3>
            <p className="text-xs text-slate-400 mt-2 max-w-sm leading-relaxed mb-6">
              A gorgeous real-time canvas. Avoid obstacles by crouch-diving or jumping. Calibrate sofas on your zone planner to stay protected!
            </p>

            <button
              onClick={handleStart}
              className="px-6 py-3 font-bold rounded-xl text-slate-950 bg-gradient-to-r from-orange-500 to-yellow-500 hover:brightness-110 active:scale-95 transition-all shadow-md flex items-center gap-2 cursor-pointer text-sm font-sans"
            >
              <Play className="w-4 h-4 fill-slate-950" />
              START 3D GAME
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 text-[10px] text-slate-500 leading-relaxed font-sans mt-3 select-none text-left w-full pl-1">
        <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <span>
          <b className="text-slate-400">3D AR CONTROLS:</b> 
          <span className="text-yellow-400 font-bold"> Jump (Space)</span> to clear Low Obstacles. 
          <span className="text-pink-500 font-bold"> Squat (S)</span> to duck under High Obstacles. Stand in defined <span className="text-emerald-400 font-bold">Safe Zones</span> to stay raised above lava.
        </span>
      </div>
    </div>
  );
}
