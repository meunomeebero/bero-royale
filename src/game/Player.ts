import * as THREE from "three";
import type { Platform } from "./Platform";
import type { InputManager } from "./InputManager";
import type { AudioEngine } from "./AudioEngine";
import type { DustParticles } from "./DustParticles";
import type { Bullets, BulletTarget } from "./Bullets";
import type { SmokePuffs } from "./SmokePuffs";
import type { GrassPoof } from "./GrassPoof";
import { Avatar, AVATAR_HEIGHT } from "./Avatar";
import { ModelLibrary } from "./ModelLibrary";
import { BlobShadow } from "./Shadow";
import { buildGun, buildSaber } from "./PigParts";
import {
  MOVE_SPEED,
  JUMP_VELOCITY,
  GRAVITY,
  FALL_DURATION,
  DASH_STRETCH_DURATION,
  SQUASH_LERP,
} from "./consts";
import {
  MELEE_SWING_DUR,
  SABER_REST_YAW,
  SWING_WINDUP_END_T,
  BASE_SABER_MOUNT,
  sampleSaberYaw,
  saberMountX,
} from "./saberKinematics";

const PLAYER_SIZE = 0.5;
const ACCEL = 28;

const SHOOT_COOLDOWN = 0.1; // pistol: ~10 shots/s (+20% rate/DPS vs the old 0.12)

const MAX_HEALTH = 10;
const RESPAWN_DELAY = 5.0; // seconds
const HIT_FLASH_DURATION = 0.25;
/** BR-style shield: each pickup adds one charge that soaks a hit; cap this many. */
const MAX_SHIELD = 10;
/** Temporary boosts (speed/rapid) stack up to this many pickups' worth of time. */
const STACK_MAX = 3;

const DASH_MAX_CHARGES = 3; // base dashes before recharging
const DASH_MAX_CAP = 6; // hard cap including TEMPORARY bonus bars from dash pickups
const DASH_RECHARGE = 3.0; // seconds to refill one BASE charge (9s for all 3)
const DASH_IMPULSE = 36.0; // strong forward launch (~9 tiles)

// ── Fire modes / weapons (Tab toggles / hotbar 1·2·3) ───────────────────────
// "pistol"      — Weapon 1: hold to autofire normal shots (fast + high rate of fire).
// "energyBlast" — Weapon 2: hold to CHANNEL the super shot; release when ready to fire.
// "lightsaber"  — Weapon 3: heavy melee; high damage + deflects shots if timed right.
// "boss"        — hidden easter egg (name "bero", double-tap Tab): 3× HP, 10×
//                  size, rapid-fire mega beams at half damage.
export type FireMode = "pistol" | "energyBlast" | "boss" | "lightsaber";

/** Hotbar weapon slots (Minecraft-style): index → FireMode. "boss" is a separate
 *  override (the "bero" easter egg), NOT a slot. */
const SLOT_MODES: FireMode[] = ["pistol", "energyBlast", "lightsaber"];

// ── Weapon "weight" → movement-speed multiplier while that weapon is active ──
// Balance: the pistol is the fast run-and-gun weapon (+30%). The energy blast matches
// it WHILE IDLE (+30%) and only slows once channeling begins (SUPER_LOADED_SPEED_MULT
// below). The lightsaber is heavy (−10%). Multiplies with the "speed" power-up.
// Affects sustained run speed only — dash impulse is unchanged. "boss" stays neutral.
const WEAPON_SPEED_MULT: Record<FireMode, number> = {
  pistol: 1.3,
  energyBlast: 1.3, // fast as the pistol when NOT channeling; slows only mid-channel
  lightsaber: 0.9,
  boss: 1.0,
};

// While CHANNELING the energy blast (kameState charging/ready), the player slows to
// this (−20%) — the channel-and-kite nerf. Idle energy-blast speed is the pistol's.
const SUPER_LOADED_SPEED_MULT = 0.8;

/**
 * Per-frame snapshot of an in-progress saber swing. Emitted by Player every
 * frame the swing is active; Game uses it to resolve arc hits (strike phase,
 * once per target per `swingId`) and bullet parry (parry sub-window). The blade
 * segment is the live world-space `pivot → tip` so collision matches the visual.
 */
export interface MeleeSample {
  swingId: number;
  /** "windup" | "strike" — only "strike" deals damage (the return to rest is the
   *  post-swing settle, not a sampled phase). */
  phase: "windup" | "strike";
  /** True while inside the reflection (parry) sub-window. */
  parry: boolean;
  /** Frame delta — Game suppresses collision/parry on huge steps (tab resume). */
  dt: number;
  /** Player body center (swing origin). */
  origin: THREE.Vector3;
  /** Normalized XZ facing direction — frozen for the whole swing (committed at
   *  swing start), matching the start-direction sent to remote clients. */
  aimDir: THREE.Vector3;
  /** Live blade segment in world space (pivot end → tip end). */
  bladeStart: THREE.Vector3;
  bladeEnd: THREE.Vector3;
}

// ── Melee saber (hotbar slot 3) — swing timing; damage/range live in Game ──
// The swing KINEMATICS (sampleSaberYaw, saberMountX, MELEE_SWING_DUR, SABER_REST_YAW,
// SWING_WINDUP_END_T, BASE_SABER_MOUNT, …) live in ./saberKinematics so the local
// player and the networked RemotePlayer sweep the IDENTICAL arc (netcode fidelity —
// see docs/systems/netcode-fidelity-golden-rule.md). Only the LOCAL-only input
// timing / parry-window / stagger numbers stay here.
const MELEE_COOLDOWN = 0.55; // seconds between swings while held (was 0.45; offsets 2× range + parry)
// Parry window (fraction of the swing) — when the blade can reflect projectiles.
const SWING_PARRY_START_T = 0.2;
const SWING_PARRY_END_T = 0.75;
// Stagger taken BY the local player from an ENERGY-BLAST hit. (2026 rebalance: the
// stun moved OFF the lightsaber — which no longer stuns — ONTO the energy blast.)
const MELEE_STUN = 0.25; // brief full-action freeze
const MELEE_FIRE_LOCK = 1.0; // constant-fire lockout (~1s)
const STAGGER_HOP = 3.4; // small upward "pulinho" on a stagger (< JUMP_VELOCITY 6)
const KAME_CHARGE = 1.5; // channel time to ready the energy blast (−50% from 3.0)
const BOSS_HP_MULT = 3; // boss has triple HP
const BOSS_SCALE = 5; // boss is 5× the normal size
const BOSS_CADENCE = 0.18; // seconds between boss mega beams (≈ constant fire feel)
const DOUBLE_TAB_MS = 350; // two Tabs within this window = enter boss (bero only)
const DASH_DECAY = 8.0; // travels ~DASH_IMPULSE/DASH_DECAY ≈ 4.5 units

type State = "alive" | "falling" | "dead";

export class Player implements BulletTarget {
  readonly id = "player";
  readonly side = "player" as const;
  bodyHalfHeight = PLAYER_SIZE / 2; // grows ×BOSS_SCALE in boss mode

  /** Root object: holds the animal body + gun. */
  readonly root: THREE.Group;
  private body: THREE.Group;
  private avatar: Avatar;
  private shadow: BlobShadow;
  private aimGroup: THREE.Group;
  private gun: THREE.Group;
  private gunBarrelTip: THREE.Object3D;

  private platform: Platform;
  private input: InputManager;
  private audio: AudioEngine;
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
  private shootTimer = 0;

  // Fire mode + charged-special state.
  private fireMode: FireMode = "pistol";
  private bossUnlocked = false; // true only for the "bero" easter egg
  private lastTabMs = 0; // for double-tap-Tab detection
  private kameState: "idle" | "charging" | "ready" = "idle";
  private kameTimer = 0; // seconds held while "charging"
  private onKame?: (origin: THREE.Vector3, dir: THREE.Vector3, lethal: boolean) => void;
  // Melee saber (slot 3) — floats in front, baseball-bat swing on attack.
  private staff!: THREE.Group;
  private staffPivot!: THREE.Group;
  private staffTip!: THREE.Object3D;
  private swingTimer = 0; // >0 while the swing animation plays
  private swingElapsed = 0; // seconds since the swing started
  private swingId = 0; // bumped per swing; Game keys its per-swing hit-set on this
  // Fired once at swing start (broadcast the swing for remotes).
  private onMelee?: (origin: THREE.Vector3, dir: THREE.Vector3) => void;
  // Fired every frame during the swing — Game resolves arc hits + bullet parry.
  private onMeleeSample?: (s: MeleeSample) => void;
  // Fired once when the swing ends, with the blade-tip world pos — Game spawns
  // the white smoke-cube puff there.
  private onMeleeEnd?: (x: number, y: number, z: number) => void;
  // Saber stagger taken by the local player (from a remote saber hit).
  private stunTimer = 0;
  private fireLockTimer = 0;
  private staggerFlashT = 0; // >0 → body pulses white (saber-hit "atordoado" feedback)
  // Scratch reused each swing sample (no per-frame allocation).
  private swingBladeStart = new THREE.Vector3();
  private swingBladeEnd = new THREE.Vector3();
  /** Optional spawn chooser — Game returns a spot far from other players so the
   *  player doesn't respawn on top of an enemy and die instantly. */
  private spawnPicker?: () => THREE.Vector3 | null;
  private health = MAX_HEALTH;

  private dashCharges = DASH_MAX_CHARGES;
  private dashStretchTimer = 0;
  private dashYaw = 0;
  private dashVel = new THREE.Vector3(0, 0, 0);

  private hitFlashTimer = 0;
  private shakeTimer = 0;
  private shakeAmount = 0;

  // Timed power-up boosts (online only). Each holds remaining seconds (decremented
  // in update) + its per-pickup base (the HUD bar fills toward base × STACK_MAX,
  // since boosts stack up to STACK_MAX pickups' worth of time).
  private speedTimer = 0;
  private speedBase = 0;
  private rapidTimer = 0;
  private rapidBase = 0;
  /** BR-style shield charges: each absorbs one hit before health. Accumulates. */
  private shieldPoints = 0;

  // One-shot net flags consumed by Game each frame (mirror Bot.consumeJustDied).
  private justDashed = false;
  private justJumped = false;
  private justDied = false;

  /** Fired in shoot() with the world muzzle origin, aim dir, and bullet color. */
  private onFire?: (
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    color: string,
  ) => void;

  private tmpAim = new THREE.Vector3();
  private tmpDir = new THREE.Vector3();

  // Hoisted per-frame scratch (updateAim + squash/stretch + shake) so the hot
  // update path allocates nothing. Each is reset before use; never aliased.
  private aimRaycaster = new THREE.Raycaster();
  private aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private tmpScale = new THREE.Vector3();

  private aimYaw = 0;
  private gunRecoil = 0;
  private gunBaseX = 0.12;

  /** Exposed center of body (BulletTarget). */
  readonly position = new THREE.Vector3();

  constructor(
    platform: Platform,
    input: InputManager,
    audio: AudioEngine,
    dust: DustParticles,
    bullets: Bullets,
    animal?: string,
  ) {
    this.platform = platform;
    this.input = input;
    this.audio = audio;
    this.dust = dust;
    this.bullets = bullets;

    this.root = new THREE.Group();

    // Body is the player's chosen voxel animal (random if none picked). Feet sit
    // at the rig's ground reference (-bodyHalfHeight below the root, where the
    // old cube's bottom face was).
    this.avatar = new Avatar(
      animal ?? ModelLibrary.randomAnimalName(),
      AVATAR_HEIGHT,
      -this.bodyHalfHeight,
    );
    this.body = this.avatar.group;
    this.root.add(this.body);

    // Square voxel contact shadow that shrinks/fades as the player jumps.
    this.shadow = new BlobShadow(0.42, 0.17);
    this.root.add(this.shadow.mesh);

    this.aimGroup = new THREE.Group();
    this.root.add(this.aimGroup);

    const { group: gun, barrelTip } = buildGun();
    this.gun = gun;
    this.gunBarrelTip = barrelTip;
    this.gun.position.set(this.gunBaseX, 0, -0.3);
    this.aimGroup.add(this.gun);

    // Energy saber (slot 3) — floats in front of the cube, held by an invisible
    // hand. Mounted on local +X (= aim/forward); the per-frame mount distance is
    // pushed out during the wind-up so the swept blade never touches the body.
    const saberParts = buildSaber();
    this.staff = saberParts.group;
    this.staffPivot = saberParts.pivot;
    this.staffTip = saberParts.tip;
    this.staff.position.set(BASE_SABER_MOUNT, 0.05, 0);
    this.staffPivot.rotation.y = SABER_REST_YAW;
    this.staff.visible = false;
    this.aimGroup.add(this.staff);

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

  /** Seconds remaining until respawn while dead (0 when alive/falling). Drives
   *  the HUD respawn countdown. */
  getRespawnRemaining(): number {
    if (this.state !== "dead") return 0;
    return Math.max(0, RESPAWN_DELAY - this.deadTimer);
  }

  /** Current dash charges (0..max, fractional while recharging). */
  getDashCharges(): number {
    return this.dashCharges;
  }

  getDashMaxCharges(): number {
    // Grows with temporary bonus bars from dash pickups (held charges above the
    // base), so the HUD shows the extra bars until they're spent — capped at 6.
    return Math.min(
      DASH_MAX_CAP,
      Math.max(DASH_MAX_CHARGES, Math.ceil(this.dashCharges)),
    );
  }

  isDashReady(): boolean {
    return this.dashCharges >= 1;
  }

  /** Current aim yaw (for multiplayer broadcast / facing remote players). */
  getAimYaw(): number {
    return this.aimYaw;
  }

  /** Velocity components for multiplayer dead-reckoning / juice. */
  getVx(): number {
    return this.velocity.x;
  }
  getVz(): number {
    return this.velocity.z;
  }
  getVy(): number {
    return this.velocity.y;
  }

  /** Consume the one-shot dash flag (true once after a dash). */
  consumeJustDashed(): boolean {
    const v = this.justDashed;
    this.justDashed = false;
    return v;
  }

  /** Dash yaw captured at the last dash (atan2(dz,dx)). */
  getDashYaw(): number {
    return this.dashYaw;
  }

  /** Consume the one-shot jump flag (true once after a jump). */
  consumeJustJumped(): boolean {
    const v = this.justJumped;
    this.justJumped = false;
    return v;
  }

  /** Consume the one-shot death flag (true once after dying). */
  consumeJustDied(): boolean {
    const v = this.justDied;
    this.justDied = false;
    return v;
  }

  /** Register the fire callback (bullets + audio relay for multiplayer). */
  setOnFire(
    cb: (origin: THREE.Vector3, dir: THREE.Vector3, color: string) => void,
  ) {
    this.onFire = cb;
  }

  /** The random animal this player is wearing (for multiplayer broadcast). */
  getAnimal(): string {
    return this.avatar.animalName;
  }

  /** Fired when a beam launches. `lethal` true = concentrated super, false = boss
   *  mega beam — both deal half-bar damage (two hits to kill). Game spawns + relays. */
  setOnKame(cb: (origin: THREE.Vector3, dir: THREE.Vector3, lethal: boolean) => void) {
    this.onKame = cb;
  }

  /** Register a spawn-point chooser so respawns land far from other players. */
  setSpawnPicker(cb: () => THREE.Vector3 | null) {
    this.spawnPicker = cb;
  }

  getFireMode(): FireMode {
    return this.fireMode;
  }

  /** Enable the "boss" easter egg (caller decides from the username "bero"). */
  setBossUnlocked(on: boolean) {
    this.bossUnlocked = on;
  }

  /** Tab cycles the 3 hotbar slots (pistol → energyBlast → lightsaber → …); from
   *  the boss override it drops back to the first slot. */
  toggleFireMode() {
    const i = SLOT_MODES.indexOf(this.fireMode);
    this.setFireMode(SLOT_MODES[i < 0 ? 0 : (i + 1) % SLOT_MODES.length]);
  }

  /** Select a hotbar slot directly (keys 1/2/3 or a HUD slot click). */
  setWeaponSlot(slot: number) {
    const m = SLOT_MODES[Math.max(0, Math.min(SLOT_MODES.length - 1, slot))];
    if (m !== this.fireMode) this.setFireMode(m);
  }

  /** Active hotbar slot (0/1/2), or -1 while in the boss override. */
  getWeaponSlot(): number {
    return SLOT_MODES.indexOf(this.fireMode);
  }

  /** Small knockback impulse (reuses the dash-velocity mechanism). */
  applyKnockback(dir: THREE.Vector3, force: number) {
    this.dashVel.set(dir.x * force, 0, dir.z * force);
  }

  /** Register the swing-start handler (Game broadcasts the swing for remotes). */
  setOnMelee(cb: (origin: THREE.Vector3, dir: THREE.Vector3) => void) {
    this.onMelee = cb;
  }

  /** Register the per-frame swing sampler (Game resolves arc hits + bullet parry). */
  setOnMeleeSample(cb: (s: MeleeSample) => void) {
    this.onMeleeSample = cb;
  }

  /** Register the swing-end hook (Game spawns the end-of-swing smoke-cube puff). */
  setOnMeleeEnd(cb: (x: number, y: number, z: number) => void) {
    this.onMeleeEnd = cb;
  }

  /** True while a saber stagger is freezing this player's actions. */
  isStunned(): boolean {
    return this.stunTimer > 0;
  }

  /** Cancel any in-progress concentrated-super charge (saber interruption). */
  cancelKameCharge() {
    if (this.kameState !== "idle") {
      this.kameState = "idle";
      this.kameTimer = 0;
    }
  }

  /**
   * Take a saber stagger from a remote attacker: a brief full-action freeze + a
   * constant-fire lockout, and (optionally) interruption of the concentrated
   * super charge — resetting it to zero. Timers refresh via max() so repeated
   * hits can't stun-lock. Knockback rides the separate applyKnockback() cue.
   */
  applyMeleeStagger(
    stunSeconds: number,
    fireLockSeconds: number,
    interruptCharge: boolean,
  ) {
    if (this.state !== "alive") return;
    this.stunTimer = Math.max(this.stunTimer, stunSeconds);
    this.fireLockTimer = Math.max(this.fireLockTimer, fireLockSeconds);
    // Pulse white for the whole no-shoot window + a small backward hop so a saber
    // hit reads as a stagger (the horizontal push rides applyKnockback's dashVel).
    this.staggerFlashT = Math.max(this.staggerFlashT, fireLockSeconds);
    if (this.grounded) {
      this.velocity.y = STAGGER_HOP;
      this.grounded = false;
    }
    if (interruptCharge) this.cancelKameCharge();
  }

  private setFireMode(mode: FireMode) {
    const wasBoss = this.fireMode === "boss";
    this.fireMode = mode;
    this.kameState = "idle";
    this.kameTimer = 0;
    // Cancel any in-flight swing so a hidden saber can't keep resolving hits.
    this.swingTimer = 0;
    this.swingElapsed = 0;
    this.staffPivot.rotation.y = SABER_REST_YAW;
    this.staff.position.x = BASE_SABER_MOUNT;
    // Held item: lightsaber for melee, gun for the pistol + boss, NOTHING for the
    // energy blast (it channels bare-handed). The gun's barrel-tip anchor still
    // provides the beam's muzzle origin even while the gun mesh is hidden (the
    // transform is unaffected by visibility).
    this.staff.visible = mode === "lightsaber";
    this.gun.visible = mode === "pistol" || mode === "boss";
    if ((mode === "boss") !== wasBoss) this.applyBossState(mode === "boss");
  }

  /** Apply/remove the boss buffs: ×3 HP, ×10 size, bigger hitbox + ground lift. */
  private applyBossState(on: boolean) {
    this.bodyHalfHeight = (PLAYER_SIZE / 2) * (on ? BOSS_SCALE : 1);
    this.root.scale.setScalar(on ? BOSS_SCALE : 1);
    this.health = this.getMaxHealth();
    if (this.state === "alive") {
      const sy = this.platform.surfaceY(this.root.position.x, this.root.position.z);
      this.root.position.y = sy + this.bodyHalfHeight;
    }
  }

  /**
   * Local charge state for the VFX, or null when idle. `t` is 0→1 progress;
   * `anchor` is the world point in front of the player where the orb forms.
   * Returns a value while charging AND while "ready" (so the full orb lingers).
   */
  /**
   * Seconds needed to charge the concentrated super. The "Tiro rápido" power-up
   * (rapid) halves it — so rapid speeds up BOTH the pistol AND the super charge.
   */
  private kameChargeTime(): number {
    return KAME_CHARGE * (this.rapidTimer > 0 ? 0.5 : 1);
  }

  getKameCharge(): { t: number; anchor: THREE.Vector3 } | null {
    if (this.kameState === "idle" || this.state !== "alive") return null;
    // Particles stream INTO the player's body.
    const anchor = new THREE.Vector3(
      this.root.position.x,
      this.root.position.y + 0.35,
      this.root.position.z,
    );
    return { t: Math.min(1, this.kameTimer / this.kameChargeTime()), anchor };
  }

  /** Charge state for the multiplayer broadcast (so the lobby sees the wind-up). */
  getChargeState(): { charging: boolean; t: number } {
    if (this.kameState === "idle" || this.state !== "alive") {
      return { charging: false, t: 0 };
    }
    return { charging: true, t: Math.min(1, this.kameTimer / this.kameChargeTime()) };
  }

  /** 0→1 concentrated-charge progress for the HUD fill (0 when not charging). */
  getChargeProgress(): number {
    if (this.kameState === "idle" || this.state !== "alive") return 0;
    return Math.min(1, this.kameTimer / this.kameChargeTime());
  }

  private onKameReady() {
    // White flash + level-up cue so the player knows they can release to fire.
    this.hitFlashTimer = HIT_FLASH_DURATION;
    this.audio.playPowerUp(this.root.position, true);
  }

  /** Fire one normal pistol shot, respecting the rapid-fire cooldown. The
   *  "rapid" power-up halves the cooldown (fire twice as fast) while active. */
  private tryPistol() {
    if (this.shootTimer > 0) return;
    this.shoot();
    this.shootTimer = SHOOT_COOLDOWN * (this.rapidTimer > 0 ? 0.5 : 1);
  }

  private fireKame(lethal: boolean) {
    const dir = this.getAimDirection(this.tmpDir).clone();
    const muzzle = new THREE.Vector3();
    if (this.fireMode === "energyBlast") {
      // Bare-handed channel: emit from the chest, slightly forward along aim, so the
      // beam doesn't appear to leave a floating muzzle where the hidden gun would be.
      // (Matches the charge orb anchored at the body center.)
      muzzle.copy(this.root.position);
      muzzle.y += 0.3;
      muzzle.addScaledVector(dir, 0.4);
    } else {
      this.gunBarrelTip.getWorldPosition(muzzle); // pistol + boss hold the gun
    }
    this.onKame?.(muzzle.clone(), dir, lethal);
    this.audio.playShot(this.root.position, true);
    this.gunRecoil = 0.14;
    this.targetScale.set(1.3, 0.82, 1.3);
  }

  /**
   * Reconcile to the server's authoritative HP+shield (the "honest HUD" sync).
   * The server echoes these whenever they change so the local bar tracks truth
   * instead of drifting from under-/over-predicted local cues — the fix for
   * "died at full HP/shield". Ignored while dead (a late frame can't revive the
   * bar); if the authoritative health is 0 we fall through to the same death the
   * "died" event drives (idempotent via serverKilled).
   */
  setHealthShield(health: number, shield: number) {
    if (this.state !== "alive") return;
    this.health = Math.max(0, Math.min(this.getMaxHealth(), health));
    this.shieldPoints = Math.max(0, Math.min(MAX_SHIELD, shield));
    if (this.health <= 0) this.serverKilled();
  }

  /**
   * Authoritative kill from the server's "died" event. Makes our client agree we
   * died even if we missed the throttled "hit" cues (so we don't keep playing
   * while dead to everyone else). Idempotent — no-op unless currently alive, so
   * it never double-fires with the local hit-cue death path.
   */
  serverKilled() {
    if (this.state !== "alive") return;
    this.health = 0;
    this.die(); // die() clears shield (single death chokepoint)
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
    this.audio.playDeath(this.root.position, true);
    this.justDied = true;
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
    return MAX_HEALTH * (this.fireMode === "boss" ? BOSS_HP_MULT : 1);
  }

  // ── Power-up effects (server-authoritative, online only) ───────────────────
  // Game calls these on THIS client when the server says we picked one up. They
  // are self-contained: timers are stored here and integrated into movement,
  // cooldown, takeHit and update.

  /** "heal" — restore to full health (instant). */
  heal() {
    this.health = this.getMaxHealth();
  }

  /** "speed" — move ×1.6. Stacks: each pickup adds `seconds`, capped at ×STACK_MAX. */
  applySpeed(seconds: number) {
    this.speedBase = seconds;
    this.speedTimer = Math.min(this.speedTimer + seconds, seconds * STACK_MAX);
  }

  /** "rapid" — pistol + concentrated charge ×2 faster. Stacks like speed. */
  applyRapid(seconds: number) {
    this.rapidBase = seconds;
    this.rapidTimer = Math.min(this.rapidTimer + seconds, seconds * STACK_MAX);
  }

  /** "dash" pickup — grant one TEMPORARY bonus dash bar, up to DASH_MAX_CAP (6).
   *  Bonus bars above the base 3 do NOT recharge: they're spent as the player
   *  dashes, and the bar count then settles back toward 3. */
  addDashBar() {
    this.dashCharges = Math.min(DASH_MAX_CAP, Math.floor(this.dashCharges) + 1);
  }

  /** "shield" — gain one accumulating shield charge (BR armor), capped at MAX_SHIELD. */
  applyShield() {
    // Mirror the server's addShield (!p.alive) guard: never arm a dead/corpse,
    // so a late "putake" can't re-raise a shield pip after a predicted death.
    if (this.state !== "alive") return;
    this.shieldPoints = Math.min(this.shieldPoints + 1, MAX_SHIELD);
  }

  /** Current shield charges (drives the shield row under the HP pips). */
  getShield(): number {
    return this.shieldPoints;
  }

  /** Active TIMED boosts (speed/rapid) with remaining>0, for the HUD chips.
   *  `duration` is ONE pickup's seconds, so the HUD reads `remaining/duration`
   *  as a 0→STACK_MAX stack count and renders the segmented countdown. */
  getBoosts(): { kind: string; remaining: number; duration: number }[] {
    const out: { kind: string; remaining: number; duration: number }[] = [];
    if (this.speedTimer > 0)
      out.push({ kind: "speed", remaining: this.speedTimer, duration: this.speedBase });
    if (this.rapidTimer > 0)
      out.push({ kind: "rapid", remaining: this.rapidTimer, duration: this.rapidBase });
    return out;
  }

  getState() {
    return this.state;
  }

  /** BulletTarget callback. */
  takeHit(_direction: THREE.Vector3): boolean {
    if (this.state !== "alive") return false;
    this.audio.playHit(this.root.position, true);
    return this.applyDamage(1);
  }

  /**
   * Cosmetic hit reaction (flash + shake + squash + hit SFX) with NO HP change.
   * Used for the LOCAL player's network "hit" cue in multiplayer: HP is owned by
   * the server's authoritative "hp" echo and death by the gated "died", so the
   * cue stays presentation-only and we never predict a death before the tracer
   * visibly lands. See docs/systems/netcode-hit-sync-plan.md (Phase 3).
   */
  playHitReaction() {
    if (this.state !== "alive") return;
    this.audio.playHit(this.root.position, true);
    this.hitFlashTimer = HIT_FLASH_DURATION;
    this.shakeTimer = 0.25;
    this.shakeAmount = 0.06;
    this.targetScale.set(1.35, 0.7, 1.35);
  }

  /**
   * Apply `amount` points of damage: shield charges (BR armor) soak one point
   * each FIRST, then health. Dies when health hits 0. So a 10-damage super on a
   * player with 5 shield + full HP = 5 shield + 5 HP gone → 5 HP, alive.
   */
  private applyDamage(amount: number): boolean {
    if (this.state !== "alive") return false;
    for (let i = 0; i < amount; i++) {
      if (this.shieldPoints > 0) this.shieldPoints -= 1;
      else this.health = Math.max(0, this.health - 1);
    }
    this.hitFlashTimer = HIT_FLASH_DURATION;
    this.shakeTimer = 0.25;
    this.shakeAmount = 0.06;
    this.targetScale.set(1.35, 0.7, 1.35);
    if (this.health <= 0) this.die();
    return true;
  }

  private die() {
    this.state = "dead";
    // Every death path clears shield here (the single chokepoint) so a locally
    // predicted death can't leave a stale blue heart on the corpse — the bug
    // where you "die but still have shield". serverKilled() also routes here.
    this.shieldPoints = 0;
    this.deadTimer = 0;
    this.audio.playDeath(this.root.position, true);
    this.justDied = true;
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
    // Boss buffs persist across respawn (the ×10 size + bigger hitbox).
    const boss = this.fireMode === "boss";
    this.bodyHalfHeight = (PLAYER_SIZE / 2) * (boss ? BOSS_SCALE : 1);
    // Prefer a spawn far from other players (Game chooses); fall back to random.
    const spawn = this.spawnPicker?.() ?? this.platform.randomSpawn(4);
    spawn.y = this.platform.surfaceY(spawn.x, spawn.z) + this.bodyHalfHeight;
    this.root.position.copy(spawn);
    this.root.rotation.set(0, 0, 0);
    this.root.scale.setScalar(boss ? BOSS_SCALE : 1);
    this.velocity.set(0, 0, 0);
    this.dashVel.set(0, 0, 0);
    this.dashStretchTimer = 0;
    this.dashCharges = DASH_MAX_CHARGES;
    this.body.scale.set(1, 1, 1);
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    this.targetScale.set(1, 1, 1);
    this.avatar.reset();
    this.grounded = true;
    this.state = "alive";
    this.fallTimer = 0;
    this.deadTimer = 0;
    this.health = this.getMaxHealth();
    this.hitFlashTimer = 0;
    this.shakeTimer = 0;
    this.kameState = "idle";
    this.kameTimer = 0;
    // Clear any saber swing/stagger state carried across the death.
    this.swingTimer = 0;
    this.swingElapsed = 0;
    this.stunTimer = 0;
    this.fireLockTimer = 0;
    this.staggerFlashT = 0;
    this.staffPivot.rotation.y = SABER_REST_YAW;
    this.staff.position.x = BASE_SABER_MOUNT;
    // Power-up boosts + shield are lost on death (you respawn fresh — BR style).
    this.speedTimer = 0;
    this.rapidTimer = 0;
    this.shieldPoints = 0;
    // Clear any keys / mouse buttons that may have gotten stuck during the
    // fall/death animation (e.g. window lost focus while a movement key was held).
    this.input.clearKeys();
    this.position.copy(this.root.position);
  }

  private updateAim(camera: THREE.Camera) {
    // A saber swing COMMITS to the facing it started with: freeze aim for the
    // swing's duration (like a baseball swing). This keeps the swept blade, its
    // hit/parry test, and the start-direction broadcast to remotes all in ONE
    // direction — you can't spin the cursor to sweep the blade across the arena.
    if (this.swingTimer > 0) {
      this.aimGroup.rotation.y = -this.aimYaw;
      return;
    }
    const mobileYaw = this.input.getMobileAimYaw();
    if (mobileYaw !== null) {
      this.aimYaw = mobileYaw;
    } else {
      this.aimRaycaster.setFromCamera(this.input.mouseNDC, camera);
      this.aimPlane.constant = -this.root.position.y;
      const hit = this.aimRaycaster.ray.intersectPlane(this.aimPlane, this.tmpAim);
      if (hit) {
        const dx = hit.x - this.root.position.x;
        const dz = hit.z - this.root.position.z;
        this.aimYaw = Math.atan2(dz, dx);
      }
    }
    this.aimGroup.rotation.y = -this.aimYaw;
  }

  private getAimDirection(out: THREE.Vector3) {
    out.set(Math.cos(this.aimYaw), 0, Math.sin(this.aimYaw));
    return out;
  }

  /** Tint the animal toward red as health drops, white flash on hit. */
  private updateColor() {
    const t = 1 - this.health / this.getMaxHealth(); // 0 healthy → 1 dead
    // White on a fresh hit, then a ~10Hz pulse for the rest of the stagger window.
    const stunPulse = this.staggerFlashT > 0 && Math.floor(this.staggerFlashT * 10) % 2 === 0;
    this.avatar.applyTint(t, this.hitFlashTimer > 0 || stunPulse);
  }

  update(dt: number, camera: THREE.Camera) {
    // DEAD: countdown to respawn
    if (this.state === "dead") {
      this.deadTimer += dt;
      this.shadow.setVisible(false);
      // The body bursts into voxel gore on death (spawned by Game) — hide it.
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
      // Keep carrying dash momentum off the edge (escape-dash over a gap).
      this.root.position.addScaledVector(this.dashVel, dt);
      this.dashVel.multiplyScalar(Math.exp(-DASH_DECAY * dt));
      this.root.rotation.x += dt * 6;
      this.root.rotation.z += dt * 4;
      const t = 1 - this.fallTimer / FALL_DURATION;
      this.avatar.setOpacity(Math.max(0, t));
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

    // Saber stagger timers decay every frame. While stunned, all action input
    // (move/jump/dash/fire/swing) is suppressed; knockback velocity (dashVel)
    // still carries the push. The constant-fire lock outlives the stun.
    if (this.stunTimer > 0) this.stunTimer = Math.max(0, this.stunTimer - dt);
    if (this.fireLockTimer > 0) this.fireLockTimer = Math.max(0, this.fireLockTimer - dt);
    if (this.staggerFlashT > 0) this.staggerFlashT = Math.max(0, this.staggerFlashT - dt);
    const stunned = this.stunTimer > 0;

    // Movement. The "speed" power-up multiplies the top speed ×1.6 while active; the
    // active weapon's weight then scales it. The energy blast is pistol-fast while
    // idle and only slows (−20%) once CHANNELING begins — nerfs the channel-and-flee
    // kite (see docs/systems/weapons-weight-speed.md).
    const move = this.input.getMoveVector();
    const superLoaded =
      this.fireMode === "energyBlast" && this.kameState !== "idle";
    const weaponWeight = superLoaded
      ? SUPER_LOADED_SPEED_MULT
      : WEAPON_SPEED_MULT[this.fireMode];
    const effSpeed = MOVE_SPEED * (this.speedTimer > 0 ? 1.6 : 1) * weaponWeight;
    const targetVx = stunned ? 0 : move.x * effSpeed;
    const targetVz = stunned ? 0 : move.z * effSpeed;
    const lerpAmt = 1 - Math.exp(-ACCEL * dt);
    this.velocity.x += (targetVx - this.velocity.x) * lerpAmt;
    this.velocity.z += (targetVz - this.velocity.z) * lerpAmt;

    // Jump (suppressed while stunned; still drain the buffered press).
    if (!stunned && this.grounded && this.input.consumeJump()) {
      this.velocity.y = JUMP_VELOCITY;
      this.grounded = false;
      this.audio.playJump(this.root.position, true);
      this.justJumped = true;
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

    // Dash (Shift): forward impulse spending one charge. Recharge ONLY refills
    // the base charges (up to DASH_MAX_CHARGES); temporary bonus bars above the
    // base are one-time (spent by dashing, never recharged).
    if (this.dashCharges < DASH_MAX_CHARGES) {
      this.dashCharges = Math.min(
        DASH_MAX_CHARGES,
        this.dashCharges + dt / DASH_RECHARGE,
      );
    }
    if (this.input.consumeDash() && !stunned && this.dashCharges >= 1) {
      this.dash();
      this.dashCharges -= 1;
    }

    // Fire-mode toggle. A single Tab cycles modes; a quick DOUBLE-Tab (only for
    // the "bero" easter egg) enters/exits BOSS mode.
    if (this.input.consumeTab()) {
      const now = performance.now();
      if (this.bossUnlocked && now - this.lastTabMs < DOUBLE_TAB_MS) {
        this.setFireMode(this.fireMode === "boss" ? "pistol" : "boss");
      } else {
        this.toggleFireMode();
      }
      this.lastTabMs = now;
    }
    // Minecraft-style hotbar select (keys 1/2/3).
    const slot = this.input.consumeHotbar();
    if (slot !== null) this.setWeaponSlot(slot);

    // Shooting. The MODE decides what holding does:
    //  • pistol      → hold to autofire normal shots (fast + high rate of fire).
    //  • energyBlast → hold to channel; release once ready (glow) to fire the super
    //    shot (significant damage + stun). Releasing before ready cancels.
    //  • boss        → hold to RAPID-FIRE mega beams (half damage, no insta-kill).
    this.shootTimer -= dt;
    this.input.consumeShoot(); // drain the one-shot press (modes use the hold state)
    // While stunned, no weapon acts (but an already-committed swing finishes its
    // animation below — the stagger blocks the NEXT action, not the current one).
    const held = !stunned && this.input.isShootHeld();
    if (this.fireMode === "boss") {
      if (this.kameState !== "idle") this.kameState = "idle";
      // Boss rapid-beam is "pistol-like" fire → also held off by the stagger lock.
      if (held && this.shootTimer <= 0 && this.fireLockTimer <= 0) {
        this.fireKame(false); // mega beam, non-lethal (2 hits to kill)
        this.shootTimer = BOSS_CADENCE;
      }
    } else if (this.fireMode === "lightsaber") {
      if (this.kameState !== "idle") this.kameState = "idle";
      // Don't restart a swing while one is mid-flight (keeps swingId stable).
      if (held && this.shootTimer <= 0 && this.swingTimer <= 0) {
        this.swingStaff();
        this.shootTimer = MELEE_COOLDOWN;
      }
    } else if (this.fireMode === "pistol") {
      if (this.kameState !== "idle") this.kameState = "idle"; // safety
      if (held && this.fireLockTimer <= 0) this.tryPistol(); // stagger locks pistol fire
    } else if (this.kameState === "idle") {
      if (held) {
        this.kameState = "charging";
        this.kameTimer = 0;
      }
    } else if (this.kameState === "charging") {
      if (!held) {
        this.kameState = "idle"; // released before ready → cancel
      } else {
        this.kameTimer += dt;
        if (this.kameTimer >= this.kameChargeTime()) {
          this.kameState = "ready";
          this.onKameReady();
        }
      }
    } else if (!held) {
      this.fireKame(true); // ready → fire the energy blast (significant dmg + stun) on release
      this.kameState = "idle";
    }

    // Gravity
    this.velocity.y -= GRAVITY * dt;

    // Apply velocity
    this.root.position.addScaledVector(this.velocity, dt);
    // Dash impulse (decays quickly for a snappy burst)
    this.root.position.addScaledVector(this.dashVel, dt);
    this.dashVel.multiplyScalar(Math.exp(-DASH_DECAY * dt));

    // Ground / death-by-edge
    const groundSurfaceY = this.platform.surfaceY(
      this.root.position.x,
      this.root.position.z,
    );
    const groundY = groundSurfaceY + this.bodyHalfHeight;
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
        this.audio.playLand(this.root.position, true);
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
        this.audio.playFall(this.root.position, true);
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
      this.targetScale.lerp(this.tmpScale.set(squish, stretch * 0.95, squish), 0.18);
      if (speedRatio < 0.05) {
        this.targetScale.lerp(this.tmpScale.set(1, 1, 1), 0.2);
      }
    } else {
      this.targetScale.lerp(this.tmpScale.set(1, 1, 1), 0.06);
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
      this.body.position.lerp(this.tmpScale.set(0, 0, 0), 0.4);
    }

    // Hit flash timer
    if (this.hitFlashTimer > 0) this.hitFlashTimer -= dt;

    // Timed power-up boosts tick down (clamped at 0).
    if (this.speedTimer > 0) this.speedTimer = Math.max(0, this.speedTimer - dt);
    if (this.rapidTimer > 0) this.rapidTimer = Math.max(0, this.rapidTimer - dt);

    // Color update (health -> red)
    this.updateColor();

    // Smooth scale lerp
    this.body.scale.lerp(this.targetScale, SQUASH_LERP);

    // Body facing + dash stretch: during a dash the body turns to and stretches
    // horizontally along the dash (movement) direction, bouncing back elastically;
    // otherwise it faces the aim.
    if (this.dashStretchTimer > 0) {
      this.dashStretchTimer -= dt;
      const frac = Math.max(0, this.dashStretchTimer / DASH_STRETCH_DURATION);
      const amt = Math.cos((1 - frac) * Math.PI * 4) * 0.6 * frac;
      this.avatar.faceYaw(this.dashYaw);
      this.avatar.setDashStretch(amt);
    } else {
      this.avatar.faceYaw(this.aimYaw);
      this.avatar.setDashStretch(0);
    }

    // Gun recoil recovery
    this.gunRecoil += (0 - this.gunRecoil) * Math.min(1, 18 * dt);
    this.gun.position.x = this.gunBaseX - this.gunRecoil;

    // Saber swing: baseball-bat motion — 45° CCW wind-up, then a 180° CW strike,
    // then ease back to the perpendicular rest pose. The pivot mount is pushed
    // forward during the backward wind-up so the blade never touches the body.
    if (this.swingTimer > 0) {
      this.swingTimer = Math.max(0, this.swingTimer - dt);
      this.swingElapsed += dt;
      const t = Math.min(1, this.swingElapsed / MELEE_SWING_DUR); // 0 → 1
      const yaw = sampleSaberYaw(t);
      this.staffPivot.rotation.y = yaw;
      // Dynamic forward mount: clear the cube during the backward part of the arc.
      this.staff.position.x = saberMountX(yaw);
      this.staff.updateWorldMatrix(true, true); // fresh blade transform for the sample

      // No "recovery" phase any more — the strike sweeps the full arc, so hits
      // register across the whole 180° (the gentle return is the post-swing settle).
      const phase: MeleeSample["phase"] = t < SWING_WINDUP_END_T ? "windup" : "strike";

      // Emit the per-frame sample so Game resolves arc hits + bullet parry against
      // the LIVE blade segment (pivot → tip in world space).
      if (this.onMeleeSample) {
        this.staffPivot.getWorldPosition(this.swingBladeStart);
        this.staffTip.getWorldPosition(this.swingBladeEnd);
        this.onMeleeSample({
          swingId: this.swingId,
          phase,
          parry: t >= SWING_PARRY_START_T && t <= SWING_PARRY_END_T,
          dt,
          // Live body center — root.position already advanced this frame (esp.
          // mid-dash), whereas this.position only syncs at end of update(). Using
          // it keeps the range/cone/inbound gates consistent with the blade.
          origin: this.root.position,
          aimDir: this.getAimDirection(this.tmpDir),
          bladeStart: this.swingBladeStart,
          bladeEnd: this.swingBladeEnd,
        });
      }

      // No per-frame smoke along the arc — the blue SaberTrail is the in-motion
      // effect. Instead, ONE white smoke-cube puff at the END of the swing (Game
      // spawns the mega-shot-style cubes via kame.smokeBurst — Player has no kame).
      if (this.swingTimer <= 0 && this.onMeleeEnd) {
        const tipPos = new THREE.Vector3();
        this.staffTip.getWorldPosition(tipPos);
        this.onMeleeEnd(tipPos.x, tipPos.y, tipPos.z);
      }
    } else if (this.staffPivot.rotation.y !== SABER_REST_YAW) {
      // Settle smoothly back to the perpendicular rest pose and reset the mount.
      this.staffPivot.rotation.y +=
        (SABER_REST_YAW - this.staffPivot.rotation.y) * Math.min(1, 18 * dt);
      if (Math.abs(this.staffPivot.rotation.y - SABER_REST_YAW) < 0.002) {
        this.staffPivot.rotation.y = SABER_REST_YAW;
      }
      this.staff.position.x = BASE_SABER_MOUNT;
    }

    // Footstep sound + grass particles while walking on ground
    const speedXY = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.grounded && speedXY > 0.6) {
      this.stepTimer -= dt * (0.7 + speedXY * 0.18);
      if (this.stepTimer <= 0) {
        this.stepTimer = 0.32; // base cadence
        this.audio.playFootstep(this.root.position, true);
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

    // Contact shadow: hugs the ground and shrinks as the feet rise on a jump.
    this.shadow.setVisible(true);
    this.shadow.apply(
      this.root.position.y - this.bodyHalfHeight - groundSurfaceY,
      groundSurfaceY - this.root.position.y + 0.02,
    );

    // Sync exposed position for BulletTarget
    this.position.copy(this.root.position);
  }

  private dash() {
    // Dash along the movement direction (classic escape dash); fall back to the
    // aim direction when standing still.
    const move = this.input.getMoveVector();
    const dir =
      move.lengthSq() > 0.001
        ? new THREE.Vector3(move.x, 0, move.z)
        : this.getAimDirection(this.tmpDir).clone();
    dir.normalize();
    this.dashVel.set(dir.x * DASH_IMPULSE, 0, dir.z * DASH_IMPULSE);
    this.dashYaw = Math.atan2(dir.z, dir.x);
    this.dashStretchTimer = DASH_STRETCH_DURATION;
    this.justDashed = true;
    this.audio.playJump(this.root.position, true);
    // Big smoke burst trailing from where the dash launched.
    const origin = new THREE.Vector3(
      this.root.position.x,
      this.root.position.y,
      this.root.position.z,
    );
    if (this.smoke) {
      this.smoke.spawnPuff(origin, dir.clone().negate(), 16, "#d6d6d6");
    }
    const sy = this.platform.surfaceY(this.root.position.x, this.root.position.z);
    this.dust.spawnBurst(
      new THREE.Vector3(this.root.position.x, sy + 0.05, this.root.position.z),
      18,
    );
  }

  /** Start a melee swing: kick off the 180° animation + a whoosh, and hand the
   *  arc-hit resolution (damage + knockback + netcode) to Game via onMelee. */
  private swingStaff() {
    const dir = this.getAimDirection(this.tmpDir).clone();
    this.swingId = (this.swingId + 1) & 0xffff;
    this.swingTimer = MELEE_SWING_DUR;
    this.swingElapsed = 0;
    // Broadcast the swing (remotes drag the slash arc). Damage + parry are now
    // resolved per-frame in Game via the onMeleeSample callback, NOT here.
    this.onMelee?.(this.position.clone(), dir);
    this.audio.playJump(this.root.position, true); // soft whoosh
    this.targetScale.set(1.2, 0.85, 1.2);
  }

  private shoot() {
    const muzzle = new THREE.Vector3();
    this.gunBarrelTip.getWorldPosition(muzzle);
    const dir = this.getAimDirection(this.tmpDir).clone();
    this.bullets.spawn(muzzle, dir, "player", "player");
    this.onFire?.(muzzle.clone(), dir.clone(), "#fff8b0");
    this.audio.playShot(this.root.position, true);
    this.gunRecoil = 0.08;
    this.targetScale.set(1.15, 0.9, 1.15);
    // Muzzle flash + smoke puff
    if (this.smoke) {
      this.smoke.spawnFlash(muzzle, dir);
      this.smoke.spawnPuff(muzzle, dir, 6, "#cccccc");
    }
  }

  dispose() {
    this.avatar.dispose();
    this.shadow.dispose();
    // The gun + saber geometries AND their materials are per-instance (buildGun /
    // buildSaber make fresh materials shared across each weapon's meshes) — dispose
    // both weapons. Material.dispose() is idempotent, so per-mesh traversal is safe.
    for (const weapon of [this.gun, this.staff]) {
      weapon.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else if (mat) mat.dispose();
      });
    }
  }
}
