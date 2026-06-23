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
}

const BULLET_GEOM = new THREE.BoxGeometry(0.1, 0.1, 0.1);
const BULLET_SPEED = 22;
const BULLET_LIFE = 1.6;
const HIT_RADIUS = 0.35; // squared distance check uses radius
/**
 * Maximum XZ travel distance for any bullet (local or visual-remote).
 * Caps at 2 * HEARING_RADIUS so bullets never fly past the audio horizon.
 * Bot-vs-bot damage in ambient mode is achieved by alternating the bot `side`
 * ("player" vs "bot") so each bot's bullets are owned by the opposite side and
 * pass the `tgt.side === b.owner` skip-guard — no change to this collision path.
 */
const BULLET_MAX_RANGE = 2 * HEARING_RADIUS;
/** Vertical tolerance: a bullet at flightY only hits a target whose body is within this Y range. */
const HIT_VERTICAL_TOLERANCE = 0.35;

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
    });
    this.group.add(mesh);
  }

  /**
   * Spawns a visual-only bullet for a remote player's shot. Travels and expires
   * exactly like a normal bullet (same speed/life/fade/bounds/obstacles) but never
   * applies damage — damage stays on the trusted 'hit' relay path.
   */
  spawnVisual(origin: THREE.Vector3, direction: THREE.Vector3, color: string) {
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
    });
    this.group.add(mesh);
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
