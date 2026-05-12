import * as THREE from "three";

const PLATFORM_GRID = 80; // 80 x 80 = 6400 blocks (10x larger than the original 8x8 = 64)
const BLOCK_SIZE = 0.5;
const BLOCK_HEIGHT = 0.25;

const COLOR_DARK = new THREE.Color("#0d0d2b");
const COLOR_MED = new THREE.Color("#1a1a3e");

export class Platform {
  readonly group: THREE.Group;
  readonly topY: number;
  readonly size: number; // total side length in world units
  readonly blockSize = BLOCK_SIZE;

  constructor() {
    this.group = new THREE.Group();
    this.size = PLATFORM_GRID * BLOCK_SIZE;
    this.topY = BLOCK_HEIGHT / 2;

    const geom = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_HEIGHT, BLOCK_SIZE);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: false });
    const total = PLATFORM_GRID * PLATFORM_GRID;

    const mesh = new THREE.InstancedMesh(geom, mat, total);
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

    const dummy = new THREE.Object3D();
    const offset = -((PLATFORM_GRID - 1) * BLOCK_SIZE) / 2;
    let i = 0;
    for (let x = 0; x < PLATFORM_GRID; x++) {
      for (let z = 0; z < PLATFORM_GRID; z++) {
        dummy.position.set(
          offset + x * BLOCK_SIZE,
          0,
          offset + z * BLOCK_SIZE,
        );
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        const isCheckered = (x + z) % 2 === 0;
        mesh.setColorAt(i, isCheckered ? COLOR_DARK : COLOR_MED);
        i++;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    this.group.add(mesh);
  }

  /** Bounds in world coordinates (post centering). */
  getBounds() {
    const half = this.size / 2;
    return {
      minX: -half,
      maxX: half,
      minZ: -half,
      maxZ: half,
    };
  }

  /** Random spawn position on top of the platform (with edge margin). */
  randomSpawn(margin = 4): THREE.Vector3 {
    const half = this.size / 2 - margin;
    return new THREE.Vector3(
      (Math.random() * 2 - 1) * half,
      this.topY + 0.25,
      (Math.random() * 2 - 1) * half,
    );
  }
}
