import * as THREE from "three";

/**
 * Brutal-but-voxel death burst: when an entity dies it explodes into a spray of
 * small red/crimson "meat" cubes that fly out, tumble, fall under gravity and
 * settle on the ground, then fade.
 */

interface Chunk {
  mesh: THREE.Mesh;
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
const GRAVITY = 15;

export class Gore {
  readonly group: THREE.Group;
  private chunks: Chunk[] = [];

  constructor() {
    this.group = new THREE.Group();
  }

  /** Explode a gore burst at `pos`; chunks settle on `groundY`. */
  spawn(pos: THREE.Vector3, groundY: number, count = 20) {
    for (let i = 0; i < count; i++) {
      const gi = Math.floor(Math.random() * GEOS.length);
      const mat = new THREE.MeshLambertMaterial({
        color: new THREE.Color(COLORS[Math.floor(Math.random() * COLORS.length)]),
        transparent: true,
      });
      const mesh = new THREE.Mesh(GEOS[gi], mat);
      mesh.position
        .copy(pos)
        .add(
          new THREE.Vector3(
            (Math.random() - 0.5) * 0.18,
            0.15 + (Math.random() - 0.5) * 0.2,
            (Math.random() - 0.5) * 0.18,
          ),
        );
      const ang = Math.random() * Math.PI * 2;
      const out = 2.2 + Math.random() * 4.5;
      const vel = new THREE.Vector3(
        Math.cos(ang) * out,
        3.2 + Math.random() * 4.5,
        Math.sin(ang) * out,
      );
      const maxLife = 0.7 + Math.random() * 0.7;
      this.chunks.push({
        mesh,
        vel,
        spin: new THREE.Vector3(
          (Math.random() - 0.5) * 12,
          (Math.random() - 0.5) * 12,
          (Math.random() - 0.5) * 12,
        ),
        life: maxLife,
        maxLife,
        groundY,
        half: SIZES[gi] / 2,
      });
      this.group.add(mesh);
    }
  }

  update(dt: number) {
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i];
      c.life -= dt;
      if (c.life <= 0) {
        this.group.remove(c.mesh);
        (c.mesh.material as THREE.Material).dispose();
        this.chunks.splice(i, 1);
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
      (c.mesh.material as THREE.MeshLambertMaterial).opacity = Math.min(1, t * 1.6);
    }
  }

  dispose() {
    for (const c of this.chunks) {
      this.group.remove(c.mesh);
      (c.mesh.material as THREE.Material).dispose();
    }
    this.chunks = [];
    // GEOS are module-level shared singletons reused across Game instances
    // (menu → play → menu); do NOT dispose them here.
  }
}
