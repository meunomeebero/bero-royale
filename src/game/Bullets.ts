import * as THREE from "three";
import { HEARING_RADIUS } from "./consts";

export type BulletOwner = "player" | "bot";

interface Bullet {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  owner: BulletOwner;
  /** Stable id of the shooter (player/bot id) for kill attribution. */
  ownerId: string;
  /** Height (Y) that the bullet was fired from. Stays constant — bullets do not track players vertically. */
  flightY: number;
  /** Whether this bullet applies damage on target collision. Visual-only (remote) bullets are false. */
  damaging: boolean;
  /** XZ distance travelled so far. */
  traveled: number;
  /** Max XZ distance before forced expiry (= 2 * HEARING_RADIUS). */
  maxRange: number;
  /** Original shooter id for a remote VISUAL bullet (so a saber parry can credit
   *  the reflected damage back to that player via the server "hit" path). "" if
   *  unknown / not a remote shot. */
  shooterId: string;
  /** How many times this bullet has been saber-reflected (capped to prevent
   *  infinite player↔player ping-pong). */
  reflections: number;
  /** True for the visual tracer of a shot the server says WILL hit the LOCAL
   *  player (Phase 2 `targetId === me`). When such a tracer visibly reaches the
   *  local player, `onLethalArrive` fires so Game can release the gated death —
   *  the client guarantee that you never die from a bullet you didn't see land.
   *  See docs/systems/netcode-hit-sync-plan.md (Phase 3). */
  lethalToLocal: boolean;
  /** Per-shot id correlating this tracer with its scheduled damage/death cue. */
  seq: number;
  /** XZ distance from the muzzle to the local player at spawn — the tracer has
   *  "arrived" once it has travelled this far (reached the aim point) even if the
   *  player strafed out of the way. */
  targetDist: number;
}

const BULLET_GEOM = new THREE.BoxGeometry(0.1, 0.1, 0.1);
/**
 * Tracer travel speed. **MUST stay in sync with `BULLET_SPEED` in
 * `server/src/ws/bots.ts`** — the server schedules bot damage to land
 * `dist/BULLET_SPEED` after the shot so it coincides with this visible tracer.
 * See docs/systems/netcode-hit-sync-plan.md.
 */
const BULLET_SPEED = 22;
const BULLET_LIFE = 1.6;
const HIT_RADIUS = 0.35; // squared distance check uses radius
/** A bullet may be saber-reflected at most this many times (anti ping-pong). */
const MAX_BULLET_REFLECTIONS = 1;
/**
 * Maximum XZ travel distance for any bullet (local or visual-remote).
 * Pistol reach = 2 * HEARING_RADIUS * 1.3 (+30% reach buff, 2026-06-25); the only
 * bullet-based weapon is the Pistol (Energy Blast is a beam, Lightsaber is melee).
 * Bot-vs-bot damage in ambient mode is achieved by alternating the bot `side`
 * ("player" vs "bot") so each bot's bullets are owned by the opposite side and
 * pass the `tgt.side === b.owner` skip-guard — no change to this collision path.
 */
const BULLET_MAX_RANGE = 2 * HEARING_RADIUS * 1.3;
/** Vertical tolerance: a bullet at flightY only hits a target whose body is within this Y range. */
const HIT_VERTICAL_TOLERANCE = 0.35;
/** A lethal-to-local tracer counts as "arrived" within this XZ radius of the
 *  local player — generous (wider than HIT_RADIUS) so a strafing dodge still
 *  registers the impact rather than leaving the gated death to time out. */
const LETHAL_ARRIVE_RADIUS = 0.7;

export interface BulletTarget {
  /** Stable id used to skip self-hits (a bullet never hits its own shooter). */
  id: string;
  /** Center position of the body in world space. */
  position: THREE.Vector3;
  /** Half-height of the body (used for vertical hit check). */
  bodyHalfHeight: number;
  /** Owner kind (drives bullet tint + the "bots can't damage remotes" rule). */
  side: BulletOwner;
  /** True for networked remote players: local bots/AI can't damage them
   *  (cross-client damage is server-authoritative), only the local player can. */
  remote?: boolean;
  /** Whether this target is currently dead/inactive. */
  isAlive(): boolean;
  /** Apply damage. Returns true if the target accepted the hit (so the bullet despawns). */
  takeHit(direction: THREE.Vector3): boolean;
}

export interface BulletObstacle {
  x: number;
  z: number;
  radius: number;
  baseY: number;
  topY: number;
}

/** Probe for terrain/world blockers. Returns true if this point is solid (bullet stops). */
export type WorldBlocker = (x: number, y: number, z: number) => boolean;

export class Bullets {
  readonly group: THREE.Group;
  private bullets: Bullet[] = [];
  private targets: BulletTarget[] = [];
  private obstacles: BulletObstacle[] = [];
  private worldBlocker: WorldBlocker | null = null;
  private bounds: { minX: number; maxX: number; minZ: number; maxZ: number } | null = null;
  private onEnd: ((x: number, y: number, z: number) => void) | null = null;
  /** Fired when a damaging bullet lands on a target (for kill attribution). */
  private onDamage: ((target: BulletTarget, ownerId: string) => void) | null = null;
  /** The local player, for the lethal-tracer arrival test (Phase 3). */
  private selfTarget: BulletTarget | null = null;
  /** Fired when a lethal-to-local tracer visibly reaches the local player. */
  private onLethalArrive:
    | ((shooterId: string, seq: number, x: number, y: number, z: number) => void)
    | null = null;

  constructor() {
    this.group = new THREE.Group();
  }

  /**
   * Register a callback that fires whenever any bullet is removed for any reason
   * (life expired, range cap, world/decor blocker, target hit, or out-of-bounds).
   * Game.ts wires this to SmokePuffs.spawnPuff so every bullet end-of-life spawns
   * a white smoke puff at the bullet's last position.
   */
  setOnEnd(fn: (x: number, y: number, z: number) => void) {
    this.onEnd = fn;
  }

  /** Register a callback fired when a damaging bullet hits a target (attribution). */
  setOnDamage(fn: (target: BulletTarget, ownerId: string) => void) {
    this.onDamage = fn;
  }

  /** Register the local player as the arrival target for lethal-to-local tracers. */
  setLethalSelfTarget(t: BulletTarget | null) {
    this.selfTarget = t;
  }

  /** Register a callback fired when a lethal-to-local tracer reaches the local
   *  player — Game uses it to release the gated death IN SYNC with the visible
   *  bullet (Phase 3). */
  setOnLethalArrive(
    fn: (shooterId: string, seq: number, x: number, y: number, z: number) => void,
  ) {
    this.onLethalArrive = fn;
  }

  registerTarget(t: BulletTarget) {
    this.targets.push(t);
  }

  unregisterTarget(t: BulletTarget) {
    this.targets = this.targets.filter((x) => x !== t);
  }

  setObstacles(list: BulletObstacle[]) {
    this.obstacles = list;
  }

  setWorldBlocker(fn: WorldBlocker | null) {
    this.worldBlocker = fn;
  }

  setBounds(b: { minX: number; maxX: number; minZ: number; maxZ: number }) {
    this.bounds = b;
  }

  spawn(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    owner: BulletOwner,
    ownerId: string = owner,
  ) {
    const color =
      owner === "player"
        ? new THREE.Color("#fff8b0")
        : new THREE.Color("#ff5e6c");
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 1,
    });
    const mesh = new THREE.Mesh(BULLET_GEOM, mat);
    mesh.position.copy(origin);
    const dir = direction.clone();
    dir.y = 0; // keep on horizontal plane
    dir.normalize();
    const velocity = dir.multiplyScalar(BULLET_SPEED);
    this.bullets.push({
      mesh,
      velocity,
      life: BULLET_LIFE,
      owner,
      ownerId,
      flightY: origin.y,
      damaging: true,
      traveled: 0,
      maxRange: BULLET_MAX_RANGE,
      shooterId: "",
      reflections: 0,
      lethalToLocal: false,
      seq: -1,
      targetDist: 0,
    });
    this.group.add(mesh);
  }

  /**
   * Spawns a visual-only bullet for a remote player's shot. Travels and expires
   * exactly like a normal bullet (same speed/life/fade/bounds/obstacles) but never
   * applies damage — damage stays on the trusted 'hit' relay path. `shooterId`
   * records who fired it so a saber parry can credit the reflected hit back.
   */
  spawnVisual(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    color: string,
    shooterId: string = "",
    lethal?: { seq: number; selfPos: THREE.Vector3 },
  ) {
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 1,
    });
    const mesh = new THREE.Mesh(BULLET_GEOM, mat);
    mesh.position.copy(origin);
    const dir = direction.clone();
    dir.y = 0; // keep on horizontal plane
    dir.normalize();
    const velocity = dir.multiplyScalar(BULLET_SPEED);
    this.bullets.push({
      mesh,
      velocity,
      life: BULLET_LIFE,
      owner: "player",
      ownerId: "remote",
      flightY: origin.y,
      damaging: false,
      traveled: 0,
      maxRange: BULLET_MAX_RANGE,
      shooterId,
      reflections: 0,
      lethalToLocal: lethal != null,
      seq: lethal?.seq ?? -1,
      targetDist: lethal
        ? Math.hypot(lethal.selfPos.x - origin.x, lethal.selfPos.z - origin.z)
        : 0,
    });
    this.group.add(mesh);
  }

  /**
   * Saber parry: reflect every inbound bullet whose flight crosses the LIVE blade
   * segment (`bladeStart` → `bladeEnd`, world XZ) back toward whoever fired it, up
   * to `maxCount`. A reflected damaging (bot) bullet flips ownership to the
   * parrying side and now damages the enemy on its return path. A reflected remote
   * VISUAL bullet stays non-damaging locally (PvP damage is server-authoritative)
   * — the caller credits it via the "hit" path using the returned `shooterId`.
   *
   * Gates: point-to-segment XZ distance ≤ `capsule` (so the reflect tracks the
   * blade's actual position, not the body), plus an inbound gate (bullet must be
   * travelling toward `playerPos`) so a shot that already passed can't be parried.
   * Returns one entry per reflected bullet (with the contact XYZ for FX).
   */
  reflectInArc(
    bladeStart: THREE.Vector3,
    bladeEnd: THREE.Vector3,
    playerPos: THREE.Vector3,
    capsule: number,
    inboundDot: number,
    vTol: number,
    bulletDt: number,
    newOwner: BulletOwner,
    newOwnerId: string,
    maxCount: number,
  ): Array<{
    prevOwnerId: string;
    shooterId: string;
    wasDamaging: boolean;
    x: number;
    y: number;
    z: number;
  }> {
    const out: Array<{
      prevOwnerId: string;
      shooterId: string;
      wasDamaging: boolean;
      x: number;
      y: number;
      z: number;
    }> = [];
    const sx = bladeStart.x;
    const sz = bladeStart.z;
    const segX = bladeEnd.x - sx;
    const segZ = bladeEnd.z - sz;
    const segLen2 = segX * segX + segZ * segZ || 1;

    const bladeY = (bladeStart.y + bladeEnd.y) * 0.5;

    for (const b of this.bullets) {
      if (out.length >= maxCount) break;
      if (b.ownerId === newOwnerId) continue; // never reflect our own shots
      if (b.reflections >= MAX_BULLET_REFLECTIONS) continue;
      // Vertical gate: only parry bullets flying at roughly the blade's height
      // (the segment test is XZ-only, so without this a bullet far above/below
      // the visible blade could be reflected).
      if (Math.abs(b.flightY - bladeY) > vTol) continue;

      const bx = b.mesh.position.x;
      const bz = b.mesh.position.z;

      // Inbound gate: bullet velocity must point back toward the player.
      const vlen = Math.hypot(b.velocity.x, b.velocity.z) || 1;
      let towardX = playerPos.x - bx;
      let towardZ = playerPos.z - bz;
      const tlen = Math.hypot(towardX, towardZ) || 1;
      towardX /= tlen;
      towardZ /= tlen;
      if ((b.velocity.x / vlen) * towardX + (b.velocity.z / vlen) * towardZ < inboundDot) {
        continue;
      }

      // Swept capsule test: sample the bullet's FRAME PATH (current → current +
      // vel*dt) and accept if any point is within `capsule` of the blade segment.
      // A bullet at 22 u/s moves ~0.73 u/frame at 30fps — more than the capsule —
      // so testing only the current point would let it cross the blade unsampled.
      const nbx = bx + b.velocity.x * bulletDt;
      const nbz = bz + b.velocity.z * bulletDt;
      const pathLen = Math.hypot(nbx - bx, nbz - bz);
      const bSteps = Math.max(1, Math.min(6, Math.ceil(pathLen / capsule)));
      let crossed = false;
      for (let k = 0; k <= bSteps; k++) {
        const f = k / bSteps;
        const px = bx + (nbx - bx) * f;
        const pz = bz + (nbz - bz) * f;
        let t = ((px - sx) * segX + (pz - sz) * segZ) / segLen2;
        t = Math.max(0, Math.min(1, t));
        if (Math.hypot(px - (sx + t * segX), pz - (sz + t * segZ)) <= capsule) {
          crossed = true;
          break;
        }
      }
      if (!crossed) continue;

      // ── Reflect ──
      const prevOwnerId = b.ownerId;
      const shooterId = b.shooterId;
      const wasDamaging = b.damaging;
      b.velocity.x = -b.velocity.x;
      b.velocity.z = -b.velocity.z;
      b.owner = newOwner;
      b.ownerId = newOwnerId;
      b.reflections += 1;
      b.traveled = 0;
      b.life = BULLET_LIFE;
      // A reflected lethal-to-local tracer is now flying AWAY — drop the arrival
      // flag so `traveled >= targetDist` can't later fire onLethalArrive at a puff
      // far from the player. The gated death then falls back to its deadline, which
      // synthesizes the impact ON the player (parry vs a server bot doesn't shield).
      b.lethalToLocal = false;
      b.seq = -1;
      // A reflected remote-visual bullet stays non-damaging locally (avoids
      // double-damage; the server resolves PvP via the credited "hit").
      out.push({ prevOwnerId, shooterId, wasDamaging, x: bx, y: b.mesh.position.y, z: bz });
    }
    return out;
  }

  /**
   * Shooter-side parry response: a remote player parried one of OUR shots, so
   * remove our nearest still-flying damaging bullet (owned by `ownerId`) within
   * `radius` of the parry point (the parrying player's position). This is what
   * makes the parry actually SHIELD the defender in human-vs-human play — without
   * it our authoritative bullet would still report a hit on them. Returns true if
   * a bullet was cancelled. (No shot-ids: the nearest inbound own-bullet is the
   * match; a stray miss is harmless.)
   */
  cancelOwnedNear(ownerId: string, x: number, z: number, radius: number): boolean {
    let best = -1;
    let bestD2 = radius * radius;
    for (let i = 0; i < this.bullets.length; i++) {
      const b = this.bullets[i];
      if (!b.damaging || b.ownerId !== ownerId) continue;
      const d2 = (b.mesh.position.x - x) ** 2 + (b.mesh.position.z - z) ** 2;
      if (d2 <= bestD2) {
        bestD2 = d2;
        best = i;
      }
    }
    if (best < 0) return false;
    this.removeAt(best);
    return true;
  }

  /**
   * Cancel the nearest still-flying VISUAL (non-damaging) bullet fired by
   * `shooterId` within `radius` of (x,z). Used on OBSERVER clients when a remote
   * parries another remote's shot: the forward tracer the observer renders must stop
   * (the reflected visual is spawned separately), so the parry reads the same as on
   * the shooter's own screen. Visual bullets carry the firing player's `shooterId`.
   * Returns true if one was cancelled.
   */
  cancelVisualByShooterNear(shooterId: string, x: number, z: number, radius: number): boolean {
    let best = -1;
    let bestD2 = radius * radius;
    for (let i = 0; i < this.bullets.length; i++) {
      const b = this.bullets[i];
      if (b.damaging || b.shooterId !== shooterId) continue;
      const d2 = (b.mesh.position.x - x) ** 2 + (b.mesh.position.z - z) ** 2;
      if (d2 <= bestD2) {
        bestD2 = d2;
        best = i;
      }
    }
    if (best < 0) return false;
    this.removeAt(best);
    return true;
  }

  update(dt: number) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= dt;
      if (b.life <= 0) {
        this.removeAt(i);
        continue;
      }
      // Move strictly along XZ at constant Y (flightY).
      const stepX = b.velocity.x * dt;
      const stepZ = b.velocity.z * dt;
      b.mesh.position.x += stepX;
      b.mesh.position.z += stepZ;
      b.mesh.position.y = b.flightY;
      // Enforce max range cap — applies to both damaging and visual bullets.
      b.traveled += Math.hypot(stepX, stepZ);
      if (b.traveled >= b.maxRange) {
        this.removeAt(i);
        continue;
      }
      const t = Math.min(1, b.life / BULLET_LIFE);
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = t;

      // --- World bounds: stop if leaves map ---
      if (this.bounds) {
        const bx = b.mesh.position.x;
        const bz = b.mesh.position.z;
        if (
          bx < this.bounds.minX ||
          bx > this.bounds.maxX ||
          bz < this.bounds.minZ ||
          bz > this.bounds.maxZ
        ) {
          this.removeAt(i);
          continue;
        }
      }

      // --- Terrain blocker (hills / lava walls / map cubes) ---
      if (
        this.worldBlocker &&
        this.worldBlocker(b.mesh.position.x, b.flightY, b.mesh.position.z)
      ) {
        this.removeAt(i);
        continue;
      }

      // --- Decor obstacles (trees, rocks, bushes) ---
      let blocked = false;
      for (const o of this.obstacles) {
        // Vertical filter: bullet must be within this prop's height to be blocked
        if (b.flightY < o.baseY - 0.05 || b.flightY > o.topY + 0.05) continue;
        const dxo = o.x - b.mesh.position.x;
        const dzo = o.z - b.mesh.position.z;
        if (dxo * dxo + dzo * dzo <= o.radius * o.radius) {
          blocked = true;
          break;
        }
      }
      if (blocked) {
        this.removeAt(i);
        continue;
      }

      // --- Lethal-to-local tracer arrival (Phase 3 impact gate) ---
      // The server says this shot WILL hit us; hold the death until the bullet
      // visibly reaches us (or its aim point if we strafed), then release it in
      // sync with this impact. Despawning here puffs smoke at the contact point.
      if (b.lethalToLocal && this.selfTarget) {
        const sp = this.selfTarget.position;
        const ddx = sp.x - b.mesh.position.x;
        const ddz = sp.z - b.mesh.position.z;
        const reached =
          ddx * ddx + ddz * ddz <= LETHAL_ARRIVE_RADIUS * LETHAL_ARRIVE_RADIUS ||
          b.traveled >= b.targetDist;
        if (reached) {
          this.onLethalArrive?.(
            b.shooterId,
            b.seq,
            b.mesh.position.x,
            b.mesh.position.y,
            b.mesh.position.z,
          );
          this.removeAt(i);
          continue;
        }
      }

      // Collision check against opposite-side targets — visual-only bullets
      // (remote shots) travel + expire but never apply damage.
      if (b.damaging) {
        const direction = new THREE.Vector3(
          b.velocity.x,
          0,
          b.velocity.z,
        ).normalize();
        let hit = false;
        for (const tgt of this.targets) {
          if (!tgt.isAlive()) continue;
          // Never hit the shooter itself.
          if (tgt.id === b.ownerId) continue;
          // Local AI/bots can't damage networked remotes (server-authoritative);
          // only the local player's bullets reach them (via the hit relay).
          if (b.owner === "bot" && tgt.remote) continue;
          const dx = tgt.position.x - b.mesh.position.x;
          const dz = tgt.position.z - b.mesh.position.z;
          const horiz2 = dx * dx + dz * dz;
          if (horiz2 > HIT_RADIUS * HIT_RADIUS) continue;
          // Vertical check: bullet must intersect the target's body Y range.
          const tgtMinY = tgt.position.y - tgt.bodyHalfHeight;
          const tgtMaxY = tgt.position.y + tgt.bodyHalfHeight;
          if (
            b.flightY < tgtMinY - HIT_VERTICAL_TOLERANCE ||
            b.flightY > tgtMaxY + HIT_VERTICAL_TOLERANCE
          ) {
            continue;
          }
          if (tgt.takeHit(direction)) {
            this.onDamage?.(tgt, b.ownerId);
            hit = true;
            break;
          }
        }
        if (hit) {
          this.removeAt(i);
        }
      }
    }
  }

  private removeAt(i: number) {
    const b = this.bullets[i];
    // Fire the end-of-life callback before the mesh is removed so the position
    // is still valid. Covers ALL removal paths: life expired, range cap,
    // world/decor blocker, out-of-bounds, and target hit.
    if (this.onEnd) {
      this.onEnd(b.mesh.position.x, b.mesh.position.y, b.mesh.position.z);
    }
    this.group.remove(b.mesh);
    (b.mesh.material as THREE.Material).dispose();
    this.bullets.splice(i, 1);
  }

  dispose() {
    this.bullets.forEach((b) => {
      this.group.remove(b.mesh);
      (b.mesh.material as THREE.Material).dispose();
    });
    this.bullets = [];
    this.targets = [];
    // BULLET_GEOM is a module-level singleton shared across Game instances; keep it.
  }
}
