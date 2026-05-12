import * as THREE from "three";

export type BulletOwner = "player" | "bot";

interface Bullet {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  owner: BulletOwner;
  /** Height (Y) that the bullet was fired from. Stays constant — bullets do not track players vertically. */
  flightY: number;
}

const BULLET_GEOM = new THREE.BoxGeometry(0.1, 0.1, 0.1);
const BULLET_SPEED = 22;
const BULLET_LIFE = 1.6;
const HIT_RADIUS = 0.35; // squared distance check uses radius
/** Vertical tolerance: a bullet at flightY only hits a target whose body is within this Y range. */
const HIT_VERTICAL_TOLERANCE = 0.35;

export interface BulletTarget {
  /** Stable id used to skip self-hits via owner. */
  id: string;
  /** Center position of the body in world space. */
  position: THREE.Vector3;
  /** Half-height of the body (used for vertical hit check). */
  bodyHalfHeight: number;
  /** Owner kind; bullets hit only the *opposite* side. */
  side: BulletOwner;
  /** Whether this target is currently dead/inactive. */
  isAlive(): boolean;
  /** Apply damage. Returns true if the target accepted the hit (so the bullet despawns). */
  takeHit(direction: THREE.Vector3): boolean;
}

export class Bullets {
  readonly group: THREE.Group;
  private bullets: Bullet[] = [];
  private targets: BulletTarget[] = [];

  constructor() {
    this.group = new THREE.Group();
  }

  registerTarget(t: BulletTarget) {
    this.targets.push(t);
  }

  unregisterTarget(t: BulletTarget) {
    this.targets = this.targets.filter((x) => x !== t);
  }

  spawn(origin: THREE.Vector3, direction: THREE.Vector3, owner: BulletOwner) {
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
      flightY: origin.y,
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
      b.mesh.position.x += b.velocity.x * dt;
      b.mesh.position.z += b.velocity.z * dt;
      b.mesh.position.y = b.flightY;
      const t = Math.min(1, b.life / BULLET_LIFE);
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = t;

      // Collision check against opposite-side targets
      const direction = new THREE.Vector3(
        b.velocity.x,
        0,
        b.velocity.z,
      ).normalize();
      let hit = false;
      for (const tgt of this.targets) {
        if (!tgt.isAlive()) continue;
        if (tgt.side === b.owner) continue;
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
          hit = true;
          break;
        }
      }
      if (hit) {
        this.removeAt(i);
      }
    }
  }

  private removeAt(i: number) {
    const b = this.bullets[i];
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
    BULLET_GEOM.dispose();
  }
}
