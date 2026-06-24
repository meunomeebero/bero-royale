import * as THREE from "three";

/**
 * Small voxel smoke puffs (muzzle smoke, bullet impacts, melee, kame bursts) +
 * the bright muzzle flash.
 *
 * POOLED: each shot used to allocate 7 `new Mesh + new Material + new Color` (and
 * a busy 4-player firefight ~224/s) — steady GC pressure that hitches the frame
 * during sustained fire. The pool pre-allocates a fixed set of mesh+material slots
 * once and reuses them: zero per-spawn allocation. Per-puff colour + opacity-fade +
 * scale-grow are preserved exactly (each slot owns its own material).
 */

interface Smoke {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  active: boolean;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  startScale: number;
  endScale: number;
}

const SMOKE_GEOM = new THREE.BoxGeometry(0.12, 0.12, 0.12);
/** Pool capacity — smoke is the most frequent FX (sustained fire + kame bursts). */
const MAX_PUFFS = 384;

export class SmokePuffs {
  readonly group: THREE.Group;
  private pool: Smoke[] = [];
  private free: number[] = []; // stack of free slot indices

  constructor() {
    this.group = new THREE.Group();
    for (let i = 0; i < MAX_PUFFS; i++) {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 });
      const mesh = new THREE.Mesh(SMOKE_GEOM, mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.pool.push({
        mesh,
        mat,
        active: false,
        velocity: new THREE.Vector3(),
        life: 0,
        maxLife: 0,
        startScale: 1,
        endScale: 1,
      });
      this.free.push(i);
    }
  }

  /** Grab a free pooled slot, or null if the pool is momentarily exhausted. */
  private take(): Smoke | null {
    const slot = this.free.pop();
    if (slot === undefined) return null;
    return this.pool[slot];
  }

  /**
   * Spawn a small voxel smoke puff cloud at the given world position,
   * drifting in roughly `direction` while spreading and fading.
   */
  spawnPuff(
    position: THREE.Vector3,
    direction: THREE.Vector3,
    count = 5,
    color = "#cccccc",
    sizeMul = 1,
  ) {
    const dx = direction.x, dy = direction.y, dz = direction.z;
    const dl = Math.hypot(dx, dy, dz) || 1;
    const nx = dx / dl, ny = dy / dl, nz = dz / dl;
    for (let i = 0; i < count; i++) {
      const p = this.take();
      if (!p) break; // pool exhausted — drop the overflow (invisible under load)
      p.mat.color.set(color);
      p.mat.opacity = 0.55;
      p.mesh.position.set(
        position.x + (Math.random() - 0.5) * 0.06,
        position.y + (Math.random() - 0.5) * 0.06,
        position.z + (Math.random() - 0.5) * 0.06,
      );
      const baseSpeed = 0.8 + Math.random() * 0.4;
      const spread = 0.6;
      p.velocity.set(
        nx * baseSpeed + (Math.random() - 0.5) * spread,
        ny * baseSpeed + 0.2 + Math.random() * 0.4,
        nz * baseSpeed + (Math.random() - 0.5) * spread,
      );
      p.maxLife = 0.45 + Math.random() * 0.3;
      p.life = p.maxLife;
      p.startScale = (0.8 + Math.random() * 0.4) * sizeMul;
      p.endScale = (2.0 + Math.random() * 1.0) * sizeMul;
      p.mesh.scale.setScalar(p.startScale);
      p.active = true;
      p.mesh.visible = true;
    }
  }

  /**
   * Bright muzzle flash: a single yellow-orange cube that pops big and disappears fast.
   */
  spawnFlash(position: THREE.Vector3, direction: THREE.Vector3) {
    const p = this.take();
    if (!p) return;
    const dl = Math.hypot(direction.x, direction.y, direction.z) || 1;
    const nx = direction.x / dl, ny = direction.y / dl, nz = direction.z / dl;
    p.mat.color.set("#ffdf6b");
    p.mat.opacity = 1;
    p.mesh.position.set(
      position.x + nx * 0.05,
      position.y + ny * 0.05,
      position.z + nz * 0.05,
    );
    p.velocity.set(nx * 0.6, ny * 0.6, nz * 0.6);
    p.life = 0.09;
    p.maxLife = 0.09;
    p.startScale = 1.6;
    p.endScale = 0.6;
    p.mesh.scale.setScalar(p.startScale);
    p.active = true;
    p.mesh.visible = true;
  }

  update(dt: number) {
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i];
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        p.mesh.visible = false;
        this.free.push(i);
        continue;
      }
      // Drift (very mild gravity to make it rise / float). Kept axis-aligned so
      // the puffs read as clean voxel cubes rather than tumbling diamonds.
      p.velocity.y -= 0.4 * dt; // mostly buoyancy already encoded in initial velocity
      p.mesh.position.addScaledVector(p.velocity, dt);
      const t = p.life / p.maxLife; // 1 -> 0
      const s = p.endScale + (p.startScale - p.endScale) * t;
      p.mesh.scale.set(s, s, s);
      p.mat.opacity = 0.7 * t;
    }
  }

  dispose() {
    for (const p of this.pool) {
      this.group.remove(p.mesh);
      p.mat.dispose();
    }
    this.pool = [];
    this.free = [];
    // SMOKE_GEOM is a module-level singleton shared across Game instances
    // (menu → play → menu); do NOT dispose it here.
  }
}
