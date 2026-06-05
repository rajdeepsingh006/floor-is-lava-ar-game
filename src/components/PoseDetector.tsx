/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { CalibrationData, Landmark, PoseLandmarks } from '../types';
import { Camera, CameraOff, RefreshCw, Volume2, VolumeX, Keyboard, Zap, Play } from 'lucide-react';
import { audio } from '../utils/audio';

// MediaPipe Landmark Index Mapping
const LM = {
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
};

interface PoseDetectorProps {
  onPoseDetected: (data: {
    landmarks: PoseLandmarks | null;
    isJumping: boolean;
    isSquatting: boolean;
    activityStrength: number;
    playerX: number; // 0-100 position (relative horizontally)
  }) => void;
  calibration: CalibrationData;
  onCalibrationChange: (cal: CalibrationData) => void;
  useSimulator: boolean;
  onToggleSimulator: (val: boolean) => void;
  isPlaying?: boolean;
}

export default function PoseDetector({
  onPoseDetected,
  calibration,
  onCalibrationChange,
  useSimulator,
  onToggleSimulator,
  isPlaying = false
}: PoseDetectorProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [mediaPipeLoaded, setMediaPipeLoaded] = useState<boolean>(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [isCalibrating, setIsCalibrating] = useState<boolean>(false);
  const [calibrationCountdown, setCalibrationCountdown] = useState<number>(0);
  const [muted, setMuted] = useState<boolean>(false);

  // Calibration history
  const calibrationFramesRef = useRef<number[]>([]);
  const autoCalibFramesRef = useRef<number[]>([]);
  const isAutoCalibratedRef = useRef<boolean>(false);

  // Jump noise dampening velocity buffers
  const hipYHistoryRef = useRef<number[]>([]);
  const lastJumpTimeRef = useRef<number>(0);
  const isJumpingRef = useRef<boolean>(false);
  const prevIsPlaying = useRef<boolean>(false);

  // Simulation controls state (when no camera / user keyboard test)
  const [simState, setSimState] = useState({
    x: 50, // center
    isJumping: false,
    isSquatting: false,
    jumpProgress: 0,
    squatProgress: 0,
  });

  const simRef = useRef(simState);
  simRef.current = simState;

  // Track key pressed for movements
  const keysPressed = useRef<{ [key: string]: boolean }>({});

  // Angle calculator
  const calculateAngle = (
    p1: Landmark,
    p2: Landmark,
    p3: Landmark
  ): number => {
    const rads = Math.atan2(p3.y - p2.y, p3.x - p2.x) - Math.atan2(p1.y - p2.y, p1.x - p2.x);
    let angle = Math.abs((rads * 180.0) / Math.PI);
    if (angle > 180.0) {
      angle = 360.0 - angle;
    }
    return angle;
  };

  // Helper check whether MediaPipe script globals loaded
  useEffect(() => {
    const checkMediaPipe = () => {
      if ((window as any).Pose && (window as any).Camera) {
        setMediaPipeLoaded(true);
      } else {
        setTimeout(checkMediaPipe, 500);
      }
    };
    checkMediaPipe();
  }, []);

  // Keyboard controls listener (Runs always to update state or simulation state)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      keysPressed.current[e.key] = true;

      if (!useSimulator) return;

      if (e.key === ' ' || e.key === 'ArrowUp' || k === 'w') {
        if (!simRef.current.isJumping) {
          audio.playJump();
          setSimState(prev => ({ ...prev, isJumping: true, jumpProgress: 100 }));
        }
      }
      if (e.key === 'ArrowDown' || k === 's') {
        if (!simRef.current.isSquatting) {
          audio.playSquat();
          setSimState(prev => ({ ...prev, isSquatting: true }));
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      delete keysPressed.current[e.key];

      if (!useSimulator) return;

      if (e.key === 'ArrowDown' || k === 's') {
        setSimState(prev => ({ ...prev, isSquatting: false }));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [useSimulator]);

  // Simulation Loop Updater
  useEffect(() => {
    if (!useSimulator) return;

    let animId: number;
    const updateSim = () => {
      let dx = 0;
      if (keysPressed.current['ArrowLeft'] || keysPressed.current['a']) dx -= 1.2;
      if (keysPressed.current['ArrowRight'] || keysPressed.current['d']) dx += 1.2;

      setSimState(prev => {
        let nextJumpProgress = prev.jumpProgress;
        let nextIsJumping = prev.isJumping;

        if (prev.isJumping) {
          nextJumpProgress -= 6; // gravity arc simulation
          if (nextJumpProgress <= 0) {
            nextJumpProgress = 0;
            nextIsJumping = false;
          }
        }

        const nextX = Math.max(10, Math.min(90, prev.x + dx));
        return {
          ...prev,
          x: nextX,
          isJumping: nextIsJumping,
          jumpProgress: nextJumpProgress
        };
      });

      // Mock Pose landmarks when utilizing keyboard simulation
      const mockJoints: PoseLandmarks = {};
      // Use simState metrics to offset landmarks visually
      const jumpYOffset = (simRef.current.jumpProgress > 0) ? -Math.sin((simRef.current.jumpProgress / 100) * Math.PI) * 0.25 : 0;
      const squatYOffset = simRef.current.isSquatting ? 0.15 : 0;
      const baseCenterY = 0.5 + jumpYOffset + squatYOffset;
      const baseCenterX = simRef.current.x / 100;

      // Populate mock locations
      mockJoints[LM.LEFT_SHOULDER] = { x: baseCenterX - 0.08, y: baseCenterY - 0.2, z: 0 };
      mockJoints[LM.RIGHT_SHOULDER] = { x: baseCenterX + 0.08, y: baseCenterY - 0.2, z: 0 };
      mockJoints[LM.LEFT_ELBOW] = { x: baseCenterX - 0.15, y: baseCenterY - 0.12, z: 0 };
      mockJoints[LM.RIGHT_ELBOW] = { x: baseCenterX + 0.15, y: baseCenterY - 0.12, z: 0 };
      mockJoints[LM.LEFT_WRIST] = { x: baseCenterX - 0.18, y: baseCenterY - 0.02, z: 0 };
      mockJoints[LM.RIGHT_WRIST] = { x: baseCenterX + 0.18, y: baseCenterY - 0.02, z: 0 };
      
      mockJoints[LM.LEFT_HIP] = { x: baseCenterX - 0.06, y: baseCenterY, z: 0 };
      mockJoints[LM.RIGHT_HIP] = { x: baseCenterX + 0.06, y: baseCenterY, z: 0 };
      
      // knees bend outwards during squat
      const kneeOffsetX = simRef.current.isSquatting ? 0.12 : 0.06;
      mockJoints[LM.LEFT_KNEE] = { x: baseCenterX - kneeOffsetX, y: baseCenterY + 0.18, z: 0 };
      mockJoints[LM.RIGHT_KNEE] = { x: baseCenterX + kneeOffsetX, y: baseCenterY + 0.18, z: 0 };
      
      mockJoints[LM.LEFT_ANKLE] = { x: baseCenterX - 0.06, y: baseCenterY + 0.35 - (simRef.current.isJumping ? 0.1 : 0), z: 0 };
      mockJoints[LM.RIGHT_ANKLE] = { x: baseCenterX + 0.06, y: baseCenterY + 0.35 - (simRef.current.isJumping ? 0.1 : 0), z: 0 };

      onPoseDetected({
        landmarks: mockJoints,
        isJumping: simRef.current.isJumping,
        isSquatting: simRef.current.isSquatting,
        activityStrength: dx !== 0 || simRef.current.isJumping || simRef.current.isSquatting ? 70 : 10,
        playerX: simRef.current.x,
      });

      // Draw simulator animation onto Canvas
      drawPoseOnCanvas(mockJoints, null);

      animId = requestAnimationFrame(updateSim);
    };
    
    animId = requestAnimationFrame(updateSim);
    return () => cancelAnimationFrame(animId);
  }, [useSimulator]);

  // MediaPipe solution initializer (Webcam feed execution)
  useEffect(() => {
    if (useSimulator || !mediaPipeLoaded || !cameraActive) return;

    let active = true;
    let cameraInstance: any = null;
    let poseInstance: any = null;

    const startCameraAndPose = async () => {
      try {
        if (!videoRef.current) return;

        // Request webcam access
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, frameRate: 30 }
        });

        if (!active) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        videoRef.current.srcObject = stream;
        try {
          await videoRef.current.play();
        } catch (playErr) {
          console.warn("Webcam video play interrupted or aborted:", playErr);
        }

        // Instantiate MediaPipe Pose
        const mpPoseGlobal = (window as any).Pose;
        poseInstance = new mpPoseGlobal({
          locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
        });

        poseInstance.setOptions({
          modelComplexity: 0, // 0 for fast mobile-friendly latency, 1 for middle
          smoothLandmarks: true,
          enableSegmentation: false,
          minDetectionConfidence: 0.55,
          minTrackingConfidence: 0.55,
        });

        poseInstance.onResults((results: any) => {
          if (!active || !results) return;
          processRealTimePose(results);
        });

        // Create virtual camera wrapper
        const mpCameraGlobal = (window as any).Camera;
        cameraInstance = new mpCameraGlobal(videoRef.current, {
          onFrame: async () => {
            if (videoRef.current && active) {
              await poseInstance.send({ image: videoRef.current });
            }
          },
          width: 640,
          height: 480
        });

        await cameraInstance.start();
        setErrorText(null);
      } catch (err: any) {
        console.error("Camera/MediaPipe startup error:", err);
        setErrorText(err?.message || "Could not spin up the webcam device. Ensure permissions are resolved or activate Simulator Mode.");
        setCameraActive(false);
      }
    };

    startCameraAndPose();

    return () => {
      active = false;
      if (cameraInstance) {
        try {
          cameraInstance.stop();
        } catch (_) {}
      }
      if (poseInstance) {
        try {
          poseInstance.close();
        } catch (_) {}
      }
      if (videoRef.current) {
        try {
          videoRef.current.pause();
        } catch (_) {}
        if (videoRef.current.srcObject) {
          const stream = videoRef.current.srcObject as MediaStream;
          stream.getTracks().forEach(t => t.stop());
          videoRef.current.srcObject = null;
        }
      }
    };
  }, [useSimulator, cameraActive, mediaPipeLoaded]);

  // Turn off active camera when the game finishes/isPlaying transitions back to false
  useEffect(() => {
    if (prevIsPlaying.current && !isPlaying) {
      setCameraActive(false);
    }
    prevIsPlaying.current = isPlaying;
  }, [isPlaying]);

  // Reset tracking stats when camera activation state alters
  useEffect(() => {
    isAutoCalibratedRef.current = false;
    autoCalibFramesRef.current = [];
    hipYHistoryRef.current = [];
    isJumpingRef.current = false;
  }, [cameraActive]);

  // Handle detection calculations from actual MediaPipe output
  const processRealTimePose = (results: any) => {
    if (!results.poseLandmarks) {
      // Draw plain webcam frame if no landmarks detected
      drawPoseOnCanvas(null, results.image);
      return;
    }

    const marks: PoseLandmarks = results.poseLandmarks;
    
    // Landmark references
    const lHip = marks[LM.LEFT_HIP];
    const rHip = marks[LM.RIGHT_HIP];
    const lKnee = marks[LM.LEFT_KNEE];
    const rKnee = marks[LM.RIGHT_KNEE];
    const lAnkle = marks[LM.LEFT_ANKLE];
    const rAnkle = marks[LM.RIGHT_ANKLE];

    if (!lHip || !rHip) return;

    // Hip midpoint is vertical body focus anchor
    const midHipY = (lHip.y + rHip.y) / 2;
    const midHipX = (lHip.x + rHip.x) / 2;

    // Filter midHipY to ignore frame-to-frame jitter
    hipYHistoryRef.current.push(midHipY);
    if (hipYHistoryRef.current.length > 8) {
      hipYHistoryRef.current.shift();
    }

    // Smoothed midHipY (moving average of last 3 frames to avoid rapid frame jitters)
    let smoothedMidHipY = midHipY;
    if (hipYHistoryRef.current.length >= 3) {
      const lastThreeIdx = hipYHistoryRef.current.length - 3;
      const lastThreeSum = hipYHistoryRef.current.slice(lastThreeIdx).reduce((a, b) => a + b, 0);
      smoothedMidHipY = lastThreeSum / 3;
    }

    // Calculate vertical velocity (difference of first half vs last half of our buffer)
    let verticalVelocity = 0;
    if (hipYHistoryRef.current.length >= 6) {
      const firstHalfAvg = hipYHistoryRef.current.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
      const secondHalfAvg = hipYHistoryRef.current.slice(-3).reduce((a, b) => a + b, 0) / 3;
      // Greater values mean lower height. So if older is lower height (greater value) and newer is higher up (smaller value),
      // firstHalfAvg - secondHalfAvg is positive, indicating upward movement (upward velocity!)
      verticalVelocity = firstHalfAvg - secondHalfAvg;
    }

    // 1. Calibration logic
    if (isCalibrating) {
      calibrationFramesRef.current.push(midHipY);
      return;
    }

    // Instantly auto-calibrate on-the-fly if no calibration data is recorded yet!
    if (!calibration.isCalibrated && !isAutoCalibratedRef.current) {
      autoCalibFramesRef.current.push(midHipY);
      // Wait for 15 frames of steady skeleton data (about 0.5 seconds), then automatically lock the calibration baseline!
      if (autoCalibFramesRef.current.length >= 15) {
        isAutoCalibratedRef.current = true;
        const sum = autoCalibFramesRef.current.reduce((a, b) => a + b, 0);
        const autoMidY = sum / autoCalibFramesRef.current.length;
        onCalibrationChange({
          baseHipY: Number(autoMidY.toFixed(3)),
          jumpThreshold: 0.08,
          squatAngle: 125,
          isCalibrated: true
        });
        audio.playHighScore();
      }
    }

    // 2. Dynamic Jump Detection with Hysteresis and Noise Dampening Cooldown
    let isJumpingResult = false;
    if (calibration.isCalibrated) {
      const hipDifference = calibration.baseHipY - smoothedMidHipY;
      const triggerThreshold = calibration.jumpThreshold;
      const releaseThreshold = calibration.jumpThreshold * 0.6; // lower release point prevents bouncing triggers
      const now = Date.now();

      if (isJumpingRef.current) {
        if (hipDifference > releaseThreshold) {
          isJumpingResult = true;
        } else {
          isJumpingRef.current = false;
        }
      } else {
        // Enforce cooldown to prevent double triggering, and must be moving upwards velocity-wise
        if (hipDifference > triggerThreshold && verticalVelocity > 0.005 && (now - lastJumpTimeRef.current) > 400) {
          isJumpingResult = true;
          isJumpingRef.current = true;
          lastJumpTimeRef.current = now;
        }
      }
    }

    // 3. Squat detection. Calculate knee range angles
    let isSquattingResult = false;
    let avgKneeAngle = 180;
    if (lKnee && lAnkle && rKnee && rAnkle) {
      const leftAngle = calculateAngle(lHip, lKnee, lAnkle);
      const rightAngle = calculateAngle(rHip, rKnee, rAnkle);
      avgKneeAngle = (leftAngle + rightAngle) / 2;

      if (avgKneeAngle < calibration.squatAngle) {
        isSquattingResult = true;
      }
    }

    // Horizontal position translated to game coordinate grid
    const playerX = Math.round((1 - midHipX) * 100); // Inverse horizontal mirroring

    onPoseDetected({
      landmarks: marks,
      isJumping: isJumpingResult,
      isSquatting: isSquattingResult,
      activityStrength: Math.round(avgKneeAngle ? Math.max(0, 180 - avgKneeAngle) : 10),
      playerX: Math.max(10, Math.min(90, playerX)),
    });

    drawPoseOnCanvas(marks, results.image);
  };

  // Canvas painting
  const drawPoseOnCanvas = (landmarks: PoseLandmarks | null, webcamImage: HTMLVideoElement | null) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Reset layout
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw background video if applicable
    if (webcamImage) {
      // Mirror horizontal coordinates to look like reflections
      ctx.save();
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(webcamImage, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    } else {
      // Styled retro vector grid for simulator mode/calibration search
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;
      for (let i = 0; i < canvas.width; i += 32) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, canvas.height);
        ctx.stroke();
      }
      for (let j = 0; j < canvas.height; j += 32) {
        ctx.beginPath();
        ctx.moveTo(0, j);
        ctx.lineTo(canvas.width, j);
        ctx.stroke();
      }
    }

    // If no body detected, show a search icon boundary
    if (!landmarks) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 2;
      ctx.strokeRect(30, 30, canvas.width - 60, canvas.height - 60);

      ctx.fillStyle = '#f43f5e';
      ctx.font = 'bold 14px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('STAND IN CAM PREVIEW...', canvas.width / 2, canvas.height / 2 - 10);
      ctx.font = '10px "Inter", sans-serif';
      ctx.fillText('Searching for player body skeletal landmarks', canvas.width / 2, canvas.height / 2 + 15);
      return;
    }

    // Draw calibrated Standing Line
    if (calibration.isCalibrated) {
      const calLineY = calibration.baseHipY * canvas.height;
      ctx.strokeStyle = 'rgba(234, 179, 8, 0.4)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 4]);
      ctx.beginPath();
      ctx.moveTo(0, calLineY);
      ctx.lineTo(canvas.width, calLineY);
      ctx.stroke();
      ctx.setLineDash([]);
      
      ctx.fillStyle = 'rgba(234, 179, 8, 0.9)';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`STAND LEVEL (${Math.round(calibration.baseHipY * 100)}%)`, canvas.width - 15, calLineY - 6);
    }

    // Draw actual overlay lines connecting bones
    const drawLine = (pIdx1: number, pIdx2: number, color: string, thickness: number) => {
      const pt1 = landmarks[pIdx1];
      const pt2 = landmarks[pIdx2];
      if (pt1 && pt2 && (pt1.visibility === undefined || pt1.visibility > 0.45) && (pt2.visibility === undefined || pt2.visibility > 0.45)) {
        // Horizontally mirror coordinate positions of real webcam to reflect
        const x1 = webcamImage ? (1 - pt1.x) * canvas.width : pt1.x * canvas.width;
        const y1 = pt1.y * canvas.height;
        const x2 = webcamImage ? (1 - pt2.x) * canvas.width : pt2.x * canvas.width;
        const y2 = pt2.y * canvas.height;

        ctx.strokeStyle = color;
        ctx.lineWidth = thickness;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    };

    // Determine current color themes based on jumping or squatting highlights
    const isJumping = simRef.current.isJumping || (calibration.isCalibrated && landmarks[LM.LEFT_HIP] && (calibration.baseHipY - (landmarks[LM.LEFT_HIP].y + landmarks[LM.RIGHT_HIP].y) / 2 > calibration.jumpThreshold));
    const isSquatting = simRef.current.isSquatting || (landmarks[LM.LEFT_KNEE] && calculateAngle(landmarks[LM.LEFT_HIP], landmarks[LM.LEFT_KNEE], landmarks[LM.LEFT_ANKLE]) < calibration.squatAngle);

    let boneColor = '#06b6d4'; // neon cyan default
    if (isJumping) boneColor = '#eab308'; // glowing gold jump
    if (isSquatting) boneColor = '#ec4899'; // bubblegum pink squat

    // Draw skeleton joints
    // Shoulder connector
    drawLine(LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, boneColor, 4);
    // Left arm
    drawLine(LM.LEFT_SHOULDER, LM.LEFT_ELBOW, boneColor, 3);
    drawLine(LM.LEFT_ELBOW, LM.LEFT_WRIST, boneColor, 3);
    // Right arm
    drawLine(LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW, boneColor, 3);
    drawLine(LM.RIGHT_ELBOW, LM.RIGHT_WRIST, boneColor, 3);
    // Torso boundaries
    drawLine(LM.LEFT_SHOULDER, LM.LEFT_HIP, boneColor, 4);
    drawLine(LM.RIGHT_SHOULDER, LM.RIGHT_HIP, boneColor, 4);
    drawLine(LM.LEFT_HIP, LM.RIGHT_HIP, boneColor, 4);
    // Left leg
    drawLine(LM.LEFT_HIP, LM.LEFT_KNEE, boneColor, 3);
    drawLine(LM.LEFT_KNEE, LM.LEFT_ANKLE, boneColor, 3);
    // Right leg
    drawLine(LM.RIGHT_HIP, LM.RIGHT_KNEE, boneColor, 3);
    drawLine(LM.RIGHT_KNEE, LM.RIGHT_ANKLE, boneColor, 3);

    // Draw joint particles/rings
    Object.keys(LM).forEach((key) => {
      const idx = (LM as any)[key];
      const pt = landmarks[idx];
      if (pt && (pt.visibility === undefined || pt.visibility > 0.45)) {
        const x = webcamImage ? (1 - pt.x) * canvas.width : pt.x * canvas.width;
        const y = pt.y * canvas.height;

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = boneColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.stroke();
      }
    });

    // Special pose status texts
    if (isJumping) {
      ctx.fillStyle = '#eab308';
      ctx.font = 'bold 20px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('▲ JUMP AIRBORNE ▲', canvas.width / 2, 45);
    } else if (isSquatting) {
      ctx.fillStyle = '#ec4899';
      ctx.font = 'bold 20px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('▼ SQUAT MODE ▼', canvas.width / 2, 45);
    }
  };

  // Calibration activator sequence
  const startCalibrationSequence = () => {
    if (useSimulator) {
      // Automatic quick mock calibration for simulator
      onCalibrationChange({
        baseHipY: 0.5,
        jumpThreshold: 0.08,
        squatAngle: 125,
        isCalibrated: true,
      });
      audio.playHighScore();
      return;
    }

    if (!cameraActive) {
      setErrorText("Camera must be active to perform calibration standing calculations!");
      return;
    }

    setIsCalibrating(true);
    setCalibrationCountdown(3);
    calibrationFramesRef.current = [];
  };

  // Countdown clock effect for camera calibration
  useEffect(() => {
    if (!isCalibrating || calibrationCountdown <= 0) return;

    const t = setTimeout(() => {
      setCalibrationCountdown(prev => {
        if (prev === 1) {
          // Finalize measurements inside interval
          const frames = calibrationFramesRef.current;
          if (frames.length > 0) {
            const sum = frames.reduce((a, b) => a + b, 0);
            const averageHipLine = sum / frames.length;

            onCalibrationChange({
              baseHipY: Number(averageHipLine.toFixed(3)),
              jumpThreshold: 0.08, // vertical jump tolerance
              squatAngle: 125,     // standard angle
              isCalibrated: true
            });

            audio.playHighScore();
          } else {
            setErrorText("No skeletal frames captured during calibration countdown. Adjust lighting and ensure full body is visible.");
          }
          setIsCalibrating(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearTimeout(t);
  }, [isCalibrating, calibrationCountdown]);

  const toggleCameraOnOff = () => {
    onToggleSimulator(false);
    setCameraActive(prev => !prev);
  };

  const handleMuteAction = () => {
    const isNowMuted = audio.toggleMute();
    setMuted(isNowMuted);
  };

  return (
    <div className="flex flex-col gap-4 bg-slate-900/60 backdrop-blur-md rounded-2xl border border-slate-800 p-5 select-none">
      
      {/* Top Header Controls bar */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="font-sans font-medium text-slate-100 flex items-center gap-1.5 tracking-tight">
            <Zap className={`w-4 h-4 ${cameraActive ? 'text-cyan-400 animate-pulse' : 'text-amber-500'}`} />
            Skeletal Tracker Status
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {useSimulator 
              ? 'Webcam Simulated: Use Arrow Keys or WASD to navigate. Space to jump.' 
              : cameraActive 
                ? 'Webcam Mode Activated. Calibrate your standing height below.' 
                : 'Sensor off. Configure source below.'
            }
          </p>
        </div>

        {/* Action Toggle buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleMuteAction}
            className={`p-2 rounded-lg border transition-all cursor-pointer ${
              muted 
              ? 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20' 
              : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-700'
            }`}
            title="Toggle Synthesizer Sound Effects"
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>

          <button
            onClick={() => {
              onToggleSimulator(true);
              setCameraActive(false);
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
              useSimulator 
              ? 'bg-amber-500/20 border-amber-500 text-amber-300' 
              : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <Keyboard className="w-3.5 h-3.5" />
            Simulator
          </button>

          <button
            onClick={toggleCameraOnOff}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
              cameraActive 
              ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300' 
              : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {cameraActive ? <Camera className="w-3.5 h-3.5" /> : <CameraOff className="w-3.5 h-3.5" />}
            {cameraActive ? 'Turn Off Cam' : 'Activate Cam'}
          </button>
        </div>
      </div>

      {/* Visual Canvas output render context */}
      <div className="relative aspect-[4/3] w-full bg-slate-950 rounded-xl overflow-hidden border border-slate-800 self-center max-w-[640px]">
        {/* Real hidden video stream to supply MediaPipe */}
        <video
          ref={videoRef}
          style={{ display: 'none' }}
          width={640}
          height={480}
          playsInline
          muted
          onError={(e) => {
            console.warn("Hidden webcam video error:", e);
          }}
          onAbort={(e) => {
            console.warn("Hidden webcam video fetch aborted:", e);
          }}
        />

        {/* Dynamic canvas drawing layer */}
        <canvas
          ref={canvasRef}
          width={640}
          height={480}
          className="w-full h-full object-cover transform scale-x-100"
        />

        {/* Response indicator overlays during standing calibration */}
        {isCalibrating && (
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center text-center">
            <span className="font-sans font-bold text-yellow-400 text-8xl animate-bounce mb-2">
              {calibrationCountdown}
            </span>
            <p className="font-sans font-bold text-slate-100 text-lg">STAND PERFECTLY STILL</p>
            <p className="text-xs text-slate-400 mt-2 max-w-sm">
              We are recording your standby vertical body elevation line to measure physical jumps accurately!
            </p>
          </div>
        )}

        {/* Prompt if Webcams are active but MediaPipe is downloading models */}
        {cameraActive && !mediaPipeLoaded && (
          <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center p-6 text-center">
            <RefreshCw className="w-10 h-10 text-cyan-400 animate-spin mb-3" />
            <h4 className="font-sans font-medium text-slate-200">Retrieving AR Pose Models...</h4>
            <span className="text-xs text-slate-500 mt-1 max-w-xs block leading-relaxed">
              Downloading client-side coordinate classifiers. This operates entirely locally inside your browser and completes in moments.
            </span>
          </div>
        )}

        {/* Troubleshoot overlay if webcam failed to start due to iframe sandbox policy */}
        {errorText && !cameraActive && (
          <div className="absolute inset-0 bg-slate-950/95 flex flex-col items-center justify-center p-5 text-center select-none overflow-y-auto">
            <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-full mb-3 animate-pulse">
              <CameraOff className="w-8 h-8" />
            </div>
            
            <h4 className="font-sans font-bold text-slate-200 text-sm tracking-tight uppercase">
              Webcam Access Sandboxed or Blocked
            </h4>
            
            <p className="text-[11px] text-slate-400 mt-1.5 max-w-md leading-relaxed">
              Standard web browsers tightly restrict camera access within nested iframe builders for user privacy. Use these easy options to play:
            </p>

            <div className="mt-4 w-full max-w-sm flex flex-col gap-2.5">
              {/* Solution 1: Standalone tab */}
              <div className="bg-slate-900 border border-slate-800/80 rounded-xl p-3 text-left">
                <span className="text-[9px] font-bold text-amber-400 font-mono block uppercase tracking-wide">🏆 BEST SOLUTION (REAL AR CAM JUMPING)</span>
                <span className="text-[11px] text-slate-300 block mt-1 leading-normal">
                  Open the app directly in a <b>standalone browser tab</b>. This bypasses the nested sandbox context completely!
                </span>
                <button
                  onClick={() => {
                    try {
                      window.open(window.location.href, '_blank');
                    } catch (e) {
                      console.warn("Standard popup blocked, instructing user to use the UI icon");
                      alert("Please click the 'Open in new tab' icon at the top-right toolbar of the AI Studio preview pane!");
                    }
                  }}
                  className="mt-2.5 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-[10px] font-bold rounded-lg bg-orange-500 text-slate-950 hover:bg-orange-400 active:scale-[0.98] transition-all cursor-pointer font-sans"
                >
                  Launch App Standalone
                </button>
              </div>

              {/* Solution 2: Simulator fallback */}
              <div className="bg-slate-900 border border-slate-800/80 rounded-xl p-3 text-left">
                <span className="text-[9px] font-bold text-cyan-400 font-mono block uppercase tracking-wide">🎮 INSTANT ACTION</span>
                <span className="text-[11px] text-slate-300 block mt-1 leading-normal">
                  Toggle to <b>Simulator Mode</b> to instantly play the running course using standard desktop keyboard keys!
                </span>
                <button
                  onClick={() => {
                    onToggleSimulator(true);
                    setCameraActive(false);
                    setErrorText(null);
                  }}
                  className="mt-2.5 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-[10px] font-bold rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 active:scale-[0.98] transition-all cursor-pointer font-sans"
                >
                  <Keyboard className="w-3.5 h-3.5" />
                  Play with Keyboard Simulator
                </button>
              </div>
            </div>

            <div className="text-[10px] text-slate-600 mt-4 leading-normal max-w-xs font-mono truncate">
              System logs: {errorText}
            </div>
          </div>
        )}
      </div>

      {/* Footer calibration details line */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-950/50 rounded-xl p-3 border border-slate-800/70">
        <div className="flex items-center gap-3">
          <div className="text-left font-mono text-[11px] text-slate-400">
            <div>STANDING HEIGHT CALIBRATED: {' '}
              <span className={`font-bold ${calibration.isCalibrated ? 'text-emerald-400' : 'text-red-400'}`}>
                {calibration.isCalibrated ? `${Math.round(calibration.baseHipY * 100)}%` : 'PENDING'}
              </span>
            </div>
            <div className="mt-0.5">JUMP HEIGHT REQ OFFSET: <span className="text-yellow-400 font-bold">{calibration.jumpThreshold * 100}%</span></div>
          </div>
        </div>

        <button
          onClick={startCalibrationSequence}
          className="flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg text-slate-950 bg-gradient-to-r from-yellow-400 to-amber-500 hover:brightness-110 active:scale-95 transition-all shadow-md cursor-pointer shrink-0"
        >
          <Play className="w-3.5 h-3.5 fill-slate-950" />
          {calibration.isCalibrated ? 'Recalibrate Pose Line' : 'Start Auto Calibration'}
        </button>
      </div>

      {errorText && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-[11px] rounded-lg leading-relaxed text-left">
          <span className="font-bold">Pose Error:</span> {errorText}
        </div>
      )}
    </div>
  );
}
