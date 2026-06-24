import * as THREE from "three";

/**
 * Brutal-but-voxel death burst: when an entity dies it explodes into a spray of
 * small red/crimson "meat" cubes that fly out, tumble, fall under gravity and
 * settle on the ground, then fade.
 *
 * POOLED: a kill used to allocate up to 48 `new Mesh + new Material + new Color`
 * in a SINGLE frame (a visible GC hitch exactly when you kill someone). The pool
 * pre-allocates a fixed set of mesh+material slots once at construction and reuses
 * them — zero per-spawn allocation, so the burst no longer stutters. Geometry is
 * swapped per spawn (cheap ref change) to vary chunk size; per-chunk colour +
 * opacity-fade are preserved exactly (each slot owns its material).
 */

interface Chunk {
  mesh: THREE.Mesh;
  mat: THREE.MeshLambertMaterial;
  active: boolean;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
  maxLife: number;
  groundY: number;
  half: number;
}

const COLORS = ["#c01818", "#9e1212", "#e23a3a", "#7a0e0e", "#d14e6e", "#b22020"];
// A few cube sizes — bigger "pieces" + small spurting bits.
const SIZES = [0.18, 0.13, 0.1, 0.07];
const GEOS = SIZES.map((s) => new THREE.BoxGeometry(s, s, s));
const HALVES = SIZES.map((s) => s / 2);
const GRAVITY = 15;
/** Pool capacity — covers several overlapping 48-chunk bursts. */
const MAX_CHUNKS = 256;

export class Gore {
  readonly group: THREE.Group;
  private pool: Chunk[] = [];
  private free: number[] = []; // stack of free slot indices

  constructor() {
    this.group = new THREE.Group();
    for (let i = 0; i < MAX_CHUNKS; i++) {
      const mat = new THREE.MeshLambertMaterial({ transparent: true });
      const mesh = new THREE.Mesh(GEOS[0], mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.pool.push({
        mesh,
        mat,
        active: false,
        vel: new THREE.Vector3(),
        spin: new THREE.Vector3(),
        life: 0,
        maxLife: 0,
        groundY: 0,
        half: HALVES[0],
      });
      this.free.push(i);
    }
  }

  /** Explode a gore burst at `pos`; chunks settle on `groundY`. */
  spawn(pos: THREE.Vector3, groundY: number, count = 20) {
    for (let i = 0; i < count; i++) {
      const slot = this.free.pop();
      if (slot === undefined) break; // pool exhausted — drop the overflow
      const c = this.pool[slot];
      const gi = Math.floor(Math.random() * GEOS.length);
      c.mesh.geometry = GEOS[gi];
      c.half = HALVES[gi];
      c.mat.color.set(COLORS[Math.floor(Math.random() * COLORS.length)]);
      c.mat.opacity = 1;
      c.mesh.position.set(
        pos.x + (Math.random() - 0.5) * 0.18,
        pos.y + 0.15 + (Math.random() - 0.5) * 0.2,
        pos.z + (Math.random() - 0.5) * 0.18,
      );
      c.mesh.rotation.set(0, 0, 0);
      const ang = Math.random() * Math.PI * 2;
      const out = 2.2 + Math.random() * 4.5;
      c.vel.set(Math.cos(ang) * out, 3.2 + Math.random() * 4.5, Math.sin(ang) * out);
      c.spin.set(
        (Math.random() - 0.5) * 12,
        (Math.random() - 0.5) * 12,
        (Math.random() - 0.5) * 12,
      );
      c.maxLife = 0.7 + Math.random() * 0.7;
      c.life = c.maxLife;
      c.groundY = groundY;
      c.active = true;
      c.mesh.visible = true;
    }
  }

  update(dt: number) {
    for (let i = 0; i < this.pool.length; i++) {
      const c = this.pool[i];
      if (!c.active) continue;
      c.life -= dt;
      if (c.life <= 0) {
        c.active = false;
        c.mesh.visible = false;
        this.free.push(i);
        continue;
      }
      c.vel.y -= GRAVITY * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      // Settle on the ground with a little bounce + friction.
      const floor = c.groundY + c.half;
      if (c.mesh.position.y <= floor) {
        c.mesh.position.y = floor;
        c.vel.y *= -0.32;
        c.vel.x *= 0.6;
        c.vel.z *= 0.6;
        c.spin.multiplyScalar(0.5);
      }
      c.mesh.rotation.x += c.spin.x * dt;
      c.mesh.rotation.y += c.spin.y * dt;
      c.mesh.rotation.z += c.spin.z * dt;
      const t = c.life / c.maxLife;
      c.mat.opacity = Math.min(1, t * 1.6);
    }
  }

  dispose() {
    for (const c of this.pool) {
      this.group.remove(c.mesh);
      c.mat.dispose();
    }
    this.pool = [];
    this.free = [];
    // GEOS are module-level shared singletons reused across Game instances
    // (menu → play → menu); do NOT dispose them here.
  }
}
