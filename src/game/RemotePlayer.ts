import * as THREE from "three";
import { Avatar, AVATAR_HEIGHT } from "./Avatar";
import { BlobShadow } from "./Shadow";
import { buildNameLabel } from "./PigParts";
import type { BulletTarget } from "./Bullets";
import type { AudioEngine } from "./AudioEngine";
import {
  MOVE_SPEED,
  DASH_STRETCH_DURATION,
  SQUASH_LERP,
  GROUND_SQUASH_LERP,
  AIRBORNE_SQUASH_LERP,
  LEAN_AMOUNT,
  INTERP_DELAY_MS,
  INTERP_BASE_MS,
  INTERP_JITTER_K,
  INTERP_MIN_MS,
  INTERP_MAX_MS,
  EXTRAP_MAX_MS,
  EXTRAP_TAU_S,
} from "./consts";

const HALF_HEIGHT = 0.25;

/** Off-edge fall tumble duration (mirrors Player FALL_DURATION feel). */
const FALL_DURATION = 0.7;
/** How long a positional error correction blends out (~100ms, no snapping). */
const CORRECTION_HALF_LIFE = 0.1;
/** Debounce window for inferred land/jump audio so 20Hz jitter can't double-fire. */
const AUDIO_EDGE_DEBOUNCE = 0.12;

type RemoteState = "alive" | "falling" | "dead";

interface Snapshot {
  t: number; // perf.now() ms when received
  x: number;
  y: number;
  z: number;
}

/**
 * A networked opponent: a cloned voxel-animal avatar with a floating name tag
 * and contact shadow. The transform is reconstructed from a timestamped
 * snapshot buffer with velocity dead-reckoning + smooth error correction, and
 * the SAME squash/stretch/lean deformation pipeline as Player.update is
 * replayed on the avatar body so a remote looks byte-identical to how its owner
 * sees itself locally. Instant juice (dash/jump) is driven by explicit events;
 * spatial SFX (land/jump/footstep/death) are inferred client-side and fired
 * through the shared AudioEngine at isLocal=false (distance-gated by the ring).
 *
 * Implements BulletTarget so our local shots hit it — but a hit only RELAYS a
 * network "hit" event (the victim applies its own damage authoritatively).
 */
export class RemotePlayer implements BulletTarget {
  readonly id: string;
  readonly side = "bot" as const;
  /** Networked remote: local bots/AI can't damage it (server-authoritative). */
  readonly remote = true;
  readonly bodyHalfHeight = HALF_HEIGHT;
  readonly root: THREE.Group;
  readonly position: THREE.Vector3;

  private avatar: Avatar;
  private body: THREE.Group; // = avatar.group, the squash/stretch/lean node
  private shadow: BlobShadow;
  private label: THREE.Sprite;
  private audio: AudioEngine;
  private onHit: (id: string) => void;

  // ── Networked target state ────────────────────────────────────────────────
  private snaps: Snapshot[] = []; // newest last, max 8 (wider window than INTERP_DELAY_MS)
  private vx = 0;
  private vz = 0;
  private vy = 0;

  // ── Adaptive interpolation cushion (per-remote, jitter-driven) ────────────
  // Replaces the fixed INTERP_DELAY_MS: the render-behind delay shrinks toward
  // INTERP_MIN_MS on a clean link and widens toward INTERP_MAX_MS under jitter.
  // Starts at the old fixed value so a brand-new remote is conservative until it
  // has measured a few inter-arrival gaps.
  private interpDelay = INTERP_DELAY_MS;
  private arrivalEMA = 0; // EMA of snapshot inter-arrival (ms)
  private jitterEMA = 0; // EMA of |inter-arrival − mean| (ms)
  private lastRecvT = 0; // perf.now() of the previous accepted snapshot
  private grounded = true;
  private state: RemoteState = "alive";
  private targetYaw = 0;
  private renderYaw = 0; // smoothed (shortest-arc) facing yaw
  private targetHealth = 10;
  private alive = true;
  private hasState = false;

  // ── Present flag: false while socket is disconnected (grace window) ───────
  private present = true;

  // ── Smooth correction offset (rendered = target + offset, offset → 0) ──────
  private posError = new THREE.Vector3();

  // ── Deformation state (mirrors Player fields) ─────────────────────────────
  private targetScale = new THREE.Vector3(1, 1, 1);
  private dashStretchTimer = 0;
  private dashYaw = 0;
  private fallTimer = 0;
  private stepTimer = 0;

  // ── Hit flash + body shake (mirrors Player.takeHit juice) ────────────────
  private hitFlashTimer = 0;
  private hitShakeTimer = 0;
  private hitShakeAmount = 0.06;

  // ── One-shot flags consumed by Game each frame for particle spawns ────────
  private _justDashed = false;
  private _justJumped = false;
  private _justLanded = false;
  private _justStepped = false;

  // ── Audio inference state ─────────────────────────────────────────────────
  private prevGrounded = true;
  private wasAlive = true;
  private landDebounce = 0;
  private jumpDebounce = 0;

  constructor(
    id: string,
    name: string,
    animal: string,
    audio: AudioEngine,
    onHit: (id: string) => void,
  ) {
    this.id = id;
    this.audio = audio;
    this.onHit = onHit;
    this.root = new THREE.Group();
    this.position = this.root.position; // BulletTarget body center

    this.avatar = new Avatar(animal, AVATAR_HEIGHT, -HALF_HEIGHT);
    this.body = this.avatar.group;
    this.root.add(this.body);

    this.shadow = new BlobShadow(0.4, 0.2);
    this.root.add(this.shadow.mesh);

    this.label = buildNameLabel(name);
    this.label.position.set(0, AVATAR_HEIGHT * 0.85 + 0.35, 0);
    this.root.add(this.label);
  }

  isAlive(): boolean {
    return this.alive;
  }

  /**
   * BulletTarget: a local shot landed — flash the body IMMEDIATELY (so the
   * shooter sees the opponent react on hit) then relay the event to the owner.
   */
  takeHit(): boolean {
    if (!this.alive) return false;
    this.flashHit(); // instant local feedback for the shooter
    this.onHit(this.id); // server-authoritative damage relay
    return true;
  }

  /**
   * Mark this avatar as disconnected (grace window) or reconnected.
   * When present===false, velocity dead-reckoning is frozen so the avatar
   * stands still (non-drifting) but remains a valid BulletTarget.
   */
  setPresent(value: boolean) {
    this.present = value;
    if (!value) {
      this.vx = 0;
      this.vz = 0;
      this.vy = 0;
    }
  }

  /**
   * Trigger a white-pop + squash + body-shake hit-flash so observers and the
   * shooter see damage instantly (driven from takeHit AND from the incoming
   * "hit" relay event). Mirrors Player.takeHit juice exactly:
   *   - white emissive tint for ~0.18 s
   *   - squash targetScale (1.35, 0.7, 1.35)
   *   - decaying random body-position jolt for ~0.25 s
   */
  flashHit() {
    this.hitFlashTimer = 0.18;
    this.hitShakeTimer = 0.25;
    this.hitShakeAmount = 0.06;
    this.targetScale.set(1.35, 0.7, 1.35);
  }

  /** Feed the latest networked state into the snapshot buffer. */
  setState(
    x: number,
    y: number,
    z: number,
    yaw: number,
    health: number,
    alive: boolean,
    vx: number,
    vz: number,
    vy: number,
    grounded: boolean,
    state: RemoteState,
    present = true,
  ) {
    // ── NaN guard: reject the entire packet if any numeric field is non-finite
    if (![x, y, z, yaw, health, vx, vz, vy].every(Number.isFinite)) return;

    // ── Respawn (dead → alive): TELEPORT to the new spot, don't interpolate
    // across the map. The glide would drag the floating name tag from the death
    // spot to the respawn point, spoiling where the player reappears. Clearing
    // the snapshot history means computeTargetPos() locks onto the new position.
    if (this.hasState && !this.alive && alive) {
      this.snaps.length = 0;
      this.posError.set(0, 0, 0);
      this.root.position.set(x, y, z);
      this.renderYaw = yaw;
    }

    const now = performance.now();

    // ── Adaptive cushion: learn this remote's arrival jitter and size the
    // render-behind delay to it. Updated BEFORE the posError seed below so the
    // computeTargetPos() it calls uses the fresh cushion. Absurd gaps (tab
    // throttle, respawn, reconnect) are ignored so they can't blow up the EMA.
    if (this.lastRecvT > 0) {
      const interval = now - this.lastRecvT;
      if (interval > 0 && interval < 500) {
        this.arrivalEMA =
          this.arrivalEMA === 0 ? interval : this.arrivalEMA + (interval - this.arrivalEMA) * 0.1;
        const jit = Math.abs(interval - this.arrivalEMA);
        this.jitterEMA += (jit - this.jitterEMA) * 0.1;
        this.interpDelay = Math.max(
          INTERP_MIN_MS,
          Math.min(INTERP_MAX_MS, INTERP_BASE_MS + INTERP_JITTER_K * this.jitterEMA),
        );
      }
    }
    this.lastRecvT = now;

    // Push snapshot FIRST so computeTargetPos() sees the new point when we
    // seed posError (fixes the double-correction / "travado" jank: the offset
    // now measures the interpolation discontinuity, not a raw-snapshot delta).
    this.snaps.push({ t: now, x, y, z });
    if (this.snaps.length > 8) this.snaps.shift();

    // Seed posError AFTER the push so computeTargetPos() returns the correct
    // interpolated target that update() will also compute next frame.
    if (this.hasState) {
      this.posError
        .copy(this.root.position)
        .sub(this.computeTargetPos());
    }

    if (!this.hasState) this.renderYaw = yaw; // avoid an initial yaw sweep
    this.targetYaw = yaw;
    this.targetHealth = health;
    this.alive = alive;

    // Only update velocity when connected — setPresent(false) already zeroed them
    if (present) {
      this.vx = vx;
      this.vz = vz;
      this.vy = vy;
    }
    this.grounded = grounded;
    this.state = state;
    this.present = present;
    this.hasState = true;
  }

  /** Snap immediately to the latest target (used on first spawn). */
  snap() {
    const s = this.snaps[this.snaps.length - 1];
    if (s) this.root.position.set(s.x, s.y, s.z);
    this.posError.set(0, 0, 0);
  }

  /** Instant dash juice from an explicit "dash" event (no snapshot latency). */
  triggerDash(dir: number) {
    this.dashYaw = dir;
    this.dashStretchTimer = DASH_STRETCH_DURATION;
    this._justDashed = true;
  }

  /** Instant jump juice from an explicit "jump" event. */
  triggerJump() {
    this.targetScale.set(0.7, 1.4, 0.7);
    this._justJumped = true;
  }

  // ── One-shot particle-spawn hooks (consumed each frame by Game) ───────────

  /**
   * True on the first call after a dash event; false every subsequent call.
   * Game uses this to spawn smoke + dust at `root.position` without this class
   * owning particle systems.
   */
  consumeJustDashed(): boolean {
    const v = this._justDashed;
    this._justDashed = false;
    return v;
  }

  /**
   * True on the first call after a jump event; false every subsequent call.
   * Game uses this to spawn a dust burst at `root.position`.
   */
  consumeJustJumped(): boolean {
    const v = this._justJumped;
    this._justJumped = false;
    return v;
  }

  /**
   * True on the first call after a land event (inferred from grounded edge);
   * false every subsequent call. Game uses this to spawn a dust burst.
   */
  consumeJustLanded(): boolean {
    const v = this._justLanded;
    this._justLanded = false;
    return v;
  }

  /**
   * True on the first call after a footstep cadence tick (inferred from
   * grounded + speed, same cadence as Player). Game spawns a grass puff.
   */
  consumeJustStepped(): boolean {
    const v = this._justStepped;
    this._justStepped = false;
    return v;
  }

  /** Dash yaw of the last dash event (for orienting the dash smoke trail). */
  getDashYaw(): number {
    return this.dashYaw;
  }

  /** Current horizontal velocity (biases footstep grass-poof spread). */
  getVelocityXZ(): THREE.Vector3 {
    return new THREE.Vector3(this.vx, 0, this.vz);
  }

  /**
   * Current rendered world position (same object as `root.position`).
   * Game uses this as the spawn origin for remote smoke / dust / grass poof.
   */
  getPosition(): THREE.Vector3 {
    return this.root.position;
  }

  update(dt: number, groundY: number) {
    // ── 1. Reconstruct the target world position (interpolate or extrapolate)
    const target = this.computeTargetPos();

    // ── 2. Smooth error correction: decay the stored offset toward zero ──────
    const decay = Math.exp(-dt / CORRECTION_HALF_LIFE);
    this.posError.multiplyScalar(decay);
    if (this.posError.lengthSq() < 1e-6) this.posError.set(0, 0, 0);
    this.root.position.copy(target).add(this.posError);

    // ── NaN guard for root position (defensive: reset to last good snapshot) ──
    const p = this.root.position;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
      const last = this.snaps[this.snaps.length - 1];
      if (last) p.set(last.x, last.y, last.z);
      this.posError.set(0, 0, 0);
    }

    // ── 3. Shortest-arc yaw lerp ─────────────────────────────────────────────
    let dyaw = this.targetYaw - this.renderYaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw)); // wrap to [-PI, PI]
    this.renderYaw += dyaw * Math.min(1, dt * 12);

    // ── 4. Hit flash timer + health tint + opacity + shadow ──────────────────
    if (this.hitFlashTimer > 0) this.hitFlashTimer -= dt;
    const hitFlash = this.hitFlashTimer > 0;
    this.avatar.applyTint(
      Math.min(1, Math.max(0, 1 - this.targetHealth / 10)),
      hitFlash,
    );

    // ── 5. Falling tumble overrides the normal deformation pipeline ──────────
    if (this.state === "falling") {
      this.label.visible = false;
      this.updateFalling(dt, groundY);
      this.runAudioInference(dt);
      return;
    }

    // ── Explicit dead / !alive branch: hide body, keep audio inference ────────
    // Mirrors Player.ts dead branch so the body is ONLY hidden when truly dead.
    // Hide the name tag too — a floating name (especially while it glides to the
    // respawn spot) would spoil where the player is/reappears.
    if (this.state === "dead" || !this.alive) {
      this.label.visible = false;
      this.avatar.setOpacity(0);
      this.body.scale.setScalar(0.0001);
      this.shadow.setVisible(false);
      this.runAudioInference(dt);
      return;
    }

    // Recover from a tumble once the remote is alive again.
    if (this.fallTimer > 0) {
      this.fallTimer = 0;
      this.root.rotation.set(0, 0, 0);
      this.root.scale.set(1, 1, 1);
    }

    // Ensure body + name tag are visible on every alive frame.
    this.label.visible = true;
    this.avatar.setOpacity(1);
    this.shadow.setVisible(true);
    this.shadow.apply(
      this.root.position.y - HALF_HEIGHT - groundY,
      groundY - this.root.position.y + 0.02,
    );

    // ── 6. Speed-driven squash/stretch (mirror of Player.update) ─────────────
    const speedXZ = Math.hypot(this.vx, this.vz);
    const speedRatio = Math.min(1, speedXZ / MOVE_SPEED);
    if (this.grounded) {
      const stretch = 1 + speedRatio * 0.18;
      const squish = 1 - speedRatio * 0.1;
      this.targetScale.lerp(
        new THREE.Vector3(squish, stretch * 0.95, squish),
        GROUND_SQUASH_LERP,
      );
      if (speedRatio < 0.05) {
        this.targetScale.lerp(new THREE.Vector3(1, 1, 1), 0.2);
      }
    } else {
      this.targetScale.lerp(new THREE.Vector3(1, 1, 1), AIRBORNE_SQUASH_LERP);
    }

    // ── 7. Lean from velocity ────────────────────────────────────────────────
    const leanX = THREE.MathUtils.clamp(this.vz / MOVE_SPEED, -1, 1);
    const leanZ = THREE.MathUtils.clamp(-this.vx / MOVE_SPEED, -1, 1);
    this.body.rotation.x += (leanX * LEAN_AMOUNT - this.body.rotation.x) * 0.18;
    this.body.rotation.z += (leanZ * LEAN_AMOUNT - this.body.rotation.z) * 0.18;

    // Scrub body rotation after lean updates to prevent NaN from latching.
    if (!Number.isFinite(this.body.rotation.x)) this.body.rotation.x = 0;
    if (!Number.isFinite(this.body.rotation.z)) this.body.rotation.z = 0;

    // ── 7b. Body-position jolt on hit (mirrors Player.takeHit shake, lines 538-546) ──
    if (this.hitShakeTimer > 0) {
      this.hitShakeTimer -= dt;
      const s = this.hitShakeAmount * (this.hitShakeTimer / 0.25);
      this.body.position.x = (Math.random() - 0.5) * s * 2;
      this.body.position.y = (Math.random() - 0.5) * s * 2;
      this.body.position.z = (Math.random() - 0.5) * s * 2;
    } else {
      this.body.position.lerp(new THREE.Vector3(0, 0, 0), 0.4);
    }
    // NaN guard on body position (should never fire, but belt-and-suspenders).
    if (!Number.isFinite(this.body.position.x)) this.body.position.x = 0;
    if (!Number.isFinite(this.body.position.y)) this.body.position.y = 0;
    if (!Number.isFinite(this.body.position.z)) this.body.position.z = 0;

    // ── 8. Smooth scale lerp (with NaN / clamp guard) ────────────────────────
    // Sanitize targetScale before lerping so NaN can never enter body.scale.
    if (
      !Number.isFinite(this.targetScale.x) ||
      !Number.isFinite(this.targetScale.y) ||
      !Number.isFinite(this.targetScale.z)
    ) {
      this.targetScale.set(1, 1, 1);
    }
    this.body.scale.lerp(this.targetScale, SQUASH_LERP);
    // Clamp body.scale away from zero / NaN after the lerp.
    if (
      !Number.isFinite(this.body.scale.x) || this.body.scale.x < 0.05 ||
      !Number.isFinite(this.body.scale.y) || this.body.scale.y < 0.05 ||
      !Number.isFinite(this.body.scale.z) || this.body.scale.z < 0.05
    ) {
      this.body.scale.set(1, 1, 1);
    }

    // ── 9. Facing + dash stretch (mirror of Player.update) ───────────────────
    if (this.dashStretchTimer > 0) {
      this.dashStretchTimer -= dt;
      const frac = Math.max(0, this.dashStretchTimer / DASH_STRETCH_DURATION);
      const amt = Math.cos((1 - frac) * Math.PI * 4) * 0.6 * frac;
      this.avatar.faceYaw(this.dashYaw);
      this.avatar.setDashStretch(amt);
    } else {
      this.avatar.faceYaw(this.renderYaw);
      this.avatar.setDashStretch(0);
    }

    // ── 10. Spatial audio inference (land/jump/footstep/death) ───────────────
    this.runAudioInference(dt);
  }

  /** Off-edge fall: tumble + shrink + fade (mirror of Player falling branch). */
  private updateFalling(dt: number, _groundY: number) {
    this.fallTimer += dt;
    this.shadow.setVisible(false);
    this.root.rotation.x += dt * 6;
    this.root.rotation.z += dt * 4;
    const t = 1 - this.fallTimer / FALL_DURATION;
    this.avatar.setOpacity(Math.max(0, t));
    const s = Math.max(0.1, t);
    this.root.scale.set(s, s, s);
  }

  /**
   * Derive land/jump/footstep/death SFX client-side from grounded/state edges
   * and speed (never broadcast per-step). All remote → isLocal=false so the
   * AudioEngine distance-gates them by the hearing ring.
   */
  private runAudioInference(dt: number) {
    if (this.landDebounce > 0) this.landDebounce -= dt;
    if (this.jumpDebounce > 0) this.jumpDebounce -= dt;

    // Death edge (deduped against the explicit "died" event by Game; here we
    // only fire on the alive→dead transition this remote observed).
    if (this.wasAlive && !this.alive) {
      this.audio.playDeath(this.root.position, false);
    }
    this.wasAlive = this.alive;

    if (this.alive && this.state === "alive") {
      // grounded false→true: landing
      if (this.grounded && !this.prevGrounded && this.landDebounce <= 0) {
        this.audio.playLand(this.root.position, false);
        this.targetScale.set(1.4, 0.6, 1.4);
        this.landDebounce = AUDIO_EDGE_DEBOUNCE;
        this._justLanded = true; // Game spawns dust burst at root.position
      }
      // grounded true→false: jump (also covered by the explicit jump event;
      // debounce so the two paths don't double-fire the sound)
      if (!this.grounded && this.prevGrounded && this.jumpDebounce <= 0) {
        this.audio.playJump(this.root.position, false);
        this.jumpDebounce = AUDIO_EDGE_DEBOUNCE;
      }

      // Footstep cadence while running on the ground (port of Player.ts:516).
      const speedXY = Math.hypot(this.vx, this.vz);
      if (this.grounded && speedXY > 0.6) {
        this.stepTimer -= dt * (0.7 + speedXY * 0.18);
        if (this.stepTimer <= 0) {
          this.stepTimer = 0.32;
          this.audio.playFootstep(this.root.position, false);
          this._justStepped = true; // Game spawns a grass puff at root.position
        }
      } else {
        this.stepTimer = 0;
      }
    }

    this.prevGrounded = this.grounded;
  }

  /**
   * Reconstruct the render-time position: render `this.interpDelay` (the ADAPTIVE
   * jitter-driven cushion, ~40-90ms) in the past so we can interpolate between two
   * buffered snapshots; when render time runs past the newest snapshot (starvation),
   * dead-reckon forward with a DECAYED velocity (EXTRAP_TAU_S), clamped to
   * EXTRAP_MAX_MS, so a stopped/turned remote coasts to a halt instead of overshooting.
   *
   * Buffer cap is 8 snapshots. Because Game.ts feeds setState() ONLY on a genuinely
   * new packet (recvSeq guard) instead of every ~60Hz reconcile frame, each entry is
   * a distinct ~33ms (NET_TICK_HZ=30) tick — so the buffer spans ~265ms of real
   * history, comfortably exceeding the cushion and keeping the interpolate/extrapolate
   * path stable (no per-frame window collapse / flipping).
   */
  private computeTargetPos(): THREE.Vector3 {
    const out = new THREE.Vector3();
    const n = this.snaps.length;
    if (n === 0) return out.set(0, 0, 0);

    const newest = this.snaps[n - 1];
    if (n === 1) return out.set(newest.x, newest.y, newest.z);

    const renderT = performance.now() - this.interpDelay;

    // Interpolate when render time falls inside the buffered window.
    if (renderT <= newest.t) {
      for (let i = n - 1; i > 0; i--) {
        const a = this.snaps[i - 1];
        const b = this.snaps[i];
        if (renderT >= a.t && renderT <= b.t) {
          const span = b.t - a.t;
          const f = span > 0 ? (renderT - a.t) / span : 1;
          return out.set(
            a.x + (b.x - a.x) * f,
            a.y + (b.y - a.y) * f,
            a.z + (b.z - a.z) * f,
          );
        }
      }
      // renderT older than the oldest snapshot: clamp to oldest.
      const oldest = this.snaps[0];
      return out.set(oldest.x, oldest.y, oldest.z);
    }

    // Extrapolate forward from the newest snapshot — but DECAY the velocity so an
    // unconfirmed guess COASTS to a stop instead of running straight and snapping
    // back when the next packet lands (the dominant rubber-band artifact). The
    // displacement is the integral of v·e^(−s/τ): bounded by |v|·τ (~one body-width
    // at run speed) no matter how late the packet is. Only reached on starvation —
    // the adaptive cushion keeps us interpolating in the common case.
    const aheadS = Math.min(renderT - newest.t, EXTRAP_MAX_MS) / 1000;
    const k = EXTRAP_TAU_S * (1 - Math.exp(-aheadS / EXTRAP_TAU_S));
    return out.set(
      newest.x + this.vx * k,
      newest.y + this.vy * k,
      newest.z + this.vz * k,
    );
  }

  dispose() {
    this.avatar.dispose();
    this.shadow.dispose();
    const mat = this.label.material as THREE.SpriteMaterial;
    mat.map?.dispose();
    mat.dispose();
  }
}
