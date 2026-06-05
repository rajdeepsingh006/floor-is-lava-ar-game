#!/usr/bin/env python3
"""
3D "Floor is Lava" Game in Python
==================================
Libraries required:
    pip install ursina mediapipe opencv-python numpy

This game reads coordinate positions from your computer's webcam using MediaPipe Pose.
The player moves left and right in physical space to move their 3D avatar, jumping or 
squatting to dodge incoming high and low cyber hazards while staying raised safely in Safe Zones!

Author: Expert Game Developer
Date: June 2026
"""

from ursina import *
import cv2
import mediapipe as mp
import numpy as np
import threading
import time

# -----------------------------------------------------------------------------
# 1. Pose Tracker Controller (Runs in parallel background thread for high FPS)
# -----------------------------------------------------------------------------
class PoseTracker:
    def __init__(self):
        self.cap = None
        self.running = False
        self.mp_pose = mp.solutions.pose
        self.pose = self.mp_pose.Pose(min_detection_confidence=0.5, min_tracking_confidence=0.5)
        self.mp_draw = mp.solutions.drawing_utils
        
        # Shared kinetic variables
        self.player_x = 0.0          # Mapped to [-10, 10] horizontal coordinate space
        self.raw_hip_y = 0.7         # Raw vertical posture benchmark
        self.knee_angle = 180.0      # Angular knee joint flex
        self.is_jumping = False
        self.is_squatting = False
        
        # Calibration state metrics
        self.calibrated = False
        self.standing_hip_y = 0.7    # Default starting baseline
        self.jump_threshold = 0.08   # Vertical displacement height offset trigger
        
    def calculate_angle(self, a, b, c):
        """Calculate angle between hip (a), knee (b) and ankle (c)."""
        a = np.array(a)  # Hip
        b = np.array(b)  # Knee
        c = np.array(c)  # Ankle
        
        radians = np.arctan2(c[1]-b[1], c[0]-b[0]) - np.arctan2(a[1]-b[1], a[0]-b[0])
        angle = np.abs(radians * 180.0 / np.pi)
        
        if angle > 180.0:
            angle = 360.0 - angle
        return angle

    def start(self):
        self.running = True
        self.thread = threading.Thread(target=self.update, daemon=True)
        self.thread.start()

    def calibrate(self):
        """Saves current standing hip position to set relative triggers."""
        self.standing_hip_y = self.raw_hip_y
        self.calibrated = True
        print(f"[CALIBRATION DETECTED] Standing Hip Y baseline saved: {self.standing_hip_y:.3f}")

    def stop(self):
        self.running = False
        if self.cap:
            self.cap.release()
        cv2.destroyAllWindows()

    def update(self):
        # Open default computer camera
        self.cap = cv2.VideoCapture(0)
        if not self.cap.isOpened():
            print("[ERROR] Could not gain video access on webcam index 0.")
            return

        while self.running:
            ret, frame = self.cap.read()
            if not ret:
                time.sleep(0.01)
                continue

            frame = cv2.flip(frame, 1)  # Mirror frame for intuitive left/right controls
            h, w, c = frame.shape
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = self.pose.process(rgb_frame)

            if results.pose_landmarks:
                landmarks = results.pose_landmarks.landmark
                
                # Retrieve left and right hip landmarks to locate centroid midpoint
                l_hip = [landmarks[self.mp_pose.PoseLandmark.LEFT_HIP.value].x,
                         landmarks[self.mp_pose.PoseLandmark.LEFT_HIP.value].y]
                r_hip = [landmarks[self.mp_pose.PoseLandmark.RIGHT_HIP.value].x,
                         landmarks[self.mp_pose.PoseLandmark.RIGHT_HIP.value].y]
                
                hip_x = (l_hip[0] + r_hip[0]) / 2.0
                hip_y = (l_hip[1] + r_hip[1]) / 2.0

                # 1. Map hip_x to Ursina's platform bounds [-10, 10]
                # Inverse standard coordinates to preserve mirrored perspective movement
                self.player_x = (hip_x - 0.5) * 18.0
                self.raw_hip_y = hip_y

                # 2. Extract Knee coordinates to measure bending flex
                r_knee = [landmarks[self.mp_pose.PoseLandmark.RIGHT_KNEE.value].x,
                          landmarks[self.mp_pose.PoseLandmark.RIGHT_KNEE.value].y]
                r_ankle = [landmarks[self.mp_pose.PoseLandmark.RIGHT_ANKLE.value].x,
                           landmarks[self.mp_pose.PoseLandmark.RIGHT_ANKLE.value].y]
                
                self.knee_angle = self.calculate_angle(r_hip, r_knee, r_ankle)

                # 3. Handle posture triggers relative to calibrated standings
                if self.calibrated:
                    # MediaPipe Y goes top-to-bottom (0 = top of screen, 1 = bottom of screen)
                    # Jumping corresponds to a hip coordinate LESS than standing baseline
                    jump_bound = self.standing_hip_y - self.jump_threshold
                    if hip_y < jump_bound:
                        self.is_jumping = True
                    else:
                        self.is_jumping = False

                    # Squatting corresponds to deep knee bending contraction
                    if self.knee_angle < 120.0:
                        self.is_squatting = True
                    else:
                        self.is_squatting = False

                # Draw skeleton guidelines on CV Feed
                self.mp_draw.draw_landmarks(frame, results.pose_landmarks, self.mp_pose.POSE_CONNECTIONS)

            # Draw Viewfinder Diagnostics UI
            cv2.rectangle(frame, (8, 8), (480, 120), (15, 12, 12), -1)
            cv2.putText(frame, "3D LAVA MOTION SYSTEM", (15, 30), cv2.FONT_HERSHEY_DUPLEX, 0.6, (0, 165, 255), 1)
            
            if not self.calibrated:
                cv2.putText(frame, "STAND TALL AND PRESS 'C' TO CALIBRATE", (15, 60), cv2.FONT_HERSHEY_DUPLEX, 0.5, (0, 255, 255), 1)
                cv2.putText(frame, "Press 'c' key in current window.", (15, 85), cv2.FONT_HERSHEY_DUPLEX, 0.4, (200, 200, 200), 1)
            else:
                status = "JUMPING" if self.is_jumping else "SQUATTING" if self.is_squatting else "STANDING"
                color = (0, 255, 0) if status == "STANDING" else (0, 140, 255) if status == "JUMPING" else (255, 120, 0)
                cv2.putText(frame, f"CALIBRATED OK - Player X: {self.player_x:.1f}", (15, 55), cv2.FONT_HERSHEY_DUPLEX, 0.45, (250, 250, 250), 1)
                cv2.putText(frame, f"POSTURE STATE: {status}", (15, 80), cv2.FONT_HERSHEY_DUPLEX, 0.55, color, 1)
                cv2.putText(frame, f"Knee Flex Angle: {self.knee_angle:.1f} DEG", (15, 102), cv2.FONT_HERSHEY_DUPLEX, 0.45, (180, 180, 180), 1)

            cv2.imshow("3D Floor is Lava | Calibration Feed", frame)
            
            # Allow key calibrate fallbacks inside CV window directly (in addition to Ursina)
            key = cv2.waitKey(1) & 0xFF
            if key == ord('c'):
                self.calibrate()
            elif key == ord('q'):
                break

# Initialize Background Tracker Daemon
tracker = PoseTracker()
tracker.start()


# -----------------------------------------------------------------------------
# 2. Ursina 3D App Initialization
# -----------------------------------------------------------------------------
app = Ursina()
window.title = "The Floor is Lava 3D"
window.borderless = False
window.fullscreen = False
window.exit_button.visible = True
window.fps_counter.enabled = True

# Isometric/Fixed perspective game camera setup
camera.position = (0, 3.8, -15)
camera.rotation = (12, 0, 0)

# Sound placeholder effects console prints fallback handler
def play_sound_event(event_name, msg=""):
    print(f"[AUDIO FX: {event_name}] {msg}")

# -----------------------------------------------------------------------------
# 3. Game State Managers
# -----------------------------------------------------------------------------
class GameState:
    def __init__(self):
        self.score = 0
        self.high_score = 0
        self.lives = 3
        self.combo = 1
        self.time_elapsed = 0.0
        self.is_playing = False
        self.game_over = False
        self.calibration_phase = True
        self.lava_watermark = -2.5      # Rising lava height line
        self.speed_factor = 1.0          # Slowly advances difficulty speed scaler

game_state = GameState()

# -----------------------------------------------------------------------------
# 4. 3D Elements Design
# -----------------------------------------------------------------------------

# Stylized Sky background Dome
sky_plane = Entity(
    model='sphere',
    color=color.dark_gray,
    scale=(100, 100, 100),
    double_sided=True
)

# Rising Lava Sea Plane
lava_sea = Entity(
    model='plane',
    color=color.rgb(255, 40, 0),
    scale=(60, 1, 30),
    position=(0, game_state.lava_watermark, 0)
)

# Procedural Lava pulsing shader effect simulation
class VolcanicSpikes:
    """Simulates active volcanic debris particles rising up from lava."""
    def __init__(self):
        self.bubbles = []
        for i in range(12):
            b = Entity(
                model='sphere',
                color=color.rgb(255, 120, 0),
                scale=random.uniform(0.15, 0.4),
                position=(random.uniform(-20, 20), -2.2, random.uniform(-4, 4))
            )
            self.bubbles.append(b)

    def update(self):
        for b in self.bubbles:
            # Rise slowly
            b.y += time.dt * 1.5
            if b.y > game_state.lava_watermark + 0.8:
                # Reset down below water level
                b.y = game_state.lava_watermark - 0.5
                b.x = random.uniform(-20, 20)

volcanic_bubble_fx = VolcanicSpikes()


# Safe Sofa Platforms (Couch structure built via primitives)
class SafeZoneCouch:
    def __init__(self, name, x_pos, scale_width):
        self.x = x_pos
        self.width = scale_width
        self.height = 1.15
        
        # Primary cushion base
        self.base = Entity(
            model='cube',
            color=color.emerald if name == 'Sofa Green' else color.hex('#0284c7'),
            scale=(scale_width, self.height, 2.2),
            position=(x_pos, -0.6, 0),
            collider='box'
        )
        
        # Flank armrests
        self.left_arm = Entity(
            model='cube',
            color=color.hex('#065f46') if name == 'Sofa Green' else color.hex('#0369a1'),
            scale=(0.35, 1.35, 2.3),
            position=(x_pos - (scale_width/2) + 0.18, -0.5, 0)
        )
        self.right_arm = Entity(
            model='cube',
            color=color.hex('#065f46') if name == 'Sofa Green' else color.hex('#0369a1'),
            scale=(0.35, 1.35, 2.3),
            position=(x_pos + (scale_width/2) - 0.18, -0.5, 0)
        )
        
        # Cozy backrest support
        self.backrest = Entity(
            model='cube',
            color=color.hex('#047857') if name == 'Sofa Green' else color.hex('#0ea5e9'),
            scale=(scale_width - 0.2, 1.3, 0.4),
            position=(x_pos, -0.1, -0.9)
        )

# Construct dual safe zones (Left and Right sofas)
emerald_couch = SafeZoneCouch('Sofa Green', -6.0, 3.8)
azure_couch = SafeZoneCouch('Sofa Blue', 6.0, 3.8)


# Player 3D Character Mesh Representation
class CharacterPlayer:
    def __init__(self):
        # Master pivot group
        self.pivot = Entity()
        
        # Visual Robot Torso block
        self.torso = Entity(
            parent=self.pivot,
            model='cube',
            color=color.hex('#f8fafc'),
            scale=(0.7, 0.95, 0.61),
            position=(0, 0.5, 0)
        )
        
        # Glowing cyber visor eye helmet
        self.head = Entity(
            parent=self.pivot,
            model='sphere',
            color=color.hex('#cbd5e1'),
            scale=0.38,
            position=(0, 1.15, 0)
        )
        self.visor = Entity(
            parent=self.pivot,
            model='cube',
            color=color.cyan,
            scale=(0.4, 0.15, 0.1),
            position=(0, 1.18, 0.25)
        )
        
        # High reliability kinetic physics states
        self.visual_y = 0.0
        self.target_y = 0.0

    def update_pose(self, x_pos, is_jumping, is_squatting, base_height):
        # Direct horizontal position sync
        self.pivot.x = x_pos
        
        # 1. Height line mapping
        if is_jumping:
            self.target_y = base_height + 2.2
            # Add flying flare spinning lean (roll style!)
            self.pivot.rotation_x += time.dt * 220.0
        else:
            self.target_y = base_height
            # Realign angle upright
            self.pivot.rotation_x = lerp(self.pivot.rotation_x, 0, time.dt * 15.0)

        # 2. Smooth Lerping movement interpolation
        self.pivot.y = lerp(self.pivot.y, self.target_y, time.dt * 12.0)

        # 3. Squat compression scaling metrics
        if is_squatting:
            self.pivot.scale_y = lerp(self.pivot.scale_y, 0.45, time.dt * 14.0)
            self.pivot.rotation_z = lerp(self.pivot.rotation_z, 15, time.dt * 8.0) # lean
        else:
            self.pivot.scale_y = lerp(self.pivot.scale_y, 1.0, time.dt * 10.0)
            self.pivot.rotation_z = lerp(self.pivot.rotation_z, 0, time.dt * 12.0)

player_3d = CharacterPlayer()


# -----------------------------------------------------------------------------
# 5. Dangerous Slide-in Laser Obstacles Group
# -----------------------------------------------------------------------------
obstacles_active = []

class LaserObstacle:
    def __init__(self, hazard_type):
        self.type = hazard_type # 'LOW_WALL' (Jump over) or 'HIGH_BEAM' (Squat under)
        self.speed = random.uniform(5.5, 7.5) * game_state.speed_factor
        self.passed = False
        
        # Start far off-screen right, passing to left side
        start_x = 18.0
        
        if self.type == 'LOW_WALL':
            # Low cyber wall slicing the ground elements
            self.entity = Entity(
                model='cube',
                color=color.rgba(255, 30, 30, 200),
                scale=(1.4, 0.65, 1.8),
                position=(start_x, -1.0, 0),
                collider='box'
            )
            # Accent energy core
            self.decoration = Entity(
                parent=self.entity,
                model='cube',
                color=color.white,
                scale=(1.45, 0.1, 1.85),
                position=(0, 0, 0)
            )
        else:
            # Overhead sweeping beam
            self.entity = Entity(
                model='cylinder',
                color=color.rgba(224, 242, 254, 220), # glowing electric sky blue
                scale=(0.4, 4.0, 0.4),
                rotation=(0, 0, 90), # aligned horizontally
                position=(start_x, 0.65, 0),
                collider='box'
            )
            # Overhead light glowing helper
            self.decoration = Entity(
                parent=self.entity,
                model='sphere',
                color=color.cyan,
                scale=(0.6, 0.6, 0.6),
                position=(0, 1.8, 0)
            )

    def update_physics(self):
        # Move left across screen
        self.entity.x -= time.dt * self.speed
        
        # Bound cleanup check
        if self.entity.x < -18.0:
            destroy(self.entity)
            if hasattr(self, 'decoration'):
                destroy(self.decoration)
            return True
        return False

# Spawner timer metric
obstacle_spawn_timer = 0.0


# -----------------------------------------------------------------------------
# 6. Heads-Up Display HUD & Screens Layout
# -----------------------------------------------------------------------------

# Title Canvas overlay
title_ui = Text(
    text="THE FLOOR IS LAVA 3D\nPress SPACE or CAMERA 'C' key to Calibrate standing posture height!",
    origin=(0, 0),
    scale=1.4,
    color=color.yellow,
    position=(0, 0.35)
)

action_instructions = Text(
    text="Controls overview:\n1. Calibrate standing taller stance by aligning inside camera and hitting SPACE/C.\n2. Lean Left/Right physically to travel.\n3. Jump up physically to clear Low Red Walls.\n4. Squat Deeply to sit under Sky Blue beams.",
    origin=(0, 0),
    scale=1.0,
    color=color.white,
    position=(0, 0.1)
)

start_button = Button(
    text="LAUNCH CORE LAVA ENGINE",
    color=color.orange,
    scale=(0.4, 0.1),
    position=(0, -0.15)
)

hud_panels = {
    'score': Text(text="SCORE: 0000", position=(-0.82, 0.46), scale=1.3, color=color.white),
    'combo': Text(text="MUTIPLIER: x1", position=(-0.82, 0.41), scale=1.1, color=color.yellow),
    'lives': Text(text="LIVES: [ ] [ ] [ ]", position=(0.54, 0.46), scale=1.3, color=color.red),
    'time': Text(text="SURVIVAL: 0s", position=(0.54, 0.41), scale=1.1, color=color.cyan),
    'status': Text(text="SAFE ZONE ACTIVE", position=(0, 0.46), scale=1.4, color=color.green, origin=(0, 0))
}

# Hide gameplay HUD tags during splash phase
for k, v in hud_panels.items():
    v.disable()

def start_game():
    if not tracker.calibrated:
        print("[HUD SYSTEM] Please calibrate physical camera taller position first!")
        title_ui.text = "Error: YOU MUST CALIBRATE HEIGHT FIRST AT COMPUTER CAMERA!\nMove inside lens frame and press [C] or SPACEbar keys."
        title_ui.color = color.red
        return
        
    game_state.calibration_phase = False
    game_state.is_playing = True
    game_state.score = 0
    game_state.lives = 3
    game_state.combo = 1
    game_state.time_elapsed = 0.0
    game_state.speed_factor = 1.0
    game_state.lava_watermark = -2.5
    
    title_ui.disable()
    action_instructions.disable()
    start_button.disable()
    
    play_sound_event("MATCH_START", "Volcanic systems online. Clear lasers!")
    
    for k, v in hud_panels.items():
        v.enable()

start_button.on_click = start_game


# -----------------------------------------------------------------------------
# 7. Core Synchronous Physics & Collision Loop (Runs on FrameTick)
# -----------------------------------------------------------------------------
def update():
    gs = game_state
    
    # 1. Fallback keyboard controls mapping (enables testing without camera as backup input!)
    if held_keys['space'] or held_keys['c']:
        tracker.calibrate()
        title_ui.text = "CALIBRATION FINISHED SUCCESSFULLY!\nNow click button to enter Lava dome."
        title_ui.color = color.green

    if not gs.is_playing:
        # Simple visual animation loop during logo screens
        lava_sea.y = -2.3 + Math.sin(time.time() * 2.5) * 0.15
        volcanic_bubble_fx.update()
        return

    # Update visual particle sparks
    volcanic_bubble_fx.update()

    # Apply manual arrow key controls if the webcam is not calibrated/started to preserve versatility
    target_x = tracker.player_x
    is_jumping = tracker.is_jumping
    is_squatting = tracker.is_squatting
    
    if held_keys['left arrow'] or held_keys['a']:
        target_x = player_3d.pivot.x - time.dt * 12.0
    if held_keys['right arrow'] or held_keys['d']:
        target_x = player_3d.pivot.x + time.dt * 12.0
    if held_keys['up arrow'] or held_keys['w']:
        is_jumping = True
    if held_keys['down arrow'] or held_keys['s']:
        is_squatting = True

    # Clamp horizontal boundary limits 
    target_x = clamp(target_x, -11.0, 11.0)

    # 2. Map safe zones height foundations relative to location coordinates
    on_green_sofa = (-8.0 <= target_x <= -4.0)
    on_blue_sofa = (4.0 <= target_x <= 8.0)
    is_safe = (on_green_sofa or on_blue_sofa)

    # Sofa cushions raise player by 0.5 units, floor level starts raw on -1.82 base line
    surface_base_y = -0.05 if is_safe else -1.82

    # Update 3D Character kinematics mesh
    player_3d.update_pose(target_x, is_jumping, is_squatting, surface_base_y)

    # 3. Dynamic Lava Rises over match course elapsed time
    gs.time_elapsed += time.dt
    gs.speed_factor = 1.0 + (gs.time_elapsed * 0.02)
    
    # Rising tide level cap checks
    target_lava_tide = min(-0.4, -2.5 + (gs.time_elapsed * 0.04))
    gs.lava_watermark = target_lava_tide
    lava_sea.y = gs.lava_watermark + Math.sin(time.time() * 3.0) * 0.05

    # Check if magma reaches unsafe player feet boundaries!
    magma_contact = (player_3d.pivot.y < gs.lava_watermark + 0.1)
    if magma_contact and not is_jumping:
        # Periodic damage risk ticker on boiling magma contact
        if int(gs.time_elapsed * 2.5) % 8 == 0:
            play_sound_event("LAVA_BURN", "Avatar is melting! Leap or get on couch!")
            gs.lives -= 1
            gs.combo = 1
            trigger_damage_blink()
            
            if gs.lives <= 0:
                trigger_game_over()

    # 4. Spawners Obstacle loops
    global obstacle_spawn_timer
    obstacle_spawn_timer += time.dt
    
    current_spawn_interval = max(0.9, 2.5 - (gs.time_elapsed * 0.05))
    if obstacle_spawn_timer > current_spawn_interval:
        obstacle_spawn_timer = 0.0
        chosen_type = 'LOW_WALL' if random.random() < 0.55 else 'HIGH_BEAM'
        obstacles_active.append(LaserObstacle(chosen_type))
        play_sound_event("SPAWN_OBSTACLE", f"Incoming {chosen_type} hazard!")

    # Tick active lasers and verify collisions
    for obs in list(obstacles_active):
        cleanup = obs.update_physics()
        if cleanup:
            obstacles_active.remove(obs)
            continue
            
        # Collision math verification
        # Overlaps on horizontal player center with hit radius bounds checks
        horizontal_aligned = abs(player_3d.pivot.x - obs.entity.x) < 1.15
        
        if horizontal_aligned and not obs.passed:
            collision_hit = False
            
            if obs.type == 'LOW_WALL':
                # Slices lower floor; hit if user does NOT jump
                if not is_jumping:
                    collision_hit = True
            elif obs.type == 'HIGH_BEAM':
                # Slices mid chest high range; hit if user does NOT squat
                if not is_squatting:
                    collision_hit = True
                    
            if collision_hit:
                obs.passed = True
                play_sound_event("PLAYER_HIT", f"Failed to dodge {obs.type}!")
                gs.lives -= 1
                gs.combo = 1
                trigger_damage_blink()
                
                if gs.lives <= 0:
                    trigger_game_over()
            else:
                # Successfully dodged! Give streak points when laser sweeps behind center alignment
                if obs.entity.x < player_3d.pivot.x - 0.8:
                    obs.passed = True
                    gs.combo += 1
                    gained_pts = 100 * gs.combo
                    gs.score += gained_pts
                    play_sound_event("DODGE_SUCCESS", f"Combo x{gs.combo}! +{gained_pts} PTS")

    # Give ambient survival score
    gs.score += int(time.dt * 12 * gs.combo)

    # 5. Refresh HUD panel labels
    hud_panels['score'].text = f"SCORE: {gs.score:05d}"
    hud_panels['combo'].text = f"MULTIPLIER: x{gs.combo}"
    hud_panels['time'].text = f"SURVIVAL: {int(gs.time_elapsed)}s"
    
    heart_str = ""
    for idx in range(3):
        heart_str += " [♥] " if idx < gs.lives else " [ ] "
    hud_panels['lives'].text = f"LIVES: {heart_str}"
    
    if is_safe:
        hud_panels['status'].text = "COUCH SURFACE: SAFE"
        hud_panels['status'].color = color.green
    else:
        hud_panels['status'].text = "LAVA TIDE TENSION: CAUTION!"
        hud_panels['status'].color = color.orange


def trigger_damage_blink():
    camera.shake(duration=0.25, magnitude=0.2)
    player_3d.torso.color = color.red
    # Revert color on next frame delay
    invoke(setattr, player_3d.torso, 'color', color.hex('#f8fafc'), delay=0.2)

def trigger_game_over():
    game_state.is_playing = False
    game_state.game_over = True
    
    # Hide gameplay labels
    for k, v in hud_panels.items():
        v.disable()
        
    # Standard cleanup of any active lasers
    for obs in list(obstacles_active):
        destroy(obs.entity)
        if hasattr(obs, 'decoration'):
            destroy(obs.decoration)
    obstacles_active.clear()

    play_sound_event("GAME_OVER", f"Final Score achieved: {game_state.score} PTS on {int(game_state.time_elapsed)}s survival")
    
    title_ui.text = f"G A M E   O V E R\nFINAL SCORE: {game_state.score}\nSURVIVED TIME: {int(game_state.time_elapsed)} seconds\n\nPress SPACE to return of Calibration Screen"
    title_ui.color = color.red
    title_ui.enable()


# Register fallback keyboard triggers on menus
def input(key):
    if key == 'space' or key == 'm':
        if game_state.game_over:
            # Return home screen safely
            game_state.game_over = False
            game_state.calibration_phase = True
            
            title_ui.text = "THE FLOOR IS LAVA 3D\nPress SPACE or CAMERA 'C' key to Calibrate standing posture height!"
            title_ui.color = color.yellow
            action_instructions.enable()
            start_button.enable()


# Clean thread release upon termination
def on_destroy():
    tracker.stop()

# -----------------------------------------------------------------------------
# 8. Main Application Trigger Entry point
# -----------------------------------------------------------------------------
if __name__ == "__main__":
    print("""
    ========================================================================
     🔥 THE FLOOR IS LAVA 3D: MOTION SYSTEM BOOTED 🔥
    ========================================================================
    How to play:
      1. Web camera feed will launch alongside Ursina's game window.
      2. Align your physical body within the camera frame so your waist up is visible.
      3. Stand tall and press SPACEBAR in Ursina OR 'C' on OpenCV viewfinder.
      4. Press the orange target button on Ursina screen to start!
      
    Keyboard Fallback keys:
      - Left / Right Arrow / A / D : Move player horizontally
      - Up / Down Arrow / W / S    : Simulate Jumps & Squats manually
    ========================================================================
    """)
    app.run()
