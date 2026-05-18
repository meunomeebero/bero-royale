import * as THREE from "three";
import type { Platform } from "./Platform";
import type { AudioManager } from "./AudioManager";
import type { DustParticles } from "./DustParticles";
import type { Bullets, BulletTarget } from "./Bullets";
import type { Player } from "./Player";
import type { SmokePuffs } from "./SmokePuffs";
import { makePigMaterials } from "./TextureFactory";

const BOT_SIZE = 0.5;
const MOVE_SPEED = 3.5;
const ACCEL = 14;
const JUMP_VELOCITY = 6.0;
const GRAVITY = 18.0;

const MAX_HEALTH = 10;
const RESPAWN_DELAY = 5.0;
const HIT_FLASH_DURATION = 0.25;

const SIGHT_RANGE = 16; // distance at which the bot starts seeing the player
const SHOOT_COOLDOWN = 0.7;
const JUMP_COOLDOWN_MIN = 1.6;
const JUMP_COOLDOWN_MAX = 3.5;
const WANDER_INTERVAL = 2.5;

const COLOR_HEALTHY = new THREE.Color("#ff7f1f");
const COLOR_DEAD = new THREE.Color("#3a0606");
const COLOR_HIT = new THREE.Color("#ffffff");
const EMISSIVE_HEALTHY = new THREE.Color("#a13a00");
const EMISSIVE_DEAD = new THREE.Color("#1a0202");

type State = "alive" | "falling" | "dead";

export class Bot implements BulletTarget {
  readonly id: string;
  readonly side = "bot" as const;
  readonly bodyHalfHeight = BOT_SIZE / 2;

  readonly root: THREE.Group;
  private body: THREE.Mesh;
  private aimGroup: THREE.Group;
  private gun: THREE.Group;
  private gunBarrelTip: THREE.Object3D;

  private platform: Platform;
  private audio: AudioManager;
  private dust: DustParticles;
  private bullets: Bullets;
  private smoke: SmokePuffs | null = null;

  private velocity = new THREE.Vector3(0, 0, 0);
  private grounded = true;
  private state: State = "alive";
  private fallTimer = 0;
  private deadTimer = 0;
  private targetScale = new THREE.Vector3(1, 1, 1);
  private bodyMaterial: THREE.MeshLambertMaterial;
  private pigMaterials: THREE.MeshLambertMaterial[] = [];
  private health = MAX_HEALTH;

  private hitFlashTimer = 0;
  private shakeTimer = 0;
  private shakeAmount = 0;

  private aimYaw = 0;
  private shootTimer = 0;
  private jumpTimer = 0;
  private wanderTimer = 0;
  private wanderTarget = new THREE.Vector3();

  readonly position = new THREE.Vector3();

  constructor(
    id: string,
    platform: Platform,
    audio: AudioManager,
    dust: DustParticles,
    bullets: Bullets,
  ) {
    this.id = id;
    this.platform = platform;
    this.audio = audio;
    this.dust = dust;
    this.bullets = bullets;

    this.root = new THREE.Group();

    const bodyGeom = new THREE.BoxGeometry(BOT_SIZE, BOT_SIZE, BOT_SIZE);
    // Bot pigs are tinted red so the player can distinguish them from
    // friendlies/themselves on the dark map.
    const pigMats = makePigMaterials("#ff9a9a");
    for (const m of pigMats) {
      m.color.copy(COLOR_HEALTHY);
      m.emissive = EMISSIVE_HEALTHY.clone();
      m.emissiveIntensity = 0.45;
      m.transparent = true;
    }
    this.pigMaterials = pigMats;
    this.bodyMaterial = pigMats[0];
    this.body = new THREE.Mesh(bodyGeom, pigMats);
    this.root.add(this.body);

    this.aimGroup = new THREE.Group();
    this.root.add(this.aimGroup);

    // Bot pistol (red-tinted)
    this.gun = new THREE.Group();
    const gunMat = new THREE.MeshLambertMaterial({
      color: new THREE.Color("#2a1010"),
      emissive: new THREE.Color("#400a0a"),
      emissiveIntensity: 0.4,
    });
    const gunBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.14, 0.12),
      gunMat,
    );
    this.gun.add(gunBody);
    const barrel = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.07, 0.07),
      gunMat,
    );
    barrel.position.set(0.16, 0.02, 0);
    this.gun.add(barrel);

    this.gunBarrelTip = new THREE.Object3D();
    this.gunBarrelTip.position.set(0.28, 0.02, 0);
    this.gun.add(this.gunBarrelTip);

    this.gun.position.set(0.12, 0, 0);
    this.aimGroup.add(this.gun);

    this.respawn();
  }

  isAlive() {
    return this.state === "alive";
  }

  isAirborne() {
    return !this.grounded;
  }

  isGrounded() {
    return this.grounded;
  }

  takeHit(_direction: THREE.Vector3): boolean {
    if (this.state !== "alive") return false;
    this.health = Math.max(0, this.health - 1);
    this.hitFlashTimer = HIT_FLASH_DURATION;
    this.shakeTimer = 0.22;
    this.shakeAmount = 0.05;
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
    this.dust.spawnBurst(
      new THREE.Vector3(
        this.root.position.x,
        this.platform.topY + 0.05,
        this.root.position.z,
      ),
      14,
    );
  }

  private respawn() {
    const spawn = this.platform.randomSpawn(6);
    spawn.y = this.platform.surfaceY(spawn.x, spawn.z) + BOT_SIZE / 2;
    this.root.position.copy(spawn);
    this.velocity.set(0, 0, 0);
    this.body.scale.set(1, 1, 1);
    this.body.position.set(0, 0, 0);
    this.targetScale.set(1, 1, 1);
    this.bodyMaterial.opacity = 1;
    this.bodyMaterial.color.copy(COLOR_HEALTHY);
    this.bodyMaterial.emissive.copy(EMISSIVE_HEALTHY);
    this.syncPigMaterials();
    this.grounded = true;
    this.state = "alive";
    this.fallTimer = 0;
    this.deadTimer = 0;
    this.health = MAX_HEALTH;
    this.hitFlashTimer = 0;
    this.shakeTimer = 0;
    this.shootTimer = 0.5 + Math.random();
    this.jumpTimer = JUMP_COOLDOWN_MIN + Math.random() * JUMP_COOLDOWN_MAX;
    this.wanderTimer = 0;
    this.position.copy(this.root.position);
  }

  private updateColor() {
    const t = 1 - this.health / MAX_HEALTH;
    if (this.hitFlashTimer > 0) {
      this.bodyMaterial.color.copy(COLOR_HIT);
    } else {
      this.bodyMaterial.color.copy(COLOR_HEALTHY).lerp(COLOR_DEAD, t);
    }
    this.bodyMaterial.emissive.copy(EMISSIVE_HEALTHY).lerp(EMISSIVE_DEAD, t);
  }

  private syncPigMaterials() {
    const src = this.bodyMaterial;
    for (const m of this.pigMaterials) {
      if (m === src) continue;
      m.color.copy(src.color);
      m.emissive.copy(src.emissive);
      m.opacity = src.opacity;
    }
  }

  update(dt: number, player: Player) {
    if (this.state === "dead") {
      this.deadTimer += dt;
      this.root.position.y -= dt * 0.6;
      const t = Math.min(1, this.deadTimer / RESPAWN_DELAY);
      const s = Math.max(0.05, 1 - t);
      this.body.scale.set(s, s, s);
      this.bodyMaterial.opacity = Math.max(0.1, 1 - t);
      this.bodyMaterial.color.copy(COLOR_DEAD);
      this.bodyMaterial.emissive.copy(EMISSIVE_DEAD);
      this.syncPigMaterials();
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
      const t = 1 - this.fallTimer / 0.7;
      this.bodyMaterial.opacity = Math.max(0, t);
      this.syncPigMaterials();
      const s = Math.max(0.1, t);
      this.root.scale.set(s, s, s);
      this.position.copy(this.root.position);
      if (this.fallTimer >= 0.7) {
        this.root.rotation.set(0, 0, 0);
        this.root.scale.set(1, 1, 1);
        this.respawn();
      }
      return;
    }

    // AI: see player?
    const dx = player.position.x - this.root.position.x;
    const dz = player.position.z - this.root.position.z;
    const distToPlayer = Math.hypot(dx, dz);
    const seesPlayer = player.isAlive() && distToPlayer <= SIGHT_RANGE;

    const move = new THREE.Vector3(0, 0, 0);
    if (seesPlayer) {
      // Aim at player
      this.aimYaw = Math.atan2(dz, dx);
      this.aimGroup.rotation.y = -this.aimYaw;

      // Approach to a comfortable shooting distance
      const desired = 6;
      if (distToPlayer > desired + 0.5) {
        move.set(dx, 0, dz).normalize();
      } else if (distToPlayer < desired - 0.5) {
        move.set(-dx, 0, -dz).normalize();
      }

      // Shoot on cooldown
      this.shootTimer -= dt;
      if (this.shootTimer <= 0) {
        this.shoot();
        this.shootTimer = SHOOT_COOLDOWN + Math.random() * 0.4;
      }

      // Occasionally jump (so it can hit airborne players)
      this.jumpTimer -= dt;
      if (this.grounded && this.jumpTimer <= 0) {
        this.velocity.y = JUMP_VELOCITY;
        this.grounded = false;
        this.audio.jump();
        this.targetScale.set(0.7, 1.4, 0.7);
        this.jumpTimer =
          JUMP_COOLDOWN_MIN + Math.random() * JUMP_COOLDOWN_MAX;
      }
    } else {
      // Wander
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0) {
        const wander = this.platform.randomSpawn(8);
        this.wanderTarget.set(wander.x, 0, wander.z);
        this.wanderTimer = WANDER_INTERVAL + Math.random() * 2;
      }
      const wdx = this.wanderTarget.x - this.root.position.x;
      const wdz = this.wanderTarget.z - this.root.position.z;
      const wd = Math.hypot(wdx, wdz);
      if (wd > 0.5) {
        move.set(wdx, 0, wdz).normalize();
        // Face wander direction
        this.aimYaw = Math.atan2(wdz, wdx);
        this.aimGroup.rotation.y = -this.aimYaw;
      }
    }

    // Movement
    const targetVx = move.x * MOVE_SPEED;
    const targetVz = move.z * MOVE_SPEED;
    const lerpAmt = 1 - Math.exp(-ACCEL * dt);
    this.velocity.x += (targetVx - this.velocity.x) * lerpAmt;
    this.velocity.z += (targetVz - this.velocity.z) * lerpAmt;

    // Gravity
    this.velocity.y -= GRAVITY * dt;

    // Apply
    this.root.position.addScaledVector(this.velocity, dt);

    // Ground collision / edge
    const groundSurfY = this.platform.surfaceY(
      this.root.position.x,
      this.root.position.z,
    );
    const groundY = groundSurfY + BOT_SIZE / 2;
    const bounds = this.platform.getBounds();
    const safeMargin = 1.5;
    const onPlatform =
      this.root.position.x >= bounds.minX + safeMargin &&
      this.root.position.x <= bounds.maxX - safeMargin &&
      this.root.position.z >= bounds.minZ + safeMargin &&
      this.root.position.z <= bounds.maxZ - safeMargin;

    // Soft-clamp bots to a safe interior so they don't suicide off the edge
    const hardOnPlatform =
      this.root.position.x >= bounds.minX &&
      this.root.position.x <= bounds.maxX &&
      this.root.position.z >= bounds.minZ &&
      this.root.position.z <= bounds.maxZ;
    if (!onPlatform && hardOnPlatform) {
      // Push wander target back toward center
      this.wanderTarget.set(0, 0, 0);
    }

    if (hardOnPlatform && this.root.position.y <= groundY) {
      const wasAirborne = !this.grounded;
      this.root.position.y = groundY;
      this.velocity.y = 0;
      if (wasAirborne) {
        this.grounded = true;
        this.audio.land();
        this.targetScale.set(1.4, 0.6, 1.4);
        this.dust.spawnBurst(
          new THREE.Vector3(
            this.root.position.x,
            this.platform.topY + 0.02,
            this.root.position.z,
          ),
          8,
        );
      }
    } else if (!hardOnPlatform && this.root.position.y < this.platform.topY) {
      if (this.state === "alive") {
        this.state = "falling";
        this.audio.fall();
        this.grounded = false;
      }
    } else {
      this.grounded = false;
    }

    // Squash + lean
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
    const leanX = THREE.MathUtils.clamp(this.velocity.z / MOVE_SPEED, -1, 1);
    const leanZ = THREE.MathUtils.clamp(-this.velocity.x / MOVE_SPEED, -1, 1);
    this.body.rotation.x += (leanX * 0.35 - this.body.rotation.x) * 0.18;
    this.body.rotation.z += (leanZ * 0.35 - this.body.rotation.z) * 0.18;

    // Shake
    if (this.shakeTimer > 0) {
      this.shakeTimer -= dt;
      const s = this.shakeAmount * (this.shakeTimer / 0.22);
      this.body.position.x = (Math.random() - 0.5) * s * 2;
      this.body.position.y = (Math.random() - 0.5) * s * 2;
      this.body.position.z = (Math.random() - 0.5) * s * 2;
    } else {
      this.body.position.lerp(new THREE.Vector3(0, 0, 0), 0.4);
    }

    if (this.hitFlashTimer > 0) this.hitFlashTimer -= dt;
    this.updateColor();
    this.syncPigMaterials();
    this.body.scale.lerp(this.targetScale, SQUASH_LERP_VAL);

    this.position.copy(this.root.position);
  }

  private shoot() {
    const muzzle = new THREE.Vector3();
    this.gunBarrelTip.getWorldPosition(muzzle);
    const dir = new THREE.Vector3(
      Math.cos(this.aimYaw),
      0,
      Math.sin(this.aimYaw),
    );
    this.bullets.spawn(muzzle, dir, "bot");
    this.audio.shoot();
    if (this.smoke) {
      this.smoke.spawnFlash(muzzle, dir);
      this.smoke.spawnPuff(muzzle, dir, 5, "#bbbbbb");
    }
  }

  setSmoke(smoke: SmokePuffs) {
    this.smoke = smoke;
  }

  /** Force-kill the bot (used by environmental hazards like lava). */
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
      16,
    );
    this.state = "dead";
    this.deadTimer = 0;
  }

  dispose() {
    for (const m of this.pigMaterials) {
      if (m.map) m.map.dispose();
      m.dispose();
    }
    (this.body.geometry as THREE.BufferGeometry).dispose();
    this.gun.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  }
}

const SQUASH_LERP_VAL = 0.22;
