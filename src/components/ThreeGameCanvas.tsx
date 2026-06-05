/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { SafeZone, Obstacle, PlayerState, ObstacleType } from '../types';
import { Play, RotateCcw, Shield, ShieldAlert, AlertTriangle, Info, MoveLeft, MoveRight } from 'lucide-react';
import { audio } from '../utils/audio';

// Extended type for 3D Lane-runner obstacles
interface RunnerObstacle extends Obstacle {
  lane: number; // -1 = Left, 0 = Center, 1 = Right
  z: number;    // Z-coordinate along the track (starts far away at -35, moves forward)
}

interface ThreeGameCanvasProps {
  safeZones: SafeZone[];
  isPoseJumping: boolean;
  isPoseSquatting: boolean;
  playerX: number; // 0-100 position from pose tracker
  isPlaying: boolean;
  onGameOver: (finalScore: number) => void;
  onStartGame: () => void;
}

// -------------------------------------------------------------
// Component: Player Character (Robot/Astronaut structure via Primitives)
// -------------------------------------------------------------
interface PlayerMeshProps {
  currentLane: number;
  isJumping: boolean;
  isSquatting: boolean;
  isPlaying: boolean;
}

function PlayerMesh({ currentLane, isJumping, isSquatting, isPlaying }: PlayerMeshProps) {
  const groupRef = useRef<THREE.Group>(null);
  const leftLegRef = useRef<THREE.Mesh>(null);
  const rightLegRef = useRef<THREE.Mesh>(null);
  const leftArmRef = useRef<THREE.Mesh>(null);
  const rightArmRef = useRef<THREE.Mesh>(null);
  const flameRef = useRef<THREE.Mesh>(null);

  // Smooth lerp states
  const visualX = useRef(0);
  const visualJumpY = useRef(0);
  const visualSquatScale = useRef(1.0);
  const jumpFlipRotation = useRef(0);
  const elapsedRunTimeRef = useRef(0);

  useFrame((state, delta) => {
    if (!groupRef.current) return;

    // 1. Move player horizontally based on high-performance lerp to target lane X
    const targetX3d = currentLane * 2.22;
    visualX.current = THREE.MathUtils.lerp(visualX.current, targetX3d, 0.18);

    // 2. Base vertical line (grounded on elevated track at Y = -1.5)
    const targetBaseY3d = -1.45;

    // 3. Jump vertical offsets & Flip animations
    if (isJumping) {
      visualJumpY.current = THREE.MathUtils.lerp(visualJumpY.current, 2.3, 0.16);
      jumpFlipRotation.current = THREE.MathUtils.lerp(jumpFlipRotation.current, Math.PI * 2, 0.12);
      if (flameRef.current) {
        flameRef.current.scale.set(1.5, 1.5 + Math.sin(state.clock.getElapsedTime() * 32) * 0.3, 1.5);
      }
    } else {
      visualJumpY.current = THREE.MathUtils.lerp(visualJumpY.current, 0, 0.16);
      jumpFlipRotation.current = THREE.MathUtils.lerp(jumpFlipRotation.current, 0, 0.2);
      if (flameRef.current) {
        flameRef.current.scale.set(0.1, 0.1, 0.1);
      }
    }

    // 4. Squat scaling compression
    if (isSquatting) {
      visualSquatScale.current = THREE.MathUtils.lerp(visualSquatScale.current, 0.45, 0.22);
    } else {
      visualSquatScale.current = THREE.MathUtils.lerp(visualSquatScale.current, 1.0, 0.16);
    }

    // Only progress run cycle if the game is actively playing!
    if (isPlaying) {
      elapsedRunTimeRef.current += delta;
    }
    const runCycle = elapsedRunTimeRef.current * 11.5;
    const yBob = isJumping ? 0 : Math.sin(runCycle) * 0.08;

    groupRef.current.position.set(visualX.current, targetBaseY3d + visualJumpY.current + yBob, 0);
    groupRef.current.scale.set(1.0, visualSquatScale.current, 1.0);

    // Dynamic lean roll rotation depending on side movement
    const positionDeltaX = targetX3d - visualX.current;
    const targetRoll = -positionDeltaX * 0.25;

    groupRef.current.rotation.set(
      jumpFlipRotation.current,
      isPlaying ? Math.sin(runCycle * 0.5) * 0.04 : 0,
      THREE.MathUtils.lerp(groupRef.current.rotation.z, targetRoll, 0.1)
    );

    // Apply continuous dynamic runner pump cycles to legs/arms
    const legRotationScale = isPlaying ? 0.7 : 0.0;
    const armRotationScale = isPlaying ? 0.5 : 0.0;

    if (leftLegRef.current) leftLegRef.current.rotation.x = Math.sin(runCycle) * legRotationScale;
    if (rightLegRef.current) rightLegRef.current.rotation.x = -Math.sin(runCycle) * legRotationScale;
    if (leftArmRef.current) leftArmRef.current.rotation.x = -Math.sin(runCycle) * armRotationScale;
    if (rightArmRef.current) rightArmRef.current.rotation.x = Math.sin(runCycle) * armRotationScale;
  });

  return (
    <group ref={groupRef} name="player-group">
      {/* Torso */}
      <mesh position={[0, 0.9, 0]} castShadow receiveShadow name="player-torso">
        <boxGeometry args={[0.8, 1.1, 0.7]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.2} metalness={0.6} />
      </mesh>

      {/* Cybernetic Visor Head */}
      <group position={[0, 1.7, 0]} name="player-head">
        <mesh castShadow name="player-helmet">
          <sphereGeometry args={[0.38, 16, 16]} />
          <meshStandardMaterial color="#f1f5f9" roughness={0.2} metalness={0.8} />
        </mesh>
        {/* Glow Blue Shield Visor */}
        <mesh position={[0, 0.05, 0.28]} name="player-visor">
          <boxGeometry args={[0.5, 0.2, 0.2]} />
          <meshStandardMaterial color="#22d3ee" emissive="#22d3ee" emissiveIntensity={1.5} roughness={0.01} />
        </mesh>
      </group>

      {/* Jetpack On Back */}
      <mesh position={[0, 0.8, -0.42]} castShadow name="player-jetpack">
        <boxGeometry args={[0.55, 0.8, 0.3]} />
        <meshStandardMaterial color="#ef4444" roughness={0.4} />
      </mesh>

      {/* Glowing Cone Jet Flame */}
      <mesh ref={flameRef} position={[0, 0.2, -0.42]} rotation={[Math.PI, 0, 0]} name="player-jetflame">
        <coneGeometry args={[0.15, 0.6, 8]} />
        <meshBasicMaterial color="#facc15" />
      </mesh>

      {/* Legs */}
      <mesh ref={leftLegRef} position={[-0.26, 0.15, 0]} name="player-left-leg">
        <boxGeometry args={[0.26, 0.6, 0.26]} />
        <meshStandardMaterial color="#cbd5e1" roughness={0.3} />
      </mesh>

      <mesh ref={rightLegRef} position={[0.26, 0.15, 0]} name="player-right-leg">
        <boxGeometry args={[0.26, 0.6, 0.26]} />
        <meshStandardMaterial color="#cbd5e1" roughness={0.3} />
      </mesh>

      {/* Arms */}
      <mesh ref={leftArmRef} position={[-0.52, 0.9, 0]} name="player-left-arm">
        <boxGeometry args={[0.18, 0.6, 0.18]} />
        <meshStandardMaterial color="#cbd5e1" roughness={0.3} />
      </mesh>

      <mesh ref={rightArmRef} position={[0.52, 0.9, 0]} name="player-right-arm">
        <boxGeometry args={[0.18, 0.6, 0.18]} />
        <meshStandardMaterial color="#cbd5e1" roughness={0.3} />
      </mesh>
    </group>
  );
}

// -------------------------------------------------------------
// Component: Liquid Magma Lava Plane (GLSL Shader Material)
// -------------------------------------------------------------
interface LavaPlaneProps {
  lavaLevel: number;
}

const LAVA_VERTEX_SHADER = `
  uniform float u_time;
  varying vec2 vUv;
  varying float vElevation;

  void main() {
    vUv = uv;
    vec4 modelPosition = modelMatrix * vec4(position, 1.0);
    float elevation = sin(modelPosition.x * 0.3 + u_time * 2.5) * 0.2
                    + cos(modelPosition.y * 0.35 + u_time * 2.1) * 0.15;
    
    modelPosition.z += elevation; 
    vElevation = elevation;

    vec4 viewPosition = viewMatrix * modelPosition;
    vec4 projectedPosition = projectionMatrix * viewPosition;
    gl_Position = projectedPosition;
  }
`;

const LAVA_FRAGMENT_SHADER = `
  uniform float u_time;
  uniform vec3 u_colorA;
  uniform vec3 u_colorB;
  uniform vec3 u_colorC;
  uniform float u_rising_intensity;
  varying vec2 vUv;
  varying float vElevation;

  void main() {
    float swirlX = sin(vUv.x * 8.0 + u_time * 1.5);
    float swirlY = cos(vUv.y * 8.0 - u_time * 1.2);
    
    float pulseSpeed = 1.5 + u_rising_intensity * 2.5; 
    float pulseGlow = sin(u_time * pulseSpeed) * 0.3 + 0.7;
    float riseBoost = u_rising_intensity * 0.5;
    
    float pulse = (swirlX + swirlY) * 0.5 + vElevation * (1.2 + riseBoost);

    float mixFactor = smoothstep(-1.0, 1.0, pulse);
    vec3 baseColor = mix(u_colorA, u_colorB, mixFactor);

    float crustVal = sin(vUv.x * 20.0 + u_time * 0.6) * cos(vUv.y * 20.0 - u_time * 0.5);
    float crustFactor = smoothstep(0.3, 0.8, crustVal);
    vec3 finalColor = mix(baseColor, u_colorC, crustFactor * (0.7 - riseBoost * 0.5));

    vec3 emissiveGlow = baseColor * pulseGlow * (1.2 + riseBoost);
    vec3 finalGlow = mix(finalColor, emissiveGlow, 0.4 + riseBoost * 0.3);

    gl_FragColor = vec4(finalGlow, 1.0);
  }
`;

function LavaPlane({ lavaLevel }: LavaPlaneProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const shaderRef = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useRef({
    u_time: { value: 0 },
    u_colorA: { value: new THREE.Color('#ff2200') }, 
    u_colorB: { value: new THREE.Color('#ffa600') }, 
    u_colorC: { value: new THREE.Color('#1c0300') }, 
    u_rising_intensity: { value: 0.1 }
  });

  useFrame((state) => {
    if (meshRef.current) {
      // Lava stands below the running track
      meshRef.current.position.y = -2.6;
    }
    if (shaderRef.current) {
      shaderRef.current.uniforms.u_time.value = state.clock.getElapsedTime();
      shaderRef.current.uniforms.u_rising_intensity.value = 0.5;
    }
  });

  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} receiveShadow name="lava-mesh">
      <planeGeometry args={[120, 120, 64, 64]} />
      <shaderMaterial
        ref={shaderRef}
        vertexShader={LAVA_VERTEX_SHADER}
        fragmentShader={LAVA_FRAGMENT_SHADER}
        uniforms={uniforms.current}
      />
    </mesh>
  );
}

// -------------------------------------------------------------
// Component: Scenic Running Track split into 3 Lanes
// -------------------------------------------------------------
interface HighwayTrackProps {
  isPlaying: boolean;
}

function HighwayTrack({ isPlaying }: HighwayTrackProps) {
  const dashesRef = useRef<THREE.Group>(null);
  const elapsedRunTimeRef = useRef(0);
  
  useFrame((state, delta) => {
    if (!dashesRef.current) return;
    
    // Only accumulate running time and slide dashes if active!
    if (isPlaying) {
      elapsedRunTimeRef.current += delta;
    }
    const time = elapsedRunTimeRef.current;
    const speed = 12.5; // Flow speed backward to simulate forward running speed
    
    // Animate the highway lane lines moving backward to create continuous motion
    dashesRef.current.children.forEach((child, index) => {
      const startZ = -index * 5.0;
      let targetZ = startZ + (time * speed) % 40.0;
      if (targetZ > 5.0) {
        targetZ -= 40.0;
      }
      child.position.z = targetZ;
    });
  });

  return (
    <group name="highway-track">
      {/* Absolute Solid Concrete Road Elevated Bridge Runway */}
      <mesh position={[0, -1.65, -18]} receiveShadow castShadow>
        <boxGeometry args={[7.4, 0.3, 55]} />
        <meshStandardMaterial color="#1e1e24" roughness={0.7} metalness={0.2} />
      </mesh>

      {/* Hazardous bright yellow edges */}
      <mesh position={[-3.65, -1.5, -18]} castShadow>
        <boxGeometry args={[0.15, 0.35, 55]} />
        <meshStandardMaterial color="#eab308" roughness={0.3} />
      </mesh>
      <mesh position={[3.65, -1.5, -18]} castShadow>
        <boxGeometry args={[0.15, 0.35, 55]} />
        <meshStandardMaterial color="#eab308" roughness={0.3} />
      </mesh>

      {/* Moving Highway Dashes separating the lanes */}
      <group ref={dashesRef} name="moving-dashed-guides">
        {Array.from({ length: 8 }).map((_, idx) => (
          <group key={idx}>
            {/* Left-center separator dashes */}
            <mesh position={[-1.1, -1.49, 0]}>
              <boxGeometry args={[0.08, 0.02, 1.2]} />
              <meshBasicMaterial color="#ffffff" transparent opacity={0.65} />
            </mesh>
            {/* Right-center separator dashes */}
            <mesh position={[1.1, -1.49, 0]}>
              <boxGeometry args={[0.08, 0.02, 1.2]} />
              <meshBasicMaterial color="#ffffff" transparent opacity={0.65} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}

// -------------------------------------------------------------
// Component: Scenic Resort Houses (Villas) frames the action
// -------------------------------------------------------------
function ScenicHouses() {
  return (
    <group name="scenic-houses-group">
      {/* LEFT BANK SIDE VILLAS */}
      {/* Villa 1: Beautiful Terracotta Pink */}
      <group position={[-9.5, -1.0, -12]}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[4.2, 3.8, 4.2]} />
          <meshStandardMaterial color="#fda4af" roughness={0.8} /> 
        </mesh>
        <mesh position={[0, 2.5, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
          <coneGeometry args={[3.2, 1.8, 4]} />
          <meshStandardMaterial color="#b91c1c" roughness={0.5} /> 
        </mesh>
        <mesh position={[0, 0.5, 2.122]}>
          <boxGeometry args={[0.8, 0.8, 0.05]} />
          <meshBasicMaterial color="#fef08a" />
        </mesh>
        <mesh position={[-1.2, 0.5, 2.122]}>
          <boxGeometry args={[0.8, 0.8, 0.05]} />
          <meshBasicMaterial color="#fef08a" />
        </mesh>
        <mesh position={[1.2, 0.5, 2.122]}>
          <boxGeometry args={[0.8, 0.8, 0.05]} />
          <meshBasicMaterial color="#fef08a" />
        </mesh>
      </group>

      {/* Villa 2: Double-Storey White Plaster House */}
      <group position={[-11.2, -0.4, -28]}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[4.2, 5.0, 4.2]} />
          <meshStandardMaterial color="#fafafa" roughness={0.9} />
        </mesh>
        <mesh position={[0, 3.2, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
          <coneGeometry args={[3.4, 2.2, 4]} />
          <meshStandardMaterial color="#ea580c" roughness={0.5} /> 
        </mesh>
        {[-1.1, 1.1].map((cx, i) => (
          <group key={i}>
            <mesh position={[cx, 1.2, 2.122]}>
              <boxGeometry args={[0.7, 1.0, 0.05]} />
              <meshBasicMaterial color="#fef08a" />
            </mesh>
            <mesh position={[cx, -0.8, 2.122]}>
              <boxGeometry args={[0.7, 1.0, 0.05]} />
              <meshBasicMaterial color="#fef08a" />
            </mesh>
          </group>
        ))}
      </group>

      {/* RIGHT BANK SIDE VILLAS */}
      {/* Villa 3: Sunset Peach House */}
      <group position={[9.5, -1.0, -8]}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[3.8, 3.5, 3.8]} />
          <meshStandardMaterial color="#fed7aa" roughness={0.8} /> 
        </mesh>
        <mesh position={[0, 2.3, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
          <coneGeometry args={[3.0, 1.6, 4]} />
          <meshStandardMaterial color="#c2410c" roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.3, -1.922]}>
          <boxGeometry args={[0.8, 0.8, 0.05]} />
          <meshBasicMaterial color="#fef08a" />
        </mesh>
        <mesh position={[-1.0, 0.3, 1.922]}>
          <boxGeometry args={[0.8, 0.8, 0.05]} />
          <meshBasicMaterial color="#fef08a" />
        </mesh>
        <mesh position={[1.0, 0.3, 1.922]}>
          <boxGeometry args={[0.8, 0.8, 0.05]} />
          <meshBasicMaterial color="#fef08a" />
        </mesh>
      </group>

      {/* Villa 4: Coastal White Mansion */}
      <group position={[11.5, -0.6, -24]}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[4.4, 4.6, 4.4]} />
          <meshStandardMaterial color="#f4f5f6" roughness={0.85} />
        </mesh>
        <mesh position={[0, 2.9, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
          <coneGeometry args={[3.5, 2.0, 4]} />
          <meshStandardMaterial color="#9a3412" roughness={0.5} />
        </mesh>
        <mesh position={[-1.1, 0.8, 2.222]}>
          <boxGeometry args={[0.7, 0.9, 0.05]} />
          <meshBasicMaterial color="#fef08a" />
        </mesh>
        <mesh position={[1.1, 0.8, 2.222]}>
          <boxGeometry args={[0.7, 0.9, 0.05]} />
          <meshBasicMaterial color="#fef08a" />
        </mesh>
        <mesh position={[0, -0.8, 2.222]}>
          <boxGeometry args={[0.9, 1.2, 0.05]} />
          <meshBasicMaterial color="#fef08a" />
        </mesh>
      </group>
    </group>
  );
}

// -------------------------------------------------------------
// Component: Floating Sunset Hot Air Balloon (from the reference image!)
// -------------------------------------------------------------
function ScenicHotAirBalloon() {
  const balloonRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (!balloonRef.current) return;
    const time = state.clock.getElapsedTime();
    // Smooth atmospheric floating oscillation bobbing
    balloonRef.current.position.y = 3.3 + Math.sin(time * 0.7) * 0.25;
    balloonRef.current.position.x = 7.4 + Math.cos(time * 0.4) * 0.12;
    balloonRef.current.rotation.y = time * 0.06;
  });

  return (
    <group ref={balloonRef} position={[7.4, 3.3, -16]} name="sunset-hot-balloon">
      {/* Large colorful canopy globe */}
      <mesh castShadow name="canopy-balloon">
        <sphereGeometry args={[1.4, 16, 16]} />
        <meshStandardMaterial color="#eab308" roughness={0.3} metalness={0.15} /> 
      </mesh>
      
      {/* Decorative center stripes */}
      <mesh scale={[1.41, 0.35, 1.41]} position={[0, 0.15, 0]} name="stripe-1">
        <sphereGeometry args={[1.0, 16, 16]} />
        <meshStandardMaterial color="#ea580c" roughness={0.3} /> 
      </mesh>
      <mesh scale={[1.34, 1.35, 1.34]} position={[0, -0.2, 0]} name="stripe-2">
        <sphereGeometry args={[1.0, 16, 16]} />
        <meshStandardMaterial color="#3b82f6" roughness={0.3} /> 
      </mesh>

      {/* Tiny basket below */}
      <mesh position={[0, -2.2, 0]} castShadow name="canopy-basket">
        <boxGeometry args={[0.4, 0.3, 0.4]} />
        <meshStandardMaterial color="#78350f" roughness={0.9} /> 
      </mesh>

      {/* Rigging support strings */}
      {[-0.15, 0.15].map((rx) => (
        <group key={rx}>
          <mesh position={[rx, -1.2, -0.15]} name="string-1">
            <cylinderGeometry args={[0.015, 0.015, 1.7, 4]} />
            <meshStandardMaterial color="#334155" />
          </mesh>
          <mesh position={[rx, -1.2, 0.15]} name="string-2">
            <cylinderGeometry args={[0.015, 0.015, 1.7, 4]} />
            <meshStandardMaterial color="#334155" />
          </mesh>
        </group>
      ))}

      {/* Fiery orange burner glowing */}
      <mesh position={[0, -1.0, 0]} name="burner-heat">
        <cylinderGeometry args={[0.08, 0.1, 0.12, 8]} />
        <meshStandardMaterial color="#ef4444" emissive="#f97316" emissiveIntensity={2.5} />
      </mesh>
    </group>
  );
}

// -------------------------------------------------------------
// Component: Dynamic runner-aware Hurdles / Obstacles
// -------------------------------------------------------------
interface RunnerObstaclesGroupProps {
  obstacles: Obstacle[];
}

function RunnerObstaclesGroup({ obstacles }: RunnerObstaclesGroupProps) {
  return (
    <group name="runner-obstacles">
      {obstacles.map((o) => {
        const obs = o as RunnerObstacle;
        
        // Define lane horizontal positions: Left = -2.2, Center = 0.0, Right = 2.2
        const laneX = obs.lane * 2.22;
        
        if (obs.type === 'LOW_WALL') {
          // Ground hazard. Must JUMP to clear
          return (
            <group key={obs.id} position={[laneX, -1.5, obs.z]} name={`obstacle-${obs.id}`}>
              <mesh position={[0, 0.25, 0]} castShadow name="laser-gate">
                <boxGeometry args={[1.9, 0.45, 0.35]} />
                <meshStandardMaterial
                  color="#f97316"
                  emissive="#ea580c"
                  emissiveIntensity={2.0}
                  roughness={0.2}
                />
              </mesh>
              <mesh position={[0, 0.48, 0]}>
                <boxGeometry args={[2.0, 0.06, 0.4]} />
                <meshBasicMaterial color="#ffffff" />
              </mesh>
            </group>
          );
        } else if (obs.type === 'HIGH_BEAM') {
          // Elevated pipeline bar. Must SQUAT/DUCK under
          return (
            <group key={obs.id} position={[laneX, -0.4, obs.z]} name={`obstacle-${obs.id}`}>
              <mesh rotation={[0, 0, Math.PI / 2]} castShadow name="overhead-cyan-bar">
                <cylinderGeometry args={[0.07, 0.07, 1.9, 8]} />
                <meshStandardMaterial color="#00f2fe" emissive="#0284c7" emissiveIntensity={1.8} />
              </mesh>
              {/* Support bars */}
              <mesh position={[-0.95, -0.5, 0]}>
                <boxGeometry args={[0.05, 1.1, 0.05]} />
                <meshStandardMaterial color="#475569" />
              </mesh>
              <mesh position={[0.95, -0.5, 0]}>
                <boxGeometry args={[0.05, 1.1, 0.05]} />
                <meshStandardMaterial color="#475569" />
              </mesh>
            </group>
          );
        } else {
          // Giant Blockade. Impossible to dodge via pose action, user MUST change lanes
          return (
            <group key={obs.id} position={[laneX, -1.5, obs.z]} name={`obstacle-${obs.id}`}>
              <mesh position={[0, 1.0, 0]} castShadow receiveShadow name="hazard-barrier-body">
                <boxGeometry args={[1.9, 1.9, 0.7]} />
                <meshStandardMaterial
                  color="#291305" 
                  emissive="#7c2d12"
                  emissiveIntensity={1.4}
                  roughness={0.9}
                  flatShading
                />
              </mesh>
              <mesh position={[0, 1.85, 0]}>
                <boxGeometry args={[1.92, 0.15, 0.72]} />
                <meshBasicMaterial color="#fbbf24" /> 
              </mesh>
            </group>
          );
        }
      })}
    </group>
  );
}

// -------------------------------------------------------------
// Component: Main 3D Lane-Runner Canvas
// -------------------------------------------------------------
export default function ThreeGameCanvas({
  safeZones,
  isPoseJumping,
  isPoseSquatting,
  playerX,
  isPlaying,
  onGameOver,
  onStartGame
}: ThreeGameCanvasProps) {

  // Central gameplay states
  const stateRef = useRef<PlayerState>({
    score: 0,
    highScore: Number(localStorage.getItem('floor_lava_hs') || '500'),
    lives: 3,
    combo: 1,
    timeElapsed: 0,
    chestHeight: 82,
    isJumping: false,
    isSquatting: false,
    isInsideSafeZone: true,
    lastAction: null,
    activityStrength: 10
  });

  const [uiState, setUiState] = useState({
    score: 0,
    highScore: Number(localStorage.getItem('floor_lava_hs') || '500'),
    lives: 3,
    combo: 1,
    timeElapsed: 0,
    isSafe: true,
    currentLane: 0
  });

  const [obstacles, setObstacles] = useState<RunnerObstacle[]>([]);
  const [lavaLevel, setLavaLevel] = useState<number>(98);
  const [graceCountdown, setGraceCountdown] = useState<number>(0);

  // Runner controls refs
  const currentLaneRef = useRef<number>(0); // -1: Left, 0: Center, 1: Right
  const keyboardJumpRef = useRef<boolean>(false);
  const keyboardSquatRef = useRef<boolean>(false);
  const lastKeyPressTimeRef = useRef<number>(0);
  const lastBodyLaneRef = useRef<number>(0);

  const lastSpawnTimeRef = useRef<number>(0);
  const gracePeriodRef = useRef<number>(0);
  const speedScaleRef = useRef<number>(1.0);

  // Synchronize camera inputs using refs so the main RAF loop doesn't restart continuously
  const playerXRef = useRef<number>(playerX);
  const isPoseJumpingRef = useRef<boolean>(isPoseJumping);
  const isPoseSquattingRef = useRef<boolean>(isPoseSquatting);

  playerXRef.current = playerX;
  isPoseJumpingRef.current = isPoseJumping;
  isPoseSquattingRef.current = isPoseSquatting;

  // Key Event triggers for immediate Lane switching 
  const handleStart = () => {
    stateRef.current = {
      score: 0,
      highScore: Number(localStorage.getItem('floor_lava_hs') || '500'),
      lives: 3,
      combo: 1,
      timeElapsed: 0,
      chestHeight: 82,
      isJumping: false,
      isSquatting: false,
      isInsideSafeZone: true,
      lastAction: null,
      activityStrength: 10
    };

    currentLaneRef.current = 0; // Starts in the center lane!
    lastBodyLaneRef.current = playerX < 36 ? -1 : playerX > 64 ? 1 : 0;

    setUiState({
      score: 0,
      highScore: stateRef.current.highScore,
      lives: 3,
      combo: 1,
      timeElapsed: 0,
      isSafe: true,
      currentLane: 0
    });

    setObstacles([]);
    setLavaLevel(98);
    gracePeriodRef.current = 4.0; 
    speedScaleRef.current = 1.0;

    onStartGame();
  };

  // Keyboard Event bindings
  useEffect(() => {
    if (!isPlaying) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Record keypress timestamps to prioritize keyboard lane changes temporarily over camera lean
      lastKeyPressTimeRef.current = Date.now();

      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        currentLaneRef.current = Math.max(-1, currentLaneRef.current - 1);
        audio.playSafeZoneEnter();
      } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        currentLaneRef.current = Math.min(1, currentLaneRef.current + 1);
        audio.playSafeZoneEnter();
      } else if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
        if (!keyboardJumpRef.current) {
          keyboardJumpRef.current = true;
          audio.playHighScore();
          // Reset jumping state after countdown
          setTimeout(() => {
            keyboardJumpRef.current = false;
          }, 850);
        }
      } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        keyboardSquatRef.current = true;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        keyboardSquatRef.current = false;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isPlaying]);

  // Main high-performance Runner calculations Loop
  useEffect(() => {
    if (!isPlaying) return;

    let animFrame: number;
    let lastTime = performance.now();

    const loop = (time: number) => {
      const dt = Math.min(0.05, (time - lastTime) / 1000);
      lastTime = time;

      const state = stateRef.current;
      state.timeElapsed += dt;

      // Slowly rise background lava line purely for environmental tension
      const levelPercent = Math.max(45, 98 - (state.timeElapsed * 0.45));
      setLavaLevel(levelPercent);

      // Handle invincible grace period
      if (gracePeriodRef.current > 0) {
        gracePeriodRef.current -= dt;
        setGraceCountdown(Math.ceil(gracePeriodRef.current));
      } else {
        setGraceCountdown(0);
      }

      // 1. CONTROL HARMONIZATION SCHEME
      // We detect the lane based on the player's horizontal coordinate (playerXRef.current)
      const currentBodyX = playerXRef.current;
      const bodyLane = currentBodyX < 36 ? -1 : currentBodyX > 64 ? 1 : 0;
      const elapsedSinceKeyPress = Date.now() - lastKeyPressTimeRef.current;

      // Event-driven state changes (any intentional side-step or lean instantly changes lanes)
      if (bodyLane !== lastBodyLaneRef.current) {
        currentLaneRef.current = bodyLane;
        lastBodyLaneRef.current = bodyLane;
        audio.playSafeZoneEnter();
      }
      // Absolute positioning alignment fallback when playing camera-only
      else if (elapsedSinceKeyPress > 1000 && currentLaneRef.current !== bodyLane) {
        currentLaneRef.current = bodyLane;
        audio.playSafeZoneEnter();
      }

      // Check final active states from synced refs
      const activeJumping = isPoseJumpingRef.current || keyboardJumpRef.current;
      const activeSquatting = isPoseSquattingRef.current || keyboardSquatRef.current;

      state.isJumping = activeJumping;
      state.isSquatting = activeSquatting;

      // Tick continuous running survival points
      state.score += Math.round(12 * dt * state.combo);

      if (state.score > state.highScore) {
        state.score = Math.round(state.score);
        state.highScore = state.score;
        localStorage.setItem('floor_lava_hs', String(state.score));
      }

      // Progressively increase game pace over survival time!
      speedScaleRef.current = 1.0 + (state.timeElapsed * 0.024);
      const spawnFrequency = Math.max(1.1, 3.2 - (state.timeElapsed * 0.05));

      if (Date.now() - lastSpawnTimeRef.current > spawnFrequency * 1000) {
        if (state.timeElapsed > 1.5) {
          spawnObstacleRunner();
          lastSpawnTimeRef.current = Date.now();
        }
      }

      // Update position of active 3-lane obstacles
      setObstacles((prev) => {
        const remaining: RunnerObstacle[] = [];
        
        for (const o of prev) {
          const obs = o as RunnerObstacle;
          
          // Calculate moving translation along the Z towards player (player is located at Z=0)
          const nextZ = obs.z + obs.speed * dt;
          
          if (nextZ > 4.5) {
            // Reached out of view safely, clear obstacle space
            continue;
          }

          let passed = obs.passed;

          // Hit detection checks exactly inside the collision frame boundary Z around 0
          const inCollisionZone = Math.abs(nextZ - 0.0) < 0.65;
          const laneAligned = currentLaneRef.current === obs.lane;

          if (inCollisionZone && laneAligned && !passed) {
            let hit = false;
            
            if (gracePeriodRef.current <= 0) {
              if (obs.type === 'LOW_WALL') {
                if (!activeJumping) hit = true;
              } else if (obs.type === 'HIGH_BEAM') {
                if (!activeSquatting) hit = true;
              } else if (obs.type === 'VOLCANIC_ROCK') {
                // Indestructible wall hazard! Must avoid lane block completely!
                hit = true;
              }
            }

            if (hit) {
              passed = true;
              audio.playHit();
              state.lives = Math.max(0, state.lives - 1);
              state.combo = 1;

              if (state.lives <= 0) {
                audio.playGameOver();
                onGameOver(state.score);
              }
            }
          }

          // Successfully dodged score multiplier incrementation
          if (nextZ > 0.8 && !passed) {
            passed = true;
            state.combo += 1;
            state.score += 150 * state.combo;
            audio.playWarning(); // small point notice chime
          }

          remaining.push({ ...obs, z: nextZ, passed });
        }

        return remaining;
      });

      // Synchronize states to update the stats HUD panel
      setUiState({
        score: state.score,
        highScore: state.highScore,
        lives: state.lives,
        combo: state.combo,
        timeElapsed: Math.round(state.timeElapsed),
        isSafe: true, // Ground runner track is always a safe concrete surface!
        currentLane: currentLaneRef.current
      });

      animFrame = requestAnimationFrame(loop);
    };

    animFrame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animFrame);
  }, [isPlaying]);

  // Spawns highly dangerous obstacle categories along left, center, right lanes
  const spawnObstacleRunner = () => {
    const list: ObstacleType[] = ['LOW_WALL', 'HIGH_BEAM', 'VOLCANIC_ROCK'];
    const chosen = list[Math.floor(Math.random() * 3)];
    
    // Choose specific lane: -1 (Left), 0 (Center), or 1 (Right)
    const lane = Math.floor(Math.random() * 3) - 1;
    // Velocity scales with duration alive!
    const speed = (9.5 + Math.random() * 3.5) * speedScaleRef.current;

    const newObs: RunnerObstacle = {
      id: 'obs_' + Date.now() + Math.random(),
      type: chosen,
      x: 0, // satisfied
      y: 0, 
      width: 10,
      height: 10,
      speed,
      passed: false,
      lane,
      z: -34 // Spawn at long horizons
    };

    setObstacles((prev) => [...prev, newObs]);
  };

  return (
    <div 
      className="relative flex flex-col items-center bg-slate-950/80 rounded-2xl border border-slate-800 p-5 overflow-hidden w-full h-full min-h-[500px]"
      id="three-game-wrapper"
    >
      {/* Scenic Sunset Title matching the image layout */}
      <div className="w-full flex flex-col items-center select-none pt-2 pb-4" id="image-scenic-header">
        <h1 
          className="text-4xl md:text-5xl font-black text-center tracking-tight text-glow select-none uppercase text-[#bfe8f9] drop-shadow-[0_4px_6px_rgba(0,0,0,0.9)]" 
          style={{ 
            fontFamily: '"Impact", "Arial Black", "Montserrat", sans-serif',
            WebkitTextStroke: '2px #0a1128'
          }}
          id="title-the-floor-is-lava"
        >
          THE FLOOR IS LAVA
        </h1>
        <div className="w-24 h-1 bg-amber-500 rounded-full mt-1 opacity-80" />
      </div>

      {/* HUD Player Stats Grid */}
      <div className="w-full grid grid-cols-2 sm:grid-cols-4 gap-4 bg-slate-900/60 border border-slate-800 rounded-xl p-3 mb-4 select-none z-10" id="three-game-hud">
        <div className="text-left" id="hud-score">
          <span className="text-[10px] uppercase tracking-wider font-mono text-slate-500 font-bold block">SURVIVAL SCORE</span>
          <span className="font-sans font-extrabold text-slate-100 text-lg md:text-xl tracking-tight text-glow">
            {uiState.score} <span className="font-mono text-xs font-medium text-amber-400">PTS</span>
          </span>
        </div>

        <div className="text-left" id="hud-stability">
          <span className="text-[10px] uppercase tracking-wider font-mono text-slate-500 font-bold block">SURVIVOR LIVES</span>
          <div className="flex items-center gap-1 mt-1">
            {Array.from({ length: 3 }).map((_, idx) => (
              <span 
                key={idx} 
                className={`w-3.5 h-3.5 rounded-full transition-all ${
                  idx < uiState.lives 
                  ? 'bg-rose-500 shadow-md shadow-rose-500/50' 
                  : 'bg-slate-800'
                }`}
                id={`stability-dot-${idx}`}
              />
            ))}
          </div>
        </div>

        <div className="text-left" id="hud-combo">
          <span className="text-[10px] uppercase tracking-wider font-mono text-slate-500 font-bold block">MULTIPLIER STREAK</span>
          <span className="font-sans font-extrabold text-yellow-400 text-lg md:text-xl block">
            x{uiState.combo} <span className="text-[10px] text-slate-400 font-normal">SPEED</span>
          </span>
        </div>

        <div className="text-left" id="hud-time">
          <span className="text-[10px] uppercase tracking-wider font-mono text-slate-500 font-bold block">RUN DURATION</span>
          <span className="font-sans font-extrabold text-slate-100 text-lg md:text-xl block">
            {uiState.timeElapsed}s <span className="text-[10px] text-slate-400 font-normal">ELAPSED</span>
          </span>
        </div>
      </div>

      {/* R3F Canvas Container */}
      <div className="relative aspect-[16/9] w-full rounded-2xl overflow-hidden border-2 border-slate-800 shadow-2xl bg-[#0d1527]" id="three-canvas-frame">
        <Canvas
          shadows
          camera={{ position: [0, 1.4, 4.4], fov: 48 }}
          id="react-three-game-canvas"
        >
          {/* Beautiful Sunset Soft Ambience */}
          <ambientLight intensity={1.3} />
          <directionalLight
            castShadow
            position={[4, 12, 6]}
            intensity={2.5}
            shadow-mapSize={[1024, 1024]}
          />
          <pointLight position={[0, -2, -10]} intensity={4.5} color="#ff5500" distance={25} />

          {/* 3-Lane Runway Bridge Ground */}
          <HighwayTrack isPlaying={isPlaying} />

          {/* Active Cyber Runner Character */}
          <PlayerMesh
            currentLane={uiState.currentLane}
            isJumping={isPoseJumping || keyboardJumpRef.current}
            isSquatting={isPoseSquatting || keyboardSquatRef.current}
            isPlaying={isPlaying}
          />

          {/* Bubbling Lava Ocean beneath the track */}
          <LavaPlane lavaLevel={lavaLevel} />

          {/* Low-Poly Mediterranean Villas framing both shores */}
          <ScenicHouses />

          {/* Beautiful Floating Wicker Hot Air Balloon */}
          <ScenicHotAirBalloon />

          {/* Active Lane Hurdles approaching */}
          <RunnerObstaclesGroup obstacles={obstacles} />
        </Canvas>

        {/* Lane indicators overlay helper bars at the bottom */}
        {isPlaying && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-slate-950/80 backdrop-blur-md px-4 py-2 border border-slate-800 rounded-xl text-xs font-semibold select-none pointer-events-none" id="lane-indicator-guides">
            <span className={`px-2.5 py-1 rounded-md font-mono ${uiState.currentLane === -1 ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-500'}`}>LEFT LANE</span>
            <span className={`px-2.5 py-1 rounded-md font-mono ${uiState.currentLane === 0 ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-500'}`}>CENTER LANE</span>
            <span className={`px-2.5 py-1 rounded-md font-mono ${uiState.currentLane === 1 ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-500'}`}>RIGHT LANE</span>
          </div>
        )}

        {/* Stand safely invitation countdown */}
        {isPlaying && graceCountdown > 0 && (
          <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center select-none pointer-events-none animate-fade-in" id="grace-overlay">
            <div className="bg-gradient-to-r from-orange-500/20 to-red-500/20 border border-amber-500/30 rounded-2xl p-6 max-w-sm">
              <span className="text-[10px] uppercase tracking-widest font-mono text-amber-400 font-bold block mb-1">SYSTEMS ALIGNING</span>
              <h2 className="text-4xl font-sans font-black text-white uppercase tracking-tight">GET READY!</h2>
              <p className="text-xs text-slate-300 mt-2">Running on elevated ground. Lean or use Keyboards to dodge hazards!</p>
              <div className="text-6xl font-black text-amber-400 font-mono mt-4 animate-ping">
                {graceCountdown}
              </div>
            </div>
          </div>
        )}

        {/* Real-time posture status tags */}
        {isPlaying && (
          <div className="absolute top-4 left-4 p-2 bg-slate-950/85 backdrop-blur-md border border-slate-800 rounded-lg flex items-center gap-2 select-none pointer-events-none" id="surface-status-indicator">
            <Shield className="w-4 h-4 text-emerald-400 animate-pulse" />
            <div className="text-left">
              <span className="text-[9px] text-slate-500 block leading-none font-bold uppercase">RUNNING SURFACE</span>
              <span className="text-[10px] font-mono font-bold text-emerald-400">
                ELEVATED HIGHWAY ACTIVE
              </span>
            </div>
          </div>
        )}

        {/* Invulnerability Status */}
        {isPlaying && graceCountdown > 0 && (
          <div className="absolute bottom-4 left-4 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-mono py-1 px-2.5 rounded-lg flex items-center gap-1.5 animate-pulse select-none" id="invulnerable-shield-tag">
            <ShieldAlert className="w-3.5 h-3.5" />
            CORE INVULNERABLE ({graceCountdown}s)
          </div>
        )}

        {/* Hazard warning alerts */}
        {isPlaying && graceCountdown === 0 && (
          <div className="absolute top-4 right-4 bg-orange-500/15 border border-orange-500/30 text-orange-400 text-[10px] font-mono py-1.5 px-3 rounded-lg flex items-center gap-1.5 animate-pulse select-none animate-bounce" id="lava-critical-alert">
            <AlertTriangle className="w-3.5 h-3.5" />
            DODGE COOLDOWN HAZARDS NOW!
          </div>
        )}

        {/* Main Title Menu start screen */}
        {!isPlaying && (
          <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center select-none" id="menu-overlay">
            <div className="p-4 rounded-full bg-orange-500/10 border border-orange-500/20 mb-4 animate-pulse">
              <RotateCcw className="w-12 h-12 text-orange-400 transform rotate-45" />
            </div>

            <h3 className="font-sans font-black text-2xl md:text-3xl tracking-tight text-white uppercase bg-gradient-to-r from-orange-400 to-yellow-400 bg-clip-text text-transparent">
              THE FLOOR IS LAVA RUNNER
            </h3>
            <p className="text-xs text-slate-400 mt-2 max-w-sm leading-relaxed mb-6">
              Dodge left, center, or right using keyboard <b className="text-yellow-400">A/D</b> or <b className="text-yellow-400">body leans</b> in front of your camera! Use <b className="text-cyan-400">Space to jump</b> or <b className="text-cyan-400">S to squat</b>!
            </p>

            <button
              onClick={handleStart}
              className="px-6 py-3 font-bold rounded-xl text-slate-950 bg-gradient-to-r from-orange-500 to-yellow-500 hover:brightness-110 active:scale-95 transition-all shadow-md flex items-center gap-2 cursor-pointer text-sm font-sans"
              id="start-3d-button"
            >
              <Play className="w-4 h-4 fill-slate-950" />
              PLAY RUNNER 3D
            </button>
          </div>
        )}
      </div>

      {/* Controller Guide bar */}
      <div className="flex items-center gap-2 text-[10px] text-slate-500 leading-relaxed font-sans mt-3 select-none text-left w-full pl-1" id="three-control-info">
        <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <span>
          <b className="text-slate-400">HYBRID CONTROLS:</b> 
          <span className="text-yellow-400 font-bold"> A/D / Leans</span> changes lanes. 
          <span className="text-cyan-400 font-bold"> Space / Up / Jump</span> to jump over Ground Laser Hurdles. 
          <span className="text-teal-400 font-bold"> S / Down / Squat</span> to duck under Overhead Beams. Shift lanes to avoid <span className="text-rose-400 font-bold">Indestructible Obsidian Towers!</span>
        </span>
      </div>
    </div>
  );
}
