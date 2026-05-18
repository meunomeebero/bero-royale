import * as THREE from "three";

const PLATFORM_GRID = 80; // 80 x 80 = 6400 blocks
const BLOCK_SIZE = 0.5;
const BLOCK_HEIGHT = 0.25;

const ASPHALT_TEXTURE_URL =
  "https://grazia-prod.oss-ap-southeast-1.aliyuncs.com/resources/uid_100032862/asphalt_moss_tile_d5e9cb5e.png";

export class Platform {
  readonly group: THREE.Group;
  readonly topY: number;
  readonly size: number;
  readonly blockSize = BLOCK_SIZE;

  constructor() {
    this.group = new THREE.Group();
    this.size = PLATFORM_GRID * BLOCK_SIZE;
    this.topY = BLOCK_HEIGHT / 2;

    // Single large flat slab textured with the tileable asphalt+moss map.
    const slabGeom = new THREE.BoxGeometry(
      this.size,
      BLOCK_HEIGHT,
      this.size,
    );

    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    const tex = loader.load(ASPHALT_TEXTURE_URL);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(PLATFORM_GRID / 2, PLATFORM_GRID / 2);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;

    const topMat = new THREE.MeshLambertMaterial({
      map: tex,
      color: new THREE.Color("#9aa0a8"),
    });
    const sideMat = new THREE.MeshLambertMaterial({
      color: new THREE.Color("#1a1a2e"),
    });
    // BoxGeometry face order: +X, -X, +Y (top), -Y (bottom), +Z, -Z
    const materials = [
      sideMat,
      sideMat,
      topMat,
      sideMat,
      sideMat,
      sideMat,
    ];
    const slab = new THREE.Mesh(slabGeom, materials);
    slab.position.set(0, 0, 0);
    this.group.add(slab);
  }

  getBounds() {
    const half = this.size / 2;
    return {
      minX: -half,
      maxX: half,
      minZ: -half,
      maxZ: half,
    };
  }

  randomSpawn(margin = 4): THREE.Vector3 {
    const half = this.size / 2 - margin;
    return new THREE.Vector3(
      (Math.random() * 2 - 1) * half,
      this.topY + 0.25,
      (Math.random() * 2 - 1) * half,
    );
  }
}
