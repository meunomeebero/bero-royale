import * as THREE from "three";
import type { Platform } from "./Platform";
import type { InputManager } from "./InputManager";
import type { AudioManager } from "./AudioManager";
import type { DustParticles } from "./DustParticles";
import type { Bullets, BulletTarget } from "./Bullets";
import type { SmokePuffs } from "./SmokePuffs";
import type { GrassPoof } from "./GrassPoof";

const PLAYER_SIZE = 0.5;
const MOVE_SPEED = 6.5;
const ACCEL = 28;
const JUMP_VELOCITY = 6.0;
const GRAVITY = 18.0;

const SQUASH_LERP = 0.22;
const FALL_DURATION = 0.7;
const SHOOT_COOLDOWN = 0.12;

const MAX_HEALTH = 10;
const RESPAWN_DELAY = 5.0; // seconds
const HIT_FLASH_DURATION = 0.25;

const COLOR_HEALTHY = new THREE.Color("#7b2fff");
const COLOR_DEAD = new THREE.Color("#3a0606");
const COLOR_HIT = new THREE.Color("#ff2030");
const EMISSIVE_HEALTHY = new THREE.Color("#3a0ea0");
const EMISSIVE_DEAD = new THREE.Color("#1a0202");

type State = "alive" | "falling" | "dead";

export class Player implements BulletTarget {
  readonly id = "player";
  readonly side = "player" as const;
  readonly bodyHalfHeight = PLAYER_SIZE / 2;

  /** Root object: holds the body cube + gun. */
  readonly root: THREE.Group;
  private body: THREE.Mesh;
  private aimGroup: THREE.Group;
  private gun: THREE.Group;
  private gunBarrelTip: THREE.Object3D;

  private platform: Platform;
  private input: InputManager;
  private audio: AudioManager;
  private dust: DustParticles;
  private bullets: Bullets;
  private smoke: SmokePuffs | null = null;
  private grassPoof: GrassPoof | null = null;
  private stepTimer = 0;

  private velocity = new THREE.Vector3(0, 0, 0);
  private grounded = true;
  private state: State = "alive";
  private fallTimer = 0;
  private deadTimer = 0;
  private targetScale = new THREE.Vector3(1, 1, 1);
  private bodyMaterial: THREE.MeshLambertMaterial;
  private shootTimer = 0;
  private health = MAX_HEALTH;

  private hitFlashTimer = 0;
  private shakeTimer = 0;
  private shakeAmount = 0;

  private tmpAim = new THREE.Vector3();
  private tmpDir = new THREE.Vector3();

  private aimYaw = 0;
  private gunRecoil = 0;
  private gunBaseX = 0.12;

  /** Exposed center of body (BulletTarget). */
  readonly position = new THREE.Vector3();

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

    const bodyGeom = new THREE.BoxGeometry(PLAYER_SIZE, PLAYER_SIZE, PLAYER_SIZE);
    this.bodyMaterial = new THREE.MeshLambertMaterial({
      color: COLOR_HEALTHY.clone(),
      emissive: EMISSIVE_HEALTHY.clone(),
      emissiveIntensity: 0.5,
      transparent: true,
    });
    this.body = new THREE.Mesh(bodyGeom, this.bodyMaterial);
    this.root.add(this.body);

    this.aimGroup = new THREE.Group();
    this.root.add(this.aimGroup);

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

    this.gunBarrelTip = new THREE.Object3D();
    this.gunBarrelTip.position.set(0.28, 0.02, 0);
    this.gun.add(this.gunBarrelTip);

    this.gun.position.set(this.gunBaseX, 0, -0.3);
    this.aimGroup.add(this.gun);

    this.respawn();
  }

  isAlive() {
    return this.state === "alive";
  }

  /** Player is currently airborne (jumping/falling) — bullets at ground level miss. */
  isAirborne() {
    return !this.grounded;
  }
  isGrounded() {
    return this.grounded;
  }
  getHealth() {
    return this.health;
  }

  setSmoke(smoke: SmokePuffs) {
    this.smoke = smoke;
  }

  setGrassPoof(g: GrassPoof) {
    this.grassPoof = g;
  }

  /** Force-kill the player (used by environmental hazards like lava). */
  killByHazard() {
    if (this.state !== "alive") return;
    this.health = 0;
    this.audio.death();
    this.dust.spawnBurst(
      new THREE.Vector3(
        this.root.position.x,
        this.platform.topY + 0.05,
        this.root.position.z,
      ),
      20,
    );
    this.state = "dead";
    this.deadTimer = 0;
  }

  getMaxHealth() {
    return MAX_HEALTH;
  }

  getState() {
    return this.state;
  }

  /** BulletTarget callback. */
  takeHit(_direction: THREE.Vector3): boolean {
    if (this.state !== "alive") return false;
    this.health = Math.max(0, this.health - 1);
    this.hitFlashTimer = HIT_FLASH_DURATION;
    this.shakeTimer = 0.25;
    this.shakeAmount = 0.06;
    this.targetScale.set(1.35, 0.7, 1.35);
    this.audio.hit();
    if (this.health <= 0) {
      this.die();
    }
    return true;
  }

  private die() {
    this.state = "dead";
    this.deadTimer = 0;
    this.audio.death();
    // Burst of dust on death
    this.dust.spawnBurst(
      new THREE.Vector3(
        this.root.position.x,
        this.platform.topY + 0.05,
        this.root.position.z,
      ),
      18,
    );
  }

  private respawn() {
    const spawn = this.platform.randomSpawn(4);
    spawn.y = this.platform.surfaceY(spawn.x, spawn.z) + PLAYER_SIZE / 2;
    this.root.position.copy(spawn);
    this.root.rotation.set(0, 0, 0);
    this.root.scale.set(1, 1, 1);
    this.velocity.set(0, 0, 0);
    this.body.scale.set(1, 1, 1);
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    this.targetScale.set(1, 1, 1);
    this.bodyMaterial.opacity = 1;
    this.bodyMaterial.color.copy(COLOR_HEALTHY);
    this.bodyMaterial.emissive.copy(EMISSIVE_HEALTHY);
    this.grounded = true;
    this.state = "alive";
    this.fallTimer = 0;
    this.deadTimer = 0;
    this.health = MAX_HEALTH;
    this.hitFlashTimer = 0;
    this.shakeTimer = 0;
    // Clear any keys / mouse buttons that may have gotten stuck during the
    // fall/death animation (e.g. window lost focus while a movement key was held).
    this.input.clearKeys();
    this.position.copy(this.root.position);
  }

  private updateAim(camera: THREE.Camera) {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(this.input.mouseNDC, camera);
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

  private getAimDirection(out: THREE.Vector3) {
    out.set(Math.cos(this.aimYaw), 0, Math.sin(this.aimYaw));
    return out;
  }

  /** Update body color based on health (purple -> dark red). */
  private updateColor() {
    const t = 1 - this.health / MAX_HEALTH; // 0 healthy → 1 dead
    if (this.hitFlashTimer > 0) {
      this.bodyMaterial.color.copy(COLOR_HIT);
    } else {
      this.bodyMaterial.color
        .copy(COLOR_HEALTHY)
        .lerp(COLOR_DEAD, t);
    }
    this.bodyMaterial.emissive
      .copy(EMISSIVE_HEALTHY)
      .lerp(EMISSIVE_DEAD, t);
  }

  update(dt: number, camera: THREE.Camera) {
    // DEAD: countdown to respawn
    if (this.state === "dead") {
      this.deadTimer += dt;
      // Sink slowly + shrink
      this.root.position.y -= dt * 0.6;
      const t = Math.min(1, this.deadTimer / RESPAWN_DELAY);
      const s = Math.max(0.05, 1 - t);
      this.body.scale.set(s, s, s);
      this.bodyMaterial.opacity = Math.max(0.1, 1 - t);
      this.bodyMaterial.color.copy(COLOR_DEAD);
      this.bodyMaterial.emissive.copy(EMISSIVE_DEAD);
      this.position.copy(this.root.position);
      if (this.deadTimer >= RESPAWN_DELAY) {
        this.respawn();
      }
      return;
    }

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
      this.position.copy(this.root.position);
      if (this.fallTimer >= FALL_DURATION) {
        this.root.rotation.set(0, 0, 0);
        this.root.scale.set(1, 1, 1);
        this.respawn();
      }
      return;
    }

    // Aim
    this.updateAim(camera);

    // Movement
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
      // Grass puff when jumping
      if (this.grassPoof) {
        const sy = this.platform.surfaceY(
          this.root.position.x,
          this.root.position.z,
        );
        if (!this.platform.isLavaAt(this.root.position.x, this.root.position.z)) {
          this.grassPoof.spawn(
            new THREE.Vector3(this.root.position.x, sy, this.root.position.z),
            6,
            null,
          );
        }
      }
    } else {
      this.input.consumeJump();
    }

    // Shooting
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

    // Ground / death-by-edge
    const groundSurfaceY = this.platform.surfaceY(
      this.root.position.x,
      this.root.position.z,
    );
    const groundY = groundSurfaceY + PLAYER_SIZE / 2;
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
          groundSurfaceY + 0.02,
          this.root.position.z,
        );
        this.dust.spawnBurst(dustPos, 10);
        // Burst of grass blades on landing
        if (this.grassPoof && !this.platform.isLavaAt(this.root.position.x, this.root.position.z)) {
          this.grassPoof.spawn(
            new THREE.Vector3(this.root.position.x, groundSurfaceY, this.root.position.z),
            8,
            null,
          );
        }
      }
    } else if (!onPlatform && this.root.position.y < this.platform.topY) {
      // Fell off the edge: trigger fall + die
      if (this.state === "alive") {
        this.state = "falling";
        this.audio.fall();
        this.grounded = false;
      }
    } else {
      this.grounded = false;
    }

    // Movement squash
    const speedXZ = Math.hypot(this.velocity.x, this.velocity.z);
    const speedRatio = Math.min(1, speedXZ / MOVE_SPEED);
    if (this.grounded) {
      const stretch = 1 + speedRatio * 0.18;
      const squish = 1 - speedRatio * 0.1;
      this.targetScale.lerp(
        new THREE.Vector3(squish, stretch * 0.95, squish),
        0.18,
      );
      if (speedRatio < 0.05) {
        this.targetScale.lerp(new THREE.Vector3(1, 1, 1), 0.2);
      }
    } else {
      this.targetScale.lerp(new THREE.Vector3(1, 1, 1), 0.06);
    }

    // Lean
    const leanX = THREE.MathUtils.clamp(this.velocity.z / MOVE_SPEED, -1, 1);
    const leanZ = THREE.MathUtils.clamp(-this.velocity.x / MOVE_SPEED, -1, 1);
    this.body.rotation.x += (leanX * 0.35 - this.body.rotation.x) * 0.18;
    this.body.rotation.z += (leanZ * 0.35 - this.body.rotation.z) * 0.18;

    // Shake (hit reaction)
    if (this.shakeTimer > 0) {
      this.shakeTimer -= dt;
      const s = this.shakeAmount * (this.shakeTimer / 0.25);
      this.body.position.x = (Math.random() - 0.5) * s * 2;
      this.body.position.y = (Math.random() - 0.5) * s * 2;
      this.body.position.z = (Math.random() - 0.5) * s * 2;
    } else {
      this.body.position.lerp(new THREE.Vector3(0, 0, 0), 0.4);
    }

    // Hit flash timer
    if (this.hitFlashTimer > 0) this.hitFlashTimer -= dt;

    // Color update (health -> red)
    this.updateColor();

    // Smooth scale lerp
    this.body.scale.lerp(this.targetScale, SQUASH_LERP);

    // Gun recoil recovery
    this.gunRecoil += (0 - this.gunRecoil) * Math.min(1, 18 * dt);
    this.gun.position.x = this.gunBaseX - this.gunRecoil;

    // Footstep sound + grass particles while walking on ground
    const speedXY = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.grounded && speedXY > 0.6) {
      this.stepTimer -= dt * (0.7 + speedXY * 0.18);
      if (this.stepTimer <= 0) {
        this.stepTimer = 0.32; // base cadence
        this.audio.step();
        if (
          this.grassPoof &&
          !this.platform.isLavaAt(this.root.position.x, this.root.position.z)
        ) {
          const sy = this.platform.surfaceY(
            this.root.position.x,
            this.root.position.z,
          );
          const dir = new THREE.Vector3(this.velocity.x, 0, this.velocity.z);
          this.grassPoof.spawn(
            new THREE.Vector3(this.root.position.x, sy, this.root.position.z),
            2,
            dir,
          );
        }
      }
    } else {
      this.stepTimer = 0;
    }

    // Sync exposed position for BulletTarget
    this.position.copy(this.root.position);
  }

  private shoot() {
    const muzzle = new THREE.Vector3();
    this.gunBarrelTip.getWorldPosition(muzzle);
    const dir = this.getAimDirection(this.tmpDir).clone();
    this.bullets.spawn(muzzle, dir, "player");
    this.audio.shoot();
    this.gunRecoil = 0.08;
    this.targetScale.set(1.15, 0.9, 1.15);
    // Muzzle flash + smoke puff
    if (this.smoke) {
      this.smoke.spawnFlash(muzzle, dir);
      this.smoke.spawnPuff(muzzle, dir, 6, "#cccccc");
    }
  }

  dispose() {
    this.bodyMaterial.dispose();
    (this.body.geometry as THREE.BufferGeometry).dispose();
    this.gun.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  }
}
