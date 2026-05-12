import * as THREE from "three";

const PLATFORM_GRID = 8; // 8x8 = 64 blocks
const BLOCK_SIZE = 0.5; // half of previous (1.0)
const BLOCK_HEIGHT = 0.25; // half of previous (0.5)

const COLOR_DARK = new THREE.Color("#0d0d2b");
const COLOR_MED = new THREE.Color("#1a1a3e");
const EDGE_COLOR = new THREE.Color("#3333aa");

export class Platform {
  readonly group: THREE.Group;
  readonly topY: number;
  readonly size: number; // world units
  readonly blockSize = BLOCK_SIZE;

  constructor() {
    this.group = new THREE.Group();
    this.size = PLATFORM_GRID * BLOCK_SIZE;
    this.topY = BLOCK_HEIGHT / 2;

    const geom = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_HEIGHT, BLOCK_SIZE);
    const edgeGeom = new THREE.EdgesGeometry(geom);

    for (let x = 0; x < PLATFORM_GRID; x++) {
      for (let z = 0; z < PLATFORM_GRID; z++) {
        const isCheckered = (x + z) % 2 === 0;
        const mat = new THREE.MeshLambertMaterial({
          color: isCheckered ? COLOR_DARK : COLOR_MED,
        });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.set(x * BLOCK_SIZE, 0, z * BLOCK_SIZE);
        this.group.add(mesh);

        const edges = new THREE.LineSegments(
          edgeGeom,
          new THREE.LineBasicMaterial({
            color: EDGE_COLOR,
            transparent: true,
            opacity: 0.45,
          }),
        );
        edges.position.copy(mesh.position);
        this.group.add(edges);
      }
    }

    // Center the platform around origin so the camera framing is symmetric.
    const offset = -((PLATFORM_GRID - 1) * BLOCK_SIZE) / 2;
    this.group.position.set(offset, 0, offset);
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
}
