import * as THREE from "three";

interface Blade {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  spin: number;
}

const BLADE_GEOM = new THREE.BoxGeometry(0.06, 0.06, 0.06);
const COLORS = [
  new THREE.Color("#5aa094"),
  new THREE.Color("#3a6e6a"),
  new THREE.Color("#6fc2b0"),
  new THREE.Color("#264a4a"),
];

/**
 * Tiny voxel grass particles that pop out when the player walks, jumps or lands
 * on grass. Pure visual juice -- gravity-affected and short-lived.
 */
export class GrassPoof {
  readonly group: THREE.Group;
  private blades: Blade[] = [];

  constructor() {
    this.group = new THREE.Group();
  }

  /**
   * Spawn `count` grass voxels at (position), launching outward and upward.
   * `direction` (XZ) biases the spread (e.g. the player's velocity).
   */
  spawn(
    position: THREE.Vector3,
    count = 4,
    direction: THREE.Vector3 | null = null,
  ) {
    const dir = direction ? direction.clone().setY(0) : new THREE.Vector3();
    if (dir.lengthSq() > 0.0001) dir.normalize();
    for (let i = 0; i < count; i++) {
      const color = COLORS[Math.floor(Math.random() * COLORS.length)];
      const mat = new THREE.MeshLambertMaterial({
        color: color.clone(),
        transparent: true,
        opacity: 1,
        emissive: color.clone().multiplyScalar(0.15),
      });
      const mesh = new THREE.Mesh(BLADE_GEOM, mat);
      mesh.position.copy(position);
      mesh.position.x += (Math.random() - 0.5) * 0.12;
      mesh.position.z += (Math.random() - 0.5) * 0.12;
      const speed = 0.7 + Math.random() * 1.2;
      const spread = 0.6;
      const velocity = new THREE.Vector3(
        dir.x * speed + (Math.random() - 0.5) * spread,
        1.2 + Math.random() * 1.4,
        dir.z * speed + (Math.random() - 0.5) * spread,
      );
      const maxLife = 0.45 + Math.random() * 0.25;
      this.blades.push({
        mesh,
        velocity,
        life: maxLife,
        maxLife,
        spin: (Math.random() - 0.5) * 14,
      });
      this.group.add(mesh);
    }
  }

  update(dt: number) {
    for (let i = this.blades.length - 1; i >= 0; i--) {
      const b = this.blades[i];
      b.life -= dt;
      if (b.life <= 0) {
        this.group.remove(b.mesh);
        (b.mesh.material as THREE.Material).dispose();
        this.blades.splice(i, 1);
        continue;
      }
      b.velocity.y -= 9 * dt; // gravity
      b.mesh.position.addScaledVector(b.velocity, dt);
      b.mesh.rotation.x += b.spin * dt;
      b.mesh.rotation.z += b.spin * dt;
      const t = b.life / b.maxLife;
      (b.mesh.material as THREE.MeshLambertMaterial).opacity = t;
    }
  }

  dispose() {
    for (const b of this.blades) {
      this.group.remove(b.mesh);
      (b.mesh.material as THREE.Material).dispose();
    }
    this.blades = [];
    BLADE_GEOM.dispose();
  }
}
