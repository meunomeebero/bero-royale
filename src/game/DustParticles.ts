import * as THREE from "three";

interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number; // remaining seconds
  maxLife: number;
}

const PARTICLE_GEOM = new THREE.BoxGeometry(0.15, 0.15, 0.15);

export class DustParticles {
  readonly group: THREE.Group;
  private particles: Particle[] = [];

  constructor() {
    this.group = new THREE.Group();
  }

  spawnBurst(position: THREE.Vector3, count = 8) {
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color("#a78bfa"),
        transparent: true,
        opacity: 0.9,
      });
      const mesh = new THREE.Mesh(PARTICLE_GEOM, mat);
      mesh.position.copy(position);

      const angle = Math.random() * Math.PI * 2;
      const speed = 0.6 + Math.random() * 0.8;
      const velocity = new THREE.Vector3(
        Math.cos(angle) * speed,
        0.4 + Math.random() * 0.6,
        Math.sin(angle) * speed,
      );

      const maxLife = 0.45 + Math.random() * 0.2;
      this.particles.push({ mesh, velocity, life: maxLife, maxLife });
      this.group.add(mesh);
    }
  }

  update(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.group.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
        this.particles.splice(i, 1);
        continue;
      }
      // gravity
      p.velocity.y -= 3.0 * dt;
      p.mesh.position.addScaledVector(p.velocity, dt);
      // small spin for juice
      p.mesh.rotation.x += dt * 4;
      p.mesh.rotation.z += dt * 4;
      const t = p.life / p.maxLife;
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = t * 0.9;
      const s = 0.6 + t * 0.8;
      p.mesh.scale.set(s, s, s);
    }
  }

  dispose() {
    this.particles.forEach((p) => {
      this.group.remove(p.mesh);
      (p.mesh.material as THREE.Material).dispose();
    });
    this.particles = [];
    PARTICLE_GEOM.dispose();
  }
}
