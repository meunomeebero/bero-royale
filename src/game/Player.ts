import * as THREE from "three";
import type { Platform } from "./Platform";
import type { InputManager } from "./InputManager";
import type { AudioManager } from "./AudioManager";
import type { DustParticles } from "./DustParticles";
import type { Bullets } from "./Bullets";

const PLAYER_SIZE = 0.5; // matches new block size
const MOVE_SPEED = 6.5; // units per second (faster, smoother)
const ACCEL = 28; // approach speed (high for snappy + fluid)
const JUMP_VELOCITY = 6.0;
const GRAVITY = 18.0;

const SQUASH_LERP = 0.22;
const FALL_DURATION = 0.7;
const SHOOT_COOLDOWN = 0.12; // seconds between shots when held

type State = "alive" | "falling";

export class Player {
  /** Root object: holds the body cube + shield + gun. */
  readonly root: THREE.Group;
  /** Visual body (the cube that gets squashed). */
  private body: THREE.Mesh;
  /** Aim group (rotated to face the mouse on the XZ plane). */
  private aimGroup: THREE.Group;
  private shield: THREE.Mesh;
  private gun: THREE.Group;
  private gunBarrelTip: THREE.Object3D;

  private platform: Platform;
  private input: InputManager;
  private audio: AudioManager;
  private dust: DustParticles;
  private bullets: Bullets;

  private velocity = new THREE.Vector3(0, 0, 0);
  private grounded = true;
  private state: State = "alive";
  private fallTimer = 0;
  private targetScale = new THREE.Vector3(1, 1, 1);
  private bodyMaterial: THREE.MeshLambertMaterial;
  private shootTimer = 0;

  // Reusable temp vectors to avoid GC churn each frame
  private tmpAim = new THREE.Vector3();
  private tmpDir = new THREE.Vector3();

  private spawnPos: THREE.Vector3;
  private aimYaw = 0;
  private gunRecoil = 0; // current recoil offset (positive = pushed back)
  private gunBaseX = 0.12;

  constructor(
    platform: Platform,
    input: InputManager,
    audio: AudioManager,
    dust: DustParticles,
    bullets: Bullets,
  ) {
    this.platform = platform;
    this.input = input;
    this.audio = audio;
    this.dust = dust;
    this.bullets = bullets;

    this.root = new THREE.Group();

    // Body cube (the squashable part)
    const bodyGeom = new THREE.BoxGeometry(
      PLAYER_SIZE,
      PLAYER_SIZE,
      PLAYER_SIZE,
    );
    this.bodyMaterial = new THREE.MeshLambertMaterial({
      color: new THREE.Color("#7b2fff"),
      emissive: new THREE.Color("#3a0ea0"),
      emissiveIntensity: 0.5,
      transparent: true,
    });
    this.body = new THREE.Mesh(bodyGeom, this.bodyMaterial);
    this.root.add(this.body);

    // Aim group: parent of shield/gun, rotates around Y to face mouse
    this.aimGroup = new THREE.Group();
    this.root.add(this.aimGroup);

    // Shield (left hand) — dark silvery / pan-like grey
    const shieldGeom = new THREE.BoxGeometry(0.06, 0.36, 0.28);
    const shieldMat = new THREE.MeshLambertMaterial({
      color: new THREE.Color("#5a5e63"),
      emissive: new THREE.Color("#2a2d31"),
      emissiveIntensity: 0.25,
    });
    this.shield = new THREE.Mesh(shieldGeom, shieldMat);
    // "Forward" of aim group is +X. Left of forward (when looking +X) is +Z.
    this.shield.position.set(0.08, 0, 0.32);
    this.aimGroup.add(this.shield);

    // Pistol (right hand) — small grouped cubes
    this.gun = new THREE.Group();
    const gunBodyGeom = new THREE.BoxGeometry(0.18, 0.14, 0.12);
    const gunBodyMat = new THREE.MeshLambertMaterial({
      color: new THREE.Color("#1a1a2e"),
      emissive: new THREE.Color("#0a0a18"),
      emissiveIntensity: 0.4,
    });
    const gunBody = new THREE.Mesh(gunBodyGeom, gunBodyMat);
    this.gun.add(gunBody);

    const barrelGeom = new THREE.BoxGeometry(0.18, 0.07, 0.07);
    const barrel = new THREE.Mesh(barrelGeom, gunBodyMat);
    barrel.position.set(0.16, 0.02, 0);
    this.gun.add(barrel);

    const gripGeom = new THREE.BoxGeometry(0.07, 0.14, 0.09);
    const grip = new THREE.Mesh(gripGeom, gunBodyMat);
    grip.position.set(-0.05, -0.12, 0);
    this.gun.add(grip);

    // Tip marker for muzzle origin
    this.gunBarrelTip = new THREE.Object3D();
    this.gunBarrelTip.position.set(0.28, 0.02, 0);
    this.gun.add(this.gunBarrelTip);

    // Right side relative to forward (+X) is -Z
    this.gun.position.set(this.gunBaseX, 0, -0.3);
    this.aimGroup.add(this.gun);

    this.spawnPos = new THREE.Vector3(
      0,
      this.platform.topY + PLAYER_SIZE / 2,
      0,
    );
    this.respawn();
  }

  private respawn() {
    this.root.position.copy(this.spawnPos);
    this.velocity.set(0, 0, 0);
    this.body.scale.set(1, 1, 1);
    this.body.rotation.set(0, 0, 0);
    this.targetScale.set(1, 1, 1);
    this.bodyMaterial.opacity = 1;
    this.grounded = true;
    this.state = "alive";
    this.fallTimer = 0;
  }

  /** Aim using a virtual ground plane intersection from the mouse ray. */
  private updateAim(camera: THREE.Camera) {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(this.input.mouseNDC, camera);
    // Plane at the body's height
    const plane = new THREE.Plane(
      new THREE.Vector3(0, 1, 0),
      -this.root.position.y,
    );
    const hit = raycaster.ray.intersectPlane(plane, this.tmpAim);
    if (hit) {
      const dx = hit.x - this.root.position.x;
      const dz = hit.z - this.root.position.z;
      this.aimYaw = Math.atan2(dz, dx);
    }
    this.aimGroup.rotation.y = -this.aimYaw;
  }

  /** Direction (XZ) the player is currently aiming. */
  private getAimDirection(out: THREE.Vector3) {
    out.set(Math.cos(this.aimYaw), 0, Math.sin(this.aimYaw));
    return out;
  }

  update(dt: number, camera: THREE.Camera) {
    if (this.state === "falling") {
      this.fallTimer += dt;
      this.velocity.y -= GRAVITY * dt * 0.5;
      this.root.position.addScaledVector(this.velocity, dt);
      this.root.rotation.x += dt * 6;
      this.root.rotation.z += dt * 4;
      const t = 1 - this.fallTimer / FALL_DURATION;
      this.bodyMaterial.opacity = Math.max(0, t);
      const s = Math.max(0.1, t);
      this.root.scale.set(s, s, s);
      if (this.fallTimer >= FALL_DURATION) {
        this.root.rotation.set(0, 0, 0);
        this.root.scale.set(1, 1, 1);
        this.respawn();
      }
      return;
    }

    // Aim update (rotates shield+gun)
    this.updateAim(camera);

    // Smooth horizontal movement (frame-rate independent exp smoothing)
    const move = this.input.getMoveVector();
    const targetVx = move.x * MOVE_SPEED;
    const targetVz = move.z * MOVE_SPEED;
    const lerpAmt = 1 - Math.exp(-ACCEL * dt);
    this.velocity.x += (targetVx - this.velocity.x) * lerpAmt;
    this.velocity.z += (targetVz - this.velocity.z) * lerpAmt;

    // Jump
    if (this.grounded && this.input.consumeJump()) {
      this.velocity.y = JUMP_VELOCITY;
      this.grounded = false;
      this.audio.jump();
      this.targetScale.set(0.7, 1.4, 0.7);
    } else {
      this.input.consumeJump();
    }

    // Shooting (single click + auto-fire while held with cooldown)
    this.shootTimer -= dt;
    const fireNow =
      this.input.consumeShoot() ||
      (this.input.isShootHeld() && this.shootTimer <= 0);
    if (fireNow) {
      this.shoot();
      this.shootTimer = SHOOT_COOLDOWN;
    }

    // Gravity
    this.velocity.y -= GRAVITY * dt;

    // Apply velocity
    this.root.position.addScaledVector(this.velocity, dt);

    // Ground collision (relative to body height)
    const groundY = this.platform.topY + PLAYER_SIZE / 2;
    const bounds = this.platform.getBounds();
    const onPlatform =
      this.root.position.x >= bounds.minX &&
      this.root.position.x <= bounds.maxX &&
      this.root.position.z >= bounds.minZ &&
      this.root.position.z <= bounds.maxZ;

    if (onPlatform && this.root.position.y <= groundY) {
      const wasAirborne = !this.grounded;
      this.root.position.y = groundY;
      this.velocity.y = 0;
      if (wasAirborne) {
        this.grounded = true;
        this.audio.land();
        this.targetScale.set(1.4, 0.6, 1.4);
        const dustPos = new THREE.Vector3(
          this.root.position.x,
          this.platform.topY + 0.02,
          this.root.position.z,
        );
        this.dust.spawnBurst(dustPos, 10);
      }
    } else if (!onPlatform && this.root.position.y < this.platform.topY) {
      if (this.state === "alive") {
        this.state = "falling";
        this.audio.fall();
        this.grounded = false;
      }
    } else {
      this.grounded = false;
    }

    // Movement squash: lateral velocity stretches the body in its motion direction
    const speedXZ = Math.hypot(this.velocity.x, this.velocity.z);
    const speedRatio = Math.min(1, speedXZ / MOVE_SPEED);

    // Base target (stretch on jump / squash on land already handled above)
    if (this.grounded) {
      // Stretch vertically slightly opposite to motion (jelly)
      const stretch = 1 + speedRatio * 0.18;
      const squish = 1 - speedRatio * 0.1;
      this.targetScale.lerp(
        new THREE.Vector3(squish, stretch * 0.95, squish),
        0.18,
      );
      // Recover toward neutral when not moving
      if (speedRatio < 0.05) {
        this.targetScale.lerp(new THREE.Vector3(1, 1, 1), 0.2);
      }
    } else {
      // In-air recovery toward neutral
      this.targetScale.lerp(new THREE.Vector3(1, 1, 1), 0.06);
    }

    // Lean: tilt body slightly in the direction of motion (jelly inertia)
    const leanX = THREE.MathUtils.clamp(this.velocity.z / MOVE_SPEED, -1, 1);
    const leanZ = THREE.MathUtils.clamp(-this.velocity.x / MOVE_SPEED, -1, 1);
    const targetRotX = leanX * 0.35;
    const targetRotZ = leanZ * 0.35;
    this.body.rotation.x += (targetRotX - this.body.rotation.x) * 0.18;
    this.body.rotation.z += (targetRotZ - this.body.rotation.z) * 0.18;

    // Smooth scale lerp
    this.body.scale.lerp(this.targetScale, SQUASH_LERP);

    // Gun recoil recovery (lerp back to base x position)
    this.gunRecoil += (0 - this.gunRecoil) * Math.min(1, 18 * dt);
    this.gun.position.x = this.gunBaseX - this.gunRecoil;
  }

  private shoot() {
    // Muzzle world position
    const muzzle = new THREE.Vector3();
    this.gunBarrelTip.getWorldPosition(muzzle);

    const dir = this.getAimDirection(this.tmpDir).clone();
    this.bullets.spawn(muzzle, dir);
    this.audio.shoot();

    // Recoil kickback on the gun (pushed backward, recovers in update())
    this.gunRecoil = 0.08;
    // Tiny scale punch on the body
    this.targetScale.set(1.15, 0.9, 1.15);
  }

  dispose() {
    this.bodyMaterial.dispose();
    (this.body.geometry as THREE.BufferGeometry).dispose();
    this.shield.geometry.dispose();
    (this.shield.material as THREE.Material).dispose();
    this.gun.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  }
}
