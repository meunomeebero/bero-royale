import * as THREE from "three";
import type { Platform } from "./Platform";
import type { AudioEngine } from "./AudioEngine";
import type { DustParticles } from "./DustParticles";
import type { Bullets, BulletTarget, BulletOwner } from "./Bullets";
import type { SmokePuffs } from "./SmokePuffs";
import { buildNameLabel } from "./PigParts";
import { Avatar, AVATAR_HEIGHT } from "./Avatar";
import { ModelLibrary } from "./ModelLibrary";
import { BlobShadow } from "./Shadow";

/** Behavior modes for Bot instances. */
export type BotBehavior = "hunt" | "ambient";

const BOT_SIZE = 0.5;
const MOVE_SPEED = 4.2; // light aggression tune (was 3.5) — more pressure, still below player speed
const ACCEL = 14;
const JUMP_VELOCITY = 6.0;
const GRAVITY = 18.0;

const MAX_HEALTH = 10;
const RESPAWN_DELAY = 5.0;
const HIT_FLASH_DURATION = 0.25;

const SIGHT_RANGE = 16; // distance at which the bot starts seeing the player
const SHOOT_COOLDOWN = 0.55; // light aggression tune (was 0.7) — snappier local fire
const JUMP_COOLDOWN_MIN = 1.6;
const JUMP_COOLDOWN_MAX = 3.5;
const WANDER_INTERVAL = 2.5;

// Aggressive (online) bots: faster, longer sight, snappier fire — and they can
// charge + fire the mega beam (kamehameha) at the local player.
const AGGRO_MOVE_SPEED = 4.8;
const AGGRO_SIGHT_RANGE = 22;
const AGGRO_SHOOT_COOLDOWN = 0.42;
const BOT_KAME_CHARGE = 1.0; // telegraph wind-up (charge VFX) before the beam fires
const BOT_KAME_COOLDOWN_MIN = 8.0; // seconds between mega beams
const BOT_KAME_COOLDOWN_RANGE = 6.0; // + up to this, randomized
const BOT_KAME_RANGE = 9.0; // only wind up a mega when within beam reach (~2×hearing)
const BOT_KAME_ABORT_RANGE = 11.0; // mid-charge: abort if the target slips past this
const BOT_KAME_REARM = 2.5; // short re-arm after an aborted (wasted) charge
const BOT_KAME_INTERRUPT_PENALTY = 1.0; // saber-interrupted charge can't re-wind for this long
const MELEE_STAGGER_FREE = 0.5; // guaranteed un-staggerable window after each stagger
// Saber knockback "pulinho": a decaying horizontal impulse (independent of the AI
// velocity so it isn't damped by the stun-freeze) + a small vertical hop back.
const KB_DECAY = 9.0; // exponential decay of the knockback impulse (per second)
const KB_DURATION = 0.32; // seconds the impulse is tracked
const KB_HOP = 3.4; // upward pop on a saber hit (a little hop, < JUMP_VELOCITY 6)

type State = "alive" | "falling" | "dead";

export class Bot implements BulletTarget {
  readonly id: string;
  /** Side used for bullet collision filtering (bots can alternate for bot-vs-bot damage). */
  readonly side: BulletOwner;
  readonly bodyHalfHeight = BOT_SIZE / 2;

  readonly root: THREE.Group;
  private body: THREE.Group;
  private avatar: Avatar;
  private shadow: BlobShadow;
  private aimGroup: THREE.Group;
  private gun: THREE.Group;
  private gunBarrelTip: THREE.Object3D;
  /** Floating name sprite (owns a per-instance CanvasTexture + material). */
  private nameLabel: THREE.Sprite;

  private platform: Platform;
  private audio: AudioEngine;
  private dust: DustParticles;
  private bullets: Bullets;
  private smoke: SmokePuffs | null = null;

  /** Behavior mode — set once in the constructor. */
  private readonly behavior: BotBehavior;
  /** Aggressive online bot: faster/snappier + can fire the mega beam. */
  private readonly aggressive: boolean;
  /** Display name (random for online bots so they read as real players). */
  private readonly displayName: string;
  /** Who last damaged this bot (name + perf.now ms) — for kill attribution. */
  private lastHitBy: { name: string; t: number } | null = null;
  /** Mega-beam (kamehameha) state. */
  private megaTimer = 0; // cooldown until the next mega beam
  private kameCharging = false; // true during the telegraph wind-up
  private kameChargeT = 0; // seconds charged so far
  private onKame?: (origin: THREE.Vector3, dir: THREE.Vector3) => void;

  private velocity = new THREE.Vector3(0, 0, 0);
  private grounded = true;
  private state: State = "alive";
  private fallTimer = 0;
  private deadTimer = 0;
  private targetScale = new THREE.Vector3(1, 1, 1);
  private health = MAX_HEALTH;
  private justDied = false;

  private hitFlashTimer = 0;
  private shakeTimer = 0;
  private shakeAmount = 0;

  // Saber stagger: full action freeze (stunTimer) + a longer constant-fire
  // lockout (constantFireLockTimer). Both decay in update(); knockback velocity
  // still integrates while stunned (the push must land). staggerFreeT is the
  // anti-refresh gate: the next stagger is only honored after it reaches 0.
  private stunTimer = 0;
  private constantFireLockTimer = 0;
  private staggerFreeT = 0;
  // Decaying saber-knockback impulse (separate from AI velocity → survives the
  // stun-freeze so the "pulinho para trás" is actually visible).
  private kbVx = 0;
  private kbVz = 0;
  private kbT = 0;
  // While >0 the body pulses WHITE (impact / "atordoado" feedback).
  private flashT = 0;

  private aimYaw = 0;
  private shootTimer = 0;
  private jumpTimer = 0;
  /** Periodic jump timer used in "ambient" mode (independent of hunt cooldowns). */
  private ambientJumpTimer = 0;
  private wanderTimer = 0;
  private wanderTarget = new THREE.Vector3();

  // Hoisted per-frame scratch so update() allocates nothing. Reset before use.
  private tmpMove = new THREE.Vector3();
  private tmpScale = new THREE.Vector3();

  readonly position = new THREE.Vector3();

  constructor(
    id: string,
    platform: Platform,
    audio: AudioEngine,
    dust: DustParticles,
    bullets: Bullets,
    /** Optional chosen animal name; defaults to a random animal. */
    animal?: string,
    /** Behavior mode: "hunt" (default) targets the passed entity; "ambient" wanders + jumps as a showcase actor. */
    behavior: BotBehavior = "hunt",
    /** Bullet-collision side; alternate "player"/"bot" for ambient bot-vs-bot damage. */
    side: BulletOwner = "bot",
    /** Aggressive online bot: faster, snappier, and can fire the mega beam. */
    aggressive = false,
    /** Display name; defaults to "Mob N". Online bots pass a random player name. */
    name?: string,
  ) {
    this.id = id;
    this.side = side;
    this.behavior = behavior;
    this.aggressive = aggressive;
    this.displayName = name ?? formatBotLabel(id);
    this.platform = platform;
    this.audio = audio;
    this.dust = dust;
    this.bullets = bullets;

    this.root = new THREE.Group();

    // Each mob is a random voxel animal; feet at the rig's ground reference.
    const animalName = animal ?? ModelLibrary.randomAnimalName();
    this.avatar = new Avatar(
      animalName,
      AVATAR_HEIGHT,
      -this.bodyHalfHeight,
    );
    this.body = this.avatar.group;
    this.root.add(this.body);

    // Square voxel contact shadow that shrinks/fades as the mob jumps.
    this.shadow = new BlobShadow(0.4, 0.16);
    this.root.add(this.shadow.mesh);

    this.aimGroup = new THREE.Group();
    this.root.add(this.aimGroup);

    // Floating name label above the bot's head.
    this.nameLabel = buildNameLabel(this.displayName);
    this.nameLabel.position.set(0, BOT_SIZE * 0.85 + 0.35, 0);
    this.root.add(this.nameLabel);

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

  /** One-shot: true the frame this bot just died (for gore + kill counting). */
  consumeJustDied(): boolean {
    if (this.justDied) {
      this.justDied = false;
      return true;
    }
    return false;
  }

  isAirborne() {
    return !this.grounded;
  }

  isGrounded() {
    return this.grounded;
  }

  /** Player-facing name (random for online bots) for the kill feed + roster. */
  getDisplayName(): string {
    return this.displayName;
  }

  /** Record who last damaged this bot (for kill attribution on death). */
  recordHitBy(name: string) {
    this.lastHitBy = { name, t: performance.now() };
  }

  /** Name of whoever killed this bot, or null if the hit was stale (lava/fall). */
  getLastHitByName(): string | null {
    if (!this.lastHitBy) return null;
    return performance.now() - this.lastHitBy.t < 4000 ? this.lastHitBy.name : null;
  }

  /** Register the mega-beam callback (Game fires the kamehameha beam). */
  setOnKame(cb: (origin: THREE.Vector3, dir: THREE.Vector3) => void) {
    this.onKame = cb;
  }

  /**
   * Charge VFX state while this bot is winding up its mega beam, or null. Game
   * reads it each frame to drive the inward particle stream (telegraph), keyed
   * by the bot id — exactly like the player/remote charge.
   */
  getKameCharge(): { anchor: THREE.Vector3; t: number } | null {
    if (!this.kameCharging || this.state !== "alive") return null;
    return {
      anchor: new THREE.Vector3(
        this.root.position.x,
        this.root.position.y + 0.35,
        this.root.position.z,
      ),
      t: Math.min(1, this.kameChargeT / BOT_KAME_CHARGE),
    };
  }

  takeHit(_direction: THREE.Vector3): boolean {
    // Ambient showcase actors are immortal — they never take damage.
    if (this.behavior === "ambient") return false;
    if (this.state !== "alive") return false;
    this.health = Math.max(0, this.health - 1);
    this.hitFlashTimer = HIT_FLASH_DURATION;
    this.shakeTimer = 0.22;
    this.shakeAmount = 0.05;
    this.targetScale.set(1.35, 0.7, 1.35);
    this.audio.playHit(this.root.position, true);
    if (this.health <= 0) {
      this.die();
    }
    return true;
  }

  /**
   * Saber push: a decaying horizontal impulse + a small upward HOP ("pulinho para
   * trás"). The impulse rides its own channel (integrated in update, NOT the AI
   * velocity), so the stun-freeze can't damp it — the knockback stays visible.
   */
  knockback(dir: THREE.Vector3, force: number): void {
    if (this.state !== "alive") return;
    this.kbVx = dir.x * force;
    this.kbVz = dir.z * force;
    this.kbT = KB_DURATION;
    if (this.grounded) {
      this.velocity.y = KB_HOP; // hop back
      this.grounded = false;
    }
  }

  /**
   * Saber stagger: a brief full-action freeze + a longer constant-fire lockout,
   * and (optionally) an interruption of any in-progress mega-beam charge — which
   * is reset to zero AND penalized so the bot can't immediately re-charge.
   *
   * Rate-limited: the next stagger is only honored once the prior effect has fully
   * expired + a free window (staggerFreeT). Without this, a player swinging every
   * ~0.55s would refresh the 1.0s fire-lock forever and keep the bot from ever
   * shooting; the free window guarantees it gets periodic windows to fight back.
   */
  applyMeleeStagger(
    stunSeconds: number,
    constantFireLockSeconds: number,
    interruptCharge: boolean,
  ): void {
    if (this.state !== "alive") return;
    if (this.staggerFreeT > 0) return; // still inside the previous stagger's gate
    this.stunTimer = stunSeconds;
    this.constantFireLockTimer = constantFireLockSeconds;
    // Pulse WHITE for the whole "atordoado" window (the no-shoot duration), so the
    // hit reads as a stun, not just a one-frame flash.
    this.flashT = constantFireLockSeconds;
    // Block an instant shot the moment the lock expires.
    this.shootTimer = Math.max(this.shootTimer, constantFireLockSeconds);
    if (interruptCharge && this.kameCharging) {
      this.kameCharging = false;
      this.kameChargeT = 0;
      this.megaTimer = Math.max(this.megaTimer, BOT_KAME_INTERRUPT_PENALTY);
    }
    this.staggerFreeT =
      Math.max(stunSeconds, constantFireLockSeconds) + MELEE_STAGGER_FREE;
  }

  /** Insta-kill from a Kamehameha beam (ignores incremental health). */
  kamehamehaHit(): void {
    if (this.behavior === "ambient") return;
    if (this.state !== "alive") return;
    this.health = 0;
    this.die();
  }

  private die() {
    // Ambient bots are immortal; this path is guarded in takeHit but belt+suspenders.
    if (this.behavior === "ambient") return;
    this.state = "dead";
    this.deadTimer = 0;
    this.justDied = true;
    this.audio.playDeath(this.root.position, true);
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
    this.avatar.reset();
    this.grounded = true;
    this.state = "alive";
    this.fallTimer = 0;
    this.deadTimer = 0;
    this.justDied = false;
    this.health = MAX_HEALTH;
    this.hitFlashTimer = 0;
    this.shakeTimer = 0;
    this.shootTimer = 0.5 + Math.random();
    this.jumpTimer = JUMP_COOLDOWN_MIN + Math.random() * JUMP_COOLDOWN_MAX;
    this.wanderTimer = 0;
    // Stagger the first mega beam so a fresh wave doesn't all fire at once.
    this.megaTimer = BOT_KAME_COOLDOWN_MIN * 0.5 + Math.random() * BOT_KAME_COOLDOWN_RANGE;
    this.kameCharging = false;
    this.kameChargeT = 0;
    this.stunTimer = 0;
    this.constantFireLockTimer = 0;
    this.staggerFreeT = 0;
    this.kbVx = 0;
    this.kbVz = 0;
    this.kbT = 0;
    this.flashT = 0;
    this.lastHitBy = null;
    this.position.copy(this.root.position);
  }

  private updateColor() {
    const t = 1 - this.health / MAX_HEALTH;
    // White on a fresh hit, then a ~10Hz pulse for the rest of the stagger window
    // ("continua a piscar em branco enquanto estiver atordoado").
    const stunPulse = this.flashT > 0 && Math.floor(this.flashT * 10) % 2 === 0;
    this.avatar.applyTint(t, this.hitFlashTimer > 0 || stunPulse);
  }

  /**
   * Tick the bot simulation.
   *
   * @param dt      Frame delta in seconds.
   * @param target  The entity to hunt ("hunt" mode) or null (ambient/no target).
   *                In normal local gameplay this is the local Player. In bot-vs-bot
   *                ambient scenes the caller passes the nearest enemy bot. Passing
   *                null makes the bot fall back to wandering regardless of mode.
   */
  update(dt: number, target: BulletTarget | null) {
    if (this.state === "dead") {
      this.deadTimer += dt;
      this.shadow.setVisible(false);
      // Bursts into voxel gore on death (spawned by Game) — hide the body.
      this.body.scale.setScalar(0.0001);
      this.avatar.setOpacity(0);
      this.position.copy(this.root.position);
      if (this.deadTimer >= RESPAWN_DELAY) {
        this.respawn();
      }
      return;
    }

    if (this.state === "falling") {
      this.fallTimer += dt;
      this.shadow.setVisible(false);
      this.velocity.y -= GRAVITY * dt * 0.5;
      this.root.position.addScaledVector(this.velocity, dt);
      this.root.rotation.x += dt * 6;
      this.root.rotation.z += dt * 4;
      const t = 1 - this.fallTimer / 0.7;
      this.avatar.setOpacity(Math.max(0, t));
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

    // Saber stagger timers decay every frame regardless of AI branch.
    if (this.stunTimer > 0) this.stunTimer = Math.max(0, this.stunTimer - dt);
    if (this.constantFireLockTimer > 0) {
      this.constantFireLockTimer = Math.max(0, this.constantFireLockTimer - dt);
    }
    if (this.staggerFreeT > 0) this.staggerFreeT = Math.max(0, this.staggerFreeT - dt);
    if (this.flashT > 0) this.flashT = Math.max(0, this.flashT - dt);

    // --- AI ---
    const move = this.tmpMove.set(0, 0, 0);
    const moveSpeed = this.aggressive ? AGGRO_MOVE_SPEED : MOVE_SPEED;
    const stunned = this.stunTimer > 0;

    if (stunned) {
      // Frozen: no steering, aim, shooting, or charge transitions — but gravity
      // and the existing (knockback) velocity still integrate below so the push
      // lands and the bot can be shoved off a ledge while staggered.
      this.aimGroup.rotation.y = -this.aimYaw;
    } else if (this.behavior === "ambient") {
      // Ambient showcase actor: wanders the platform and periodically jumps.
      // Ignores the passed target entirely; immortal (takeHit is a no-op).
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0) {
        const wander = this.platform.randomSpawn(8);
        this.wanderTarget.set(wander.x, 0, wander.z);
        this.wanderTimer = WANDER_INTERVAL + Math.random() * 2.5;
      }
      const wdx = this.wanderTarget.x - this.root.position.x;
      const wdz = this.wanderTarget.z - this.root.position.z;
      const wd = Math.hypot(wdx, wdz);
      if (wd > 0.5) {
        move.set(wdx, 0, wdz).normalize();
        this.aimYaw = Math.atan2(wdz, wdx);
        this.aimGroup.rotation.y = -this.aimYaw;
      }

      // Periodic jumps — keeps the showcase lively.
      this.ambientJumpTimer -= dt;
      if (this.grounded && this.ambientJumpTimer <= 0) {
        this.velocity.y = JUMP_VELOCITY;
        this.grounded = false;
        this.audio.playJump(this.root.position, true);
        this.targetScale.set(0.7, 1.4, 0.7);
        // Jump every 2–5 s (independent of hunt JUMP_COOLDOWN constants).
        this.ambientJumpTimer = 2.0 + Math.random() * 3.0;
      }
    } else {
      // "hunt" mode — target the passed entity (local Player or nearest enemy bot).
      const sight = this.aggressive ? AGGRO_SIGHT_RANGE : SIGHT_RANGE;
      const seesTarget =
        target !== null &&
        target.isAlive() &&
        Math.hypot(
          target.position.x - this.root.position.x,
          target.position.z - this.root.position.z,
        ) <= sight;

      // Target left sight mid-charge → abort (else the charge + its VFX freeze).
      if (this.kameCharging && !seesTarget) this.abortKameCharge();

      if (seesTarget && target !== null) {
        const dx = target.position.x - this.root.position.x;
        const dz = target.position.z - this.root.position.z;
        const distToTarget = Math.hypot(dx, dz);

        // Aim at target
        this.aimYaw = Math.atan2(dz, dx);
        this.aimGroup.rotation.y = -this.aimYaw;

        if (this.kameCharging) {
          // Winding up the mega beam: stand still (telegraph) until it fires.
          // ABORT if the target dashed out of beam reach mid-charge (don't fire a
          // wasted beam at someone who escaped); a short re-arm avoids instant retry.
          if (distToTarget > BOT_KAME_ABORT_RANGE) {
            this.abortKameCharge();
          } else {
            this.kameChargeT += dt;
            if (this.kameChargeT >= BOT_KAME_CHARGE) {
              this.fireMega();
              this.kameCharging = false;
              this.megaTimer =
                BOT_KAME_COOLDOWN_MIN + Math.random() * BOT_KAME_COOLDOWN_RANGE;
            }
          }
          // move stays (0,0,0) — frozen while charging.
        } else {
          // Approach to a comfortable shooting distance (closer when aggressive;
          // the non-aggressive local tune also closes a bit — 5 was 6).
          const desired = this.aggressive ? 5 : 5;
          if (distToTarget > desired + 0.5) {
            move.set(dx, 0, dz).normalize();
          } else if (distToTarget < desired - 0.5) {
            move.set(-dx, 0, -dz).normalize();
          }

          // Shoot on cooldown — suppressed while saber-locked out of fire.
          const shootCd = this.aggressive ? AGGRO_SHOOT_COOLDOWN : SHOOT_COOLDOWN;
          this.shootTimer -= dt;
          if (this.shootTimer <= 0 && this.constantFireLockTimer <= 0) {
            this.shoot();
            this.shootTimer = shootCd + Math.random() * 0.35;
          }

          // Occasionally jump (so it can hit airborne targets)
          this.jumpTimer -= dt;
          if (this.grounded && this.jumpTimer <= 0) {
            this.velocity.y = JUMP_VELOCITY;
            this.grounded = false;
            this.audio.playJump(this.root.position, true);
            this.targetScale.set(0.7, 1.4, 0.7);
            this.jumpTimer =
              JUMP_COOLDOWN_MIN + Math.random() * JUMP_COOLDOWN_MAX;
          }

          // Bots periodically wind up a TELEGRAPHED mega beam (BOT_KAME_CHARGE
          // wind-up) when they have a clear shot in range — dodgeable AND now
          // saber-parryable. Any bot with an onKame handler may do this (local
          // bots included), so the super-parry has something to deflect offline.
          if (this.onKame) {
            this.megaTimer -= dt;
            if (this.megaTimer <= 0 && distToTarget <= BOT_KAME_RANGE) {
              this.kameCharging = true;
              this.kameChargeT = 0;
            }
          }
        }
      } else {
        // No target in range — wander
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
    }

    this.avatar.faceYaw(this.aimYaw);

    // Movement
    const targetVx = move.x * moveSpeed;
    const targetVz = move.z * moveSpeed;
    const lerpAmt = 1 - Math.exp(-ACCEL * dt);
    this.velocity.x += (targetVx - this.velocity.x) * lerpAmt;
    this.velocity.z += (targetVz - this.velocity.z) * lerpAmt;

    // Gravity
    this.velocity.y -= GRAVITY * dt;

    // Apply
    this.root.position.addScaledVector(this.velocity, dt);

    // Saber knockback impulse: integrated on its own decaying channel so the
    // stun-freeze (which zeroes the AI velocity) can't damp the push.
    if (this.kbT > 0) {
      this.kbT -= dt;
      this.root.position.x += this.kbVx * dt;
      this.root.position.z += this.kbVz * dt;
      const k = Math.exp(-KB_DECAY * dt);
      this.kbVx *= k;
      this.kbVz *= k;
      if (this.kbT <= 0) {
        this.kbVx = 0;
        this.kbVz = 0;
      }
    }

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
        this.audio.playLand(this.root.position, true);
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
        this.audio.playFall(this.root.position, true);
        this.grounded = false;
      }
    } else {
      this.grounded = false;
    }

    // Squash + lean
    const speedXZ = Math.hypot(this.velocity.x, this.velocity.z);
    const speedRatio = Math.min(1, speedXZ / moveSpeed);
    if (this.grounded) {
      const stretch = 1 + speedRatio * 0.18;
      const squish = 1 - speedRatio * 0.1;
      this.targetScale.lerp(this.tmpScale.set(squish, stretch * 0.95, squish), 0.18);
      if (speedRatio < 0.05) {
        this.targetScale.lerp(this.tmpScale.set(1, 1, 1), 0.2);
      }
    } else {
      this.targetScale.lerp(this.tmpScale.set(1, 1, 1), 0.06);
    }
    const leanX = THREE.MathUtils.clamp(this.velocity.z / moveSpeed, -1, 1);
    const leanZ = THREE.MathUtils.clamp(-this.velocity.x / moveSpeed, -1, 1);
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
      this.body.position.lerp(this.tmpScale.set(0, 0, 0), 0.4);
    }

    if (this.hitFlashTimer > 0) this.hitFlashTimer -= dt;
    this.updateColor();
    this.body.scale.lerp(this.targetScale, SQUASH_LERP_VAL);

    // Contact shadow: hugs the ground and shrinks as the feet rise on a jump.
    this.shadow.setVisible(true);
    this.shadow.apply(
      this.root.position.y - this.bodyHalfHeight - groundSurfY,
      groundSurfY - this.root.position.y + 0.02,
    );

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
    // Use this.side as the bullet owner so that alternating-side bots can
    // damage each other (the collision filter skips bullets whose owner matches
    // the target's side — opposite sides hit each other). this.id attributes the
    // kill (e.g. "Mob 2 matou o Bero").
    this.bullets.spawn(muzzle, dir, this.side, this.id);
    this.audio.playShot(this.root.position, true);
    if (this.smoke) {
      this.smoke.spawnFlash(muzzle, dir);
      this.smoke.spawnPuff(muzzle, dir, 5, "#bbbbbb");
    }
  }

  /** Fire the mega beam (kamehameha) toward the current aim. Game owns the beam. */
  private fireMega() {
    const muzzle = new THREE.Vector3();
    this.gunBarrelTip.getWorldPosition(muzzle);
    const dir = new THREE.Vector3(
      Math.cos(this.aimYaw),
      0,
      Math.sin(this.aimYaw),
    );
    this.onKame?.(muzzle.clone(), dir);
    // Recoil pop on release.
    this.targetScale.set(1.3, 0.82, 1.3);
  }

  /** Cancel a mega wind-up cleanly (target escaped / left sight): no beam, short
   *  re-arm so a wasted telegraph isn't punished forever. Clearing kameCharging
   *  also drops the charge VFX (Game reads getKameCharge() each frame). */
  private abortKameCharge() {
    this.kameCharging = false;
    this.kameChargeT = 0;
    this.megaTimer = Math.max(this.megaTimer, BOT_KAME_REARM);
  }

  setSmoke(smoke: SmokePuffs) {
    this.smoke = smoke;
  }

  /** Force-kill the bot (used by environmental hazards like lava). */
  killByHazard() {
    if (this.state !== "alive") return;
    this.health = 0;
    this.justDied = true;
    this.audio.playDeath(this.root.position, true);
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
    this.avatar.dispose();
    this.shadow.dispose();
    // Gun geometries + its per-instance material (shared across the gun meshes;
    // Material.dispose() is idempotent so per-mesh disposal is safe).
    this.gun.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else if (mat) mat.dispose();
    });
    // Name label owns a per-instance CanvasTexture (~64KB GPU) + SpriteMaterial.
    const labelMat = this.nameLabel.material as THREE.SpriteMaterial;
    labelMat.map?.dispose();
    labelMat.dispose();
  }
}

const SQUASH_LERP_VAL = 0.22;

/** Convert internal bot ids like "bot_3" into a player-facing tag like "Mob 3". */
function formatBotLabel(id: string): string {
  const m = id.match(/(\d+)/);
  const n = m ? m[1] : "?";
  return `Mob ${n}`;
}
