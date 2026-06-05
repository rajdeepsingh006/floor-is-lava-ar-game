/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type GameScene = 'menu' | 'calibrate' | 'mapping' | 'playing' | 'gameover';

export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export interface PoseLandmarks {
  [index: number]: Landmark;
}

export interface CalibrationData {
  baseHipY: number;      // Calibrated standing vertical center (lower y is higher on screen)
  jumpThreshold: number; // Vertical offset difference needed to count a jump
  squatAngle: number;    // Knee bend angle below which a squat is counted (e.g., 125 degrees)
  isCalibrated: boolean;
}

export interface SafeZone {
  id: string;
  name: string;
  x: number;      // 0 - 100 percentage from left
  y: number;      // 0 - 100 percentage from top
  width: number;  // 0 - 100 width percentage
  height: number; // 0 - 100 height percentage
}

export type ObstacleType = 'LAVA_SURGE' | 'LOW_WALL' | 'HIGH_BEAM' | 'VOLCANIC_ROCK';

export interface Obstacle {
  id: string;
  type: ObstacleType;
  x: number;       // Horizontal position (0 to 100 from right to left)
  y: number;       // Vertical center position
  width: number;   // Visual width
  height: number;  // Visual height
  speed: number;   // Horizontal speed per second
  passed: boolean;
}

export interface PlayerState {
  score: number;
  highScore: number;
  lives: number;
  combo: number;
  timeElapsed: number;
  chestHeight: number; // normalized Y-coord
  isJumping: boolean;
  isSquatting: boolean;
  isInsideSafeZone: boolean;
  lastAction: 'JUMPED' | 'SQUATTED' | 'HIT' | 'SAFE_ZONE_ENTER' | 'COOLDOWN' | null;
  activityStrength: number; // Real-time value showing physical movement velocity
}

export interface HighScoreRecord {
  name: string;
  score: number;
  date: string;
}
