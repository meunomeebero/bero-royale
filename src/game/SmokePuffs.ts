import * as THREE from "three";

interface Smoke {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  spin: number;
  startScale: number;
  endScale: number;
}

const SMOKE_GEOM = new THREE.BoxGeometry(0.12, 0.12, 0.12);

export class SmokePuffs {
  readonly group: THREE.Group;
  private smokes: Smoke[] = [];

  constructor() {
    this.group = new THREE.Group();
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
  ) {
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(color),
        transparent: true,
        opacity: 0.55,
      });
      const mesh = new THREE.Mesh(SMOKE_GEOM, mat);
      mesh.position.copy(position).add(
        new THREE.Vector3(
          (Math.random() - 0.5) * 0.06,
          (Math.random() - 0.5) * 0.06,
          (Math.random() - 0.5) * 0.06,
        ),
      );
      const baseSpeed = 0.8 + Math.random() * 0.4;
      const spread = 0.6;
      const velocity = direction
        .clone()
        .normalize()
        .multiplyScalar(baseSpeed)
        .add(
          new THREE.Vector3(
            (Math.random() - 0.5) * spread,
            0.2 + Math.random() * 0.4,
            (Math.random() - 0.5) * spread,
          ),
        );
      const maxLife = 0.45 + Math.random() * 0.3;
      this.smokes.push({
        mesh,
        velocity,
        life: maxLife,
        maxLife,
        spin: (Math.random() - 0.5) * 6,
        startScale: 0.8 + Math.random() * 0.4,
        endScale: 2.0 + Math.random() * 1.0,
      });
      this.group.add(mesh);
    }
  }

  /**
   * Bright muzzle flash: a single yellow-orange cube that pops big and disappears fast.
   */
  spawnFlash(position: THREE.Vector3, direction: THREE.Vector3) {
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color("#ffdf6b"),
      transparent: true,
      opacity: 1,
    });
    const mesh = new THREE.Mesh(SMOKE_GEOM, mat);
    mesh.position.copy(position).add(direction.clone().normalize().multiplyScalar(0.05));
    this.smokes.push({
      mesh,
      velocity: direction.clone().normalize().multiplyScalar(0.6),
      life: 0.09,
      maxLife: 0.09,
      spin: 0,
      startScale: 1.6,
      endScale: 0.6,
    });
    this.group.add(mesh);
  }

  update(dt: number) {
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const p = this.smokes[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.group.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
        this.smokes.splice(i, 1);
        continue;
      }
      // Drift (very mild gravity to make it rise / float). Kept axis-aligned so
      // the puffs read as clean voxel cubes rather than tumbling diamonds.
      p.velocity.y -= 0.4 * dt; // mostly buoyancy already encoded in initial velocity
      p.mesh.position.addScaledVector(p.velocity, dt);
      const t = p.life / p.maxLife; // 1 -> 0
      const s =
        p.endScale + (p.startScale - p.endScale) * t;
      p.mesh.scale.set(s, s, s);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = 0.7 * t;
    }
  }

  dispose() {
    this.smokes.forEach((p) => {
      this.group.remove(p.mesh);
      (p.mesh.material as THREE.Material).dispose();
    });
    this.smokes = [];
    // SMOKE_GEOM is a module-level singleton shared across Game instances
    // (menu → play → menu); do NOT dispose it here.
  }
}
