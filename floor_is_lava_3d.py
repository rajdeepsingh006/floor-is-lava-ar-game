#!/usr/bin/env python3
"""
Floor is Lava - 3D Body-Controlled Game
========================================
Uses webcam pose detection to control a 3D avatar in Ursina.
Jump over low walls, squat under high beams.

Requirements:
    pip install ursina opencv-python mediapipe numpy
"""

import cv2
import numpy as np
import mediapipe as mp
import threading
import math
import time
import random
from enum import Enum
from ursina import *

# ============================================================================
# 1. GAME CONFIGURATION
# ============================================================================
SCREEN_SIZE = (1280, 720)
PLAYER_START_Y = 1.5
GRAVITY = 0.5
JUMP_VELOCITY = 0.3
SQUAT_ANGLE_THRESHOLD = 120   # degrees
JUMP_VELOCITY_THRESHOLD = 0.05  # hip upward velocity
OBSTACLE_SPEED_BASE = 2.0
SPAWN_INTERVAL_BASE = 2.0
DIFFICULTY_RAMP_RATE = 0.02    # per second

# ============================================================================
# 2. POSE DETECTION & AVATAR CONTROLLER (Threaded)
# ============================================================================
mp_pose = mp.solutions.pose
pose = mp_pose.Pose(min_detection_confidence=0.7, min_tracking_confidence=0.7)

class PoseController:
    def __init__(self):
        self.cap = cv2.VideoCapture(0)
        if not self.cap.isOpened():
            print("ERROR: Cannot open webcam")
            exit()
        self.running = True
        self.landmarks = None
        self.hip_y = 0.5          # normalized 0-1 (0=top)
        self.is_jumping = False
        self.is_squatting = False
        self.neutral_hip_y = None  # calibrated standing height
        
    def start(self):
        self.thread = threading.Thread(target=self._update, daemon=True)
        self.thread.start()
        
    def _update(self):
        while self.running:
            ret, frame = self.cap.read()
            if not ret:
                continue
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = pose.process(rgb)
            if results.pose_landmarks:
                self.landmarks = results.pose_landmarks.landmark
                # Get hip Y (average of left and right)
                lh = self.landmarks[mp_pose.PoseLandmark.LEFT_HIP].y
                rh = self.landmarks[mp_pose.PoseLandmark.RIGHT_HIP].y
                self.hip_y = (lh + rh) / 2.0
                
                # Jump detection from vertical velocity
                if hasattr(self, '_prev_hip_y'):
                    velocity = self._prev_hip_y - self.hip_y
                    self.is_jumping = (velocity > JUMP_VELOCITY_THRESHOLD)
                self._prev_hip_y = self.hip_y
                
                # Squat detection from knee angle
                left_knee = self._angle_3d(
                    self.landmarks[mp_pose.PoseLandmark.LEFT_HIP],
                    self.landmarks[mp_pose.PoseLandmark.LEFT_KNEE],
                    self.landmarks[mp_pose.PoseLandmark.LEFT_ANKLE]
                )
                right_knee = self._angle_3d(
                    self.landmarks[mp_pose.PoseLandmark.RIGHT_HIP],
                    self.landmarks[mp_pose.PoseLandmark.RIGHT_KNEE],
                    self.landmarks[mp_pose.PoseLandmark.RIGHT_ANKLE]
                )
                knee_angle = min(left_knee, right_knee)
                self.is_squatting = (knee_angle < SQUAT_ANGLE_THRESHOLD)
            else:
                self.landmarks = None
                
    def _angle_3d(self, a, b, c):
        """Calculate angle (degrees) between three 3D points."""
        ab = np.array([a.x - b.x, a.y - b.y, a.z - b.z])
        cb = np.array([c.x - b.x, c.y - b.y, c.z - b.z])
        cos = np.dot(ab, cb) / (np.linalg.norm(ab) * np.linalg.norm(cb))
        return math.degrees(math.acos(np.clip(cos, -1.0, 1.0)))
    
    def calibrate(self):
        """Wait 2 seconds and record neutral hip Y as reference."""
        print("Calibrating: Stand still and look at camera...")
        time.sleep(2.0)
        if self.landmarks:
            self.neutral_hip_y = self.hip_y
            print(f"Calibrated: neutral hip Y = {self.neutral_hip_y:.2f}")
        else:
            self.neutral_hip_y = 0.5
            print("Calibration failed, using default.")
    
    def get_avatar_y(self):
        """Map hip Y to 3D world Y (0=floor, 2=ceiling)."""
        if self.neutral_hip_y is None:
            return PLAYER_START_Y
        # Lower hip Y (player jumps) -> higher avatar Y
        delta = self.neutral_hip_y - self.hip_y
        avatar_y = PLAYER_START_Y + delta * 2.5
        return max(0.5, min(avatar_y, 3.0))
    
    def destroy(self):
        self.running = False
        self.cap.release()

# ============================================================================
# 3. OBSTACLE MANAGER
# ============================================================================
class ObstacleType(Enum):
    LOW_WALL = 1   # requires jump
    HIGH_BEAM = 2  # requires squat

class Obstacle(Entity):
    def __init__(self, obs_type, speed, **kwargs):
        self.obs_type = obs_type
        self.speed = speed
        if obs_type == ObstacleType.LOW_WALL:
            model = 'cube'
            color = color.rgb(255, 80, 0)  # lava orange
            scale = (1.2, 0.4, 1.2)
            y = 0.2
            collider = 'box'
        else:
            model = 'cube'
            color = color.rgb(100, 200, 255)  # icy blue
            scale = (1.2, 1.2, 1.2)
            y = 1.2
            collider = 'box'
        super().__init__(model=model, color=color, scale=scale, y=y,
                         collider=collider, **kwargs)
        self.x = 12   # start at far right
        self.z = 0
        
    def update(self):
        self.x -= self.speed * time.dt
        if self.x < -8:
            destroy(self)
            return True  # removed
        return False

class ObstacleManager:
    def __init__(self, game):
        self.game = game
        self.obstacles = []
        self.spawn_timer = 0
        
    def update(self):
        # Spawning
        self.spawn_timer -= time.dt
        if self.spawn_timer <= 0:
            self._spawn_obstacle()
            interval = max(0.8, SPAWN_INTERVAL_BASE / self.game.score_manager.difficulty)
            self.spawn_timer = interval
            
        # Update existing obstacles
        for obs in self.obstacles[:]:
            removed = obs.update()
            if removed:
                self.obstacles.remove(obs)
            else:
                # Collision detection: when obstacle is near player (x near 0)
                if abs(obs.x - self.game.player.x) < 1.2:
                    self._check_collision(obs)
                    
    def _spawn_obstacle(self):
        obs_type = random.choice([ObstacleType.LOW_WALL, ObstacleType.HIGH_BEAM])
        speed = OBSTACLE_SPEED_BASE * self.game.score_manager.difficulty
        obs = Obstacle(obs_type, speed)
        self.obstacles.append(obs)
        
    def _check_collision(self, obs):
        if obs in self.obstacles:  # ensure still alive
            player_action_jump = self.game.pose_controller.is_jumping
            player_action_squat = self.game.pose_controller.is_squatting
            required_jump = (obs.obs_type == ObstacleType.LOW_WALL)
            required_squat = (obs.obs_type == ObstacleType.HIGH_BEAM)
            
            success = False
            if required_jump and player_action_jump:
                success = True
            elif required_squat and player_action_squat:
                success = True
                
            if success:
                self.game.score_manager.add_score()
                # Remove obstacle after successful dodge
                destroy(obs)
                self.obstacles.remove(obs)
                # Play sound effect (placeholder)
                print("+ DODGE!")
            else:
                self.game.score_manager.damage()
                # Remove obstacle after failure (so it doesn't hit multiple times)
                destroy(obs)
                self.obstacles.remove(obs)
                print("OOF! -1 Life")

# ============================================================================
# 4. SCORE AND DIFFICULTY MANAGER
# ============================================================================
class ScoreManager:
    def __init__(self, game):
        self.game = game
        self.score = 0
        self.combo = 0
        self.lives = 3
        self.difficulty = 1.0
        self.time_alive = 0
        
    def add_score(self):
        self.combo += 1
        points = 10 * self.combo
        self.score += points
        print(f"Score: {self.score} (Combo x{self.combo})")
        
    def damage(self):
        self.lives -= 1
        self.combo = 0
        print(f"Lives left: {self.lives}")
        if self.lives <= 0:
            self.game.game_over()
            
    def update_difficulty(self, dt):
        self.time_alive += dt
        self.difficulty = 1.0 + self.time_alive * DIFFICULTY_RAMP_RATE
        self.difficulty = min(self.difficulty, 3.0)
        
    def reset(self):
        self.score = 0
        self.combo = 0
        self.lives = 3
        self.time_alive = 0
        self.difficulty = 1.0

# ============================================================================
# 5. MAIN GAME CLASS (Ursina Application)
# ============================================================================
class FloorIsLava3D(Ursina):
    def __init__(self):
        super().__init__()
        # Window setup
        window.title = 'Floor is Lava - 3D'
        window.size = SCREEN_SIZE
        window.fullscreen = False
        
        # Game state
        self.running = True
        self.game_over_flag = False
        self.pose_controller = PoseController()
        self.pose_controller.start()
        
        # 3D World
        self.setup_world()
        
        # Managers
        self.score_manager = ScoreManager(self)
        self.obstacle_manager = ObstacleManager(self)
        
        # Player avatar (simple cube for now)
        self.player = Entity(model='cube', color=color.cyan,
                             position=(0, PLAYER_START_Y, 0),
                             scale=0.8, collider='box')
        
        # Camera following (third-person)
        self.camera = EditorCamera(rotation_speed=0, enabled=False)
        self.camera.position = (0, 3, -8)
        self.camera.look_at(self.player)
        
        # UI Elements
        self.score_text = Text(text='Score: 0', position=(-0.85, 0.45), scale=2, origin=(0,0))
        self.combo_text = Text(text='Combo: x0', position=(-0.85, 0.38), scale=1.5, origin=(0,0), color=color.yellow)
        self.lives_text = Text(text='Lives: 3', position=(-0.85, 0.31), scale=1.5, origin=(0,0), color=color.red)
        self.timer_text = Text(text='Time: 0', position=(0.85, 0.45), scale=1.5, origin=(1,0))
        self.game_over_text = Text(text='', position=(0,0), scale=3, origin=(0,0), enabled=False)
        
        # Instructions
        Text(text='Jump over ORANGE walls | Squat under BLUE beams', position=(0, -0.45), scale=1, origin=(0,0))
        Text(text='Press R to restart | ESC to quit', position=(0, -0.5), scale=1, origin=(0,0))
        
        # Calibration step
        self.calibrate_player()
        
        # Start game loop
        self.start_game()
        
    def setup_world(self):
        # Ground
        ground = Entity(model='plane', texture='white_cube', scale=20, collider='box')
        ground.y = -0.5
        # Lava effect (animated texture or just color pulsating)
        self.lava_floor = Entity(model='plane', color=color.rgb(255, 50, 0), scale=(15,15), y=-0.4)
        # Simple safe zones (green platforms)
        for x in [-3, 0, 3]:
            platform = Entity(model='cube', color=color.green, scale=(1.5, 0.2, 1.5),
                              position=(x, -0.3, 1), collider='box')
        # Lighting
        self.light = DirectionalLight(y=2, rotation=(45, 45, 0))
        ambient_light = AmbientLight(color=color.rgba(100,100,100,0.5))
        
    def calibrate_player(self):
        # Show instruction on screen
        calib_text = Text(text='Calibrating... stand still!', position=(0,0.2), scale=2, origin=(0,0))
        invoke(self.pose_controller.calibrate, delay=0.1)
        invoke(destroy, calib_text, delay=2.5)
        
    def start_game(self):
        self.score_manager.reset()
        self.game_over_flag = False
        self.game_over_text.enabled = False
        
    def game_over(self):
        self.game_over_flag = True
        self.game_over_text.text = f'GAME OVER\nScore: {self.score_manager.score}\nPress R to restart'
        self.game_over_text.enabled = True
        self.running = False
        
    def restart(self):
        # Clear all obstacles
        for obs in self.obstacle_manager.obstacles:
            destroy(obs)
        self.obstacle_manager.obstacles.clear()
        self.score_manager.reset()
        self.start_game()
        self.running = True
        
    def update(self):
        if not self.running:
            return
            
        # Update difficulty over time
        self.score_manager.update_difficulty(time.dt)
        
        # Update pose data and move player avatar
        player_y = self.pose_controller.get_avatar_y()
        self.player.y = player_y
        
        # Add simple jump squash/stretch effect (optional)
        if self.pose_controller.is_jumping:
            self.player.scale = (0.9, 1.1, 0.9)
        elif self.pose_controller.is_squatting:
            self.player.scale = (1.1, 0.7, 1.1)
        else:
            self.player.scale = (0.8, 0.8, 0.8)
        
        # Update obstacles
        self.obstacle_manager.update()
        
        # Camera follow with smooth lag
        target_pos = (self.player.x, self.player.y + 1.5, -8)
        self.camera.position = lerp(self.camera.position, target_pos, 0.1)
        
        # Update HUD
        self.score_text.text = f'Score: {self.score_manager.score}'
        self.combo_text.text = f'Combo: x{self.score_manager.combo}'
        self.lives_text.text = f'Lives: {self.score_manager.lives}'
        self.timer_text.text = f'Time: {self.score_manager.time_alive:.1f}s'
        
        # Animate lava floor (pulsing red)
        intensity = (math.sin(time.time() * 3) + 1) / 2
        lava_color = color.rgb(255, int(50 + intensity * 100), 0)
        self.lava_floor.color = lava_color
        
    def input(self, key):
        if key == 'r' and self.game_over_flag:
            self.restart()
        elif key == 'escape':
            application.quit()
        elif key == 'c':
            self.calibrate_player()
            
    def on_destroy(self):
        self.pose_controller.destroy()

# ============================================================================
# 6. RUN THE GAME
# ============================================================================
if __name__ == '__main__':
    app = FloorIsLava3D()
    app.run()
