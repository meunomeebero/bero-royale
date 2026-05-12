import * as THREE from "three";

const PLATFORM_SIZE = 8; // 8x8 = 64 blocks
const BLOCK_SIZE = 1;
const BLOCK_HEIGHT = 0.5;

const COLOR_DARK = new THREE.Color("#0d0d2b");
const COLOR_MED = new THREE.Color("#1a1a3e");
const EDGE_COLOR = new THREE.Color("#3333aa");

export class Platform {
  readonly group: THREE.Group;
  readonly topY: number;
  readonly size: number;

  constructor() {
    this.group = new THREE.Group();
    this.size = PLATFORM_SIZE;
    this.topY = BLOCK_HEIGHT / 2;

    const geom = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_HEIGHT, BLOCK_SIZE);
    const edgeGeom = new THREE.EdgesGeometry(geom);

    for (let x = 0; x < PLATFORM_SIZE; x++) {
      for (let z = 0; z < PLATFORM_SIZE; z++) {
        const isCheckered = (x + z) % 2 === 0;
        const mat = new THREE.MeshLambertMaterial({
          color: isCheckered ? COLOR_DARK : COLOR_MED,
        });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.set(x, 0, z);
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
    this.group.position.set(
      -(PLATFORM_SIZE - 1) / 2,
      0,
      -(PLATFORM_SIZE - 1) / 2,
    );
  }

  /** Bounds in world coordinates (post centering). */
  getBounds() {
    const half = PLATFORM_SIZE / 2;
    return {
      minX: -half,
      maxX: half,
      minZ: -half,
      maxZ: half,
    };
  }
}
