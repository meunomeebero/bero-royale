import * as THREE from "three";

interface FogPuff {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  baseOpacity: number;
  pulseOffset: number;
  bobOffset: number;
  baseY: number;
}

/**
 * Square, voxel-style fog: dozens of tiny white cubes drift slowly across the
 * map at low altitude, wrapping around the edges. They are faint enough to
 * never block visibility, just adding a spooky moving haze on top of the scene.
 */
export class FogPatches {
  readonly group: THREE.Group;
  private puffs: FogPuff[] = [];
  private mapHalf: number;
  private elapsed = 0;
  private geom: THREE.BoxGeometry;

  constructor(mapHalfSize: number, count = 35) {
    this.group = new THREE.Group();
    this.mapHalf = mapHalfSize;

    // A flat, wide cube so it reads as a big horizontal puff hovering over the ground
    this.geom = new THREE.BoxGeometry(1.6, 0.5, 1.6);

    for (let i = 0; i < count; i++) {
      const opacity = 0.054 + Math.random() * 0.063;
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color("#ffffff"),
        transparent: true,
        opacity,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(this.geom, mat);
      // Vary the cube size so the haze looks more organic -- now much chunkier
      const scale = 2.4 + Math.random() * 4.2;
      mesh.scale.set(scale, 0.7 + Math.random() * 0.5, scale);
      const baseY = 0.6 + Math.random() * 1.1;
      mesh.position.set(
        (Math.random() * 2 - 1) * mapHalfSize,
        baseY,
        (Math.random() * 2 - 1) * mapHalfSize,
      );
      const ang = Math.random() * Math.PI * 2;
      const speed = 0.35 + Math.random() * 0.5;
      this.puffs.push({
        mesh,
        velocity: new THREE.Vector3(
          Math.cos(ang) * speed,
          0,
          Math.sin(ang) * speed,
        ),
        baseOpacity: opacity,
        pulseOffset: Math.random() * Math.PI * 2,
        bobOffset: Math.random() * Math.PI * 2,
        baseY,
      });
      this.group.add(mesh);
    }
  }

  update(dt: number) {
    this.elapsed += dt;
    for (const p of this.puffs) {
      p.mesh.position.x += p.velocity.x * dt;
      p.mesh.position.z += p.velocity.z * dt;
      // Wrap the puff to the opposite side of the map
      if (p.mesh.position.x > this.mapHalf) p.mesh.position.x = -this.mapHalf;
      if (p.mesh.position.x < -this.mapHalf) p.mesh.position.x = this.mapHalf;
      if (p.mesh.position.z > this.mapHalf) p.mesh.position.z = -this.mapHalf;
      if (p.mesh.position.z < -this.mapHalf) p.mesh.position.z = this.mapHalf;
      // Gentle vertical bobbing
      p.mesh.position.y =
        p.baseY + Math.sin(this.elapsed * 0.8 + p.bobOffset) * 0.08;
      // Soft opacity breathing
      const mat = p.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity =
        p.baseOpacity *
        (0.75 + 0.25 * Math.sin(this.elapsed * 0.6 + p.pulseOffset));
    }
  }

  dispose() {
    for (const p of this.puffs) {
      (p.mesh.material as THREE.Material).dispose();
    }
    this.puffs = [];
    this.geom.dispose();
  }
}
