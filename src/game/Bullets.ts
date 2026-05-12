import * as THREE from "three";

interface Bullet {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
}

const BULLET_GEOM = new THREE.BoxGeometry(0.08, 0.08, 0.08);
const BULLET_SPEED = 22;
const BULLET_LIFE = 1.4;

export class Bullets {
  readonly group: THREE.Group;
  private bullets: Bullet[] = [];

  constructor() {
    this.group = new THREE.Group();
  }

  spawn(origin: THREE.Vector3, direction: THREE.Vector3) {
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color("#fff8b0"),
      transparent: true,
      opacity: 1,
    });
    const mesh = new THREE.Mesh(BULLET_GEOM, mat);
    mesh.position.copy(origin);
    const dir = direction.clone().normalize();
    const velocity = dir.multiplyScalar(BULLET_SPEED);
    this.bullets.push({ mesh, velocity, life: BULLET_LIFE });
    this.group.add(mesh);
  }

  update(dt: number) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= dt;
      if (b.life <= 0) {
        this.group.remove(b.mesh);
        (b.mesh.material as THREE.Material).dispose();
        this.bullets.splice(i, 1);
        continue;
      }
      b.mesh.position.addScaledVector(b.velocity, dt);
      const t = Math.min(1, b.life / BULLET_LIFE);
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = t;
    }
  }

  dispose() {
    this.bullets.forEach((b) => {
      this.group.remove(b.mesh);
      (b.mesh.material as THREE.Material).dispose();
    });
    this.bullets = [];
    BULLET_GEOM.dispose();
  }
}
