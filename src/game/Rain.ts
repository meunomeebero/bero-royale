import * as THREE from "three";

/**
 * Voxel-style rain: small thin cubes that fall from the sky down to the
 * ground, then respawn back at the top. The drops are slightly tinted blue
 * and faintly transparent so they keep the spooky night vibe without
 * obscuring gameplay.
 */
interface RainDrop {
  /** Instance index inside the InstancedMesh */
  i: number;
  x: number;
  z: number;
  y: number;
  speed: number;
}

export class Rain {
  readonly mesh: THREE.InstancedMesh;
  private drops: RainDrop[] = [];
  private mapHalf: number;
  private dummy = new THREE.Object3D();
  private topY = 14;
  private bottomY = 0.2;

  constructor(mapHalfSize: number, count = 280) {
    this.mapHalf = mapHalfSize;

    // Tall, very thin cube -- looks like a falling streak
    const geom = new THREE.BoxGeometry(0.05, 0.55, 0.05);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color("#aac6ff"),
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    this.mesh = new THREE.InstancedMesh(geom, mat, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;

    for (let i = 0; i < count; i++) {
      const drop: RainDrop = {
        i,
        x: (Math.random() * 2 - 1) * mapHalfSize,
        z: (Math.random() * 2 - 1) * mapHalfSize,
        y: this.bottomY + Math.random() * (this.topY - this.bottomY),
        speed: 16 + Math.random() * 10,
      };
      this.drops.push(drop);
      this.writeMatrix(drop);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private writeMatrix(d: RainDrop) {
    this.dummy.position.set(d.x, d.y, d.z);
    this.dummy.rotation.set(0, 0, 0);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(d.i, this.dummy.matrix);
  }

  update(dt: number) {
    for (const d of this.drops) {
      d.y -= d.speed * dt;
      if (d.y <= this.bottomY) {
        // Respawn at top with a fresh horizontal position
        d.y = this.topY + Math.random() * 2;
        d.x = (Math.random() * 2 - 1) * this.mapHalf;
        d.z = (Math.random() * 2 - 1) * this.mapHalf;
        d.speed = 16 + Math.random() * 10;
      }
      this.writeMatrix(d);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.geometry.dispose();
    this.drops = [];
  }
}
