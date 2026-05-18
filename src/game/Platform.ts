import * as THREE from "three";

const PLATFORM_GRID = 80;
const BLOCK_SIZE = 0.5;
const BLOCK_HEIGHT = 0.25;
const SIZE = PLATFORM_GRID * BLOCK_SIZE; // 40 units across

// Width of the avenues (in blocks). Roads run through the middle of the map
// forming a giant "+" (cross) with a Shibuya-style scramble crossing.
const ROAD_WIDTH_BLOCKS = 16;

const ASPHALT_TEXTURE_URL =
  "https://grazia-prod.oss-ap-southeast-1.aliyuncs.com/resources/uid_100032862/asphalt_moss_tile_d5e9cb5e.png";
const SIDEWALK_TEXTURE_URL =
  "https://grazia-prod.oss-ap-southeast-1.aliyuncs.com/resources/uid_100032862/sidewalk_tile_bf7c93b8.png";
const CROSSWALK_TEXTURE_URL =
  "https://grazia-prod.oss-ap-southeast-1.aliyuncs.com/resources/uid_100032862/crosswalk_tile_9c610974.png";

interface SlabConfig {
  textureUrl: string;
  repeat: number;
  tint?: string;
  /** Rotate the top texture 90 degrees so stripes run perpendicular. */
  rotate?: boolean;
}

function makeSlab(
  width: number,
  depth: number,
  cfg: SlabConfig,
  yOffset = 0,
): THREE.Mesh {
  const geom = new THREE.BoxGeometry(width, BLOCK_HEIGHT, depth);

  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin("anonymous");
  const tex = loader.load(cfg.textureUrl);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(cfg.repeat, cfg.repeat * (depth / width));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (cfg.rotate) {
    tex.center.set(0.5, 0.5);
    tex.rotation = Math.PI / 2;
  }

  const topMat = new THREE.MeshLambertMaterial({
    map: tex,
    color: new THREE.Color(cfg.tint ?? "#ffffff"),
  });
  const sideMat = new THREE.MeshLambertMaterial({
    color: new THREE.Color("#1a1a2e"),
  });
  // BoxGeometry face order: +X, -X, +Y, -Y, +Z, -Z
  const slab = new THREE.Mesh(geom, [
    sideMat,
    sideMat,
    topMat,
    sideMat,
    sideMat,
    sideMat,
  ]);
  slab.position.y = yOffset;
  return slab;
}

export class Platform {
  readonly group: THREE.Group;
  readonly topY: number;
  readonly size: number;
  readonly blockSize = BLOCK_SIZE;

  constructor() {
    this.group = new THREE.Group();
    this.size = SIZE;
    this.topY = BLOCK_HEIGHT / 2;

    const roadW = ROAD_WIDTH_BLOCKS * BLOCK_SIZE; // 8 units
    const halfRoad = roadW / 2;
    const sideWidth = (SIZE - roadW) / 2; // width of each sidewalk block (= 16 units)
    const sideOffset = halfRoad + sideWidth / 2;

    // ---- SIDEWALK BLOCKS (the four corner quadrants outside the cross) ----
    const sidewalkCfg: SlabConfig = {
      textureUrl: SIDEWALK_TEXTURE_URL,
      repeat: 8,
      tint: "#c4c8cf",
    };
    // 4 corner quadrants
    const quadrants: Array<[number, number]> = [
      [-sideOffset, -sideOffset],
      [sideOffset, -sideOffset],
      [-sideOffset, sideOffset],
      [sideOffset, sideOffset],
    ];
    for (const [x, z] of quadrants) {
      const slab = makeSlab(sideWidth, sideWidth, sidewalkCfg);
      slab.position.set(x, 0, z);
      this.group.add(slab);
    }

    // ---- ASPHALT ROADS (horizontal + vertical strips) ----
    const asphaltCfg: SlabConfig = {
      textureUrl: ASPHALT_TEXTURE_URL,
      repeat: 4,
      tint: "#8a8e94",
    };
    // Horizontal road (full width minus the central intersection)
    const hLeft = makeSlab(sideWidth, roadW, asphaltCfg);
    hLeft.position.set(-sideOffset, 0, 0);
    this.group.add(hLeft);
    const hRight = makeSlab(sideWidth, roadW, asphaltCfg);
    hRight.position.set(sideOffset, 0, 0);
    this.group.add(hRight);
    // Vertical road
    const vTop = makeSlab(roadW, sideWidth, asphaltCfg);
    vTop.position.set(0, 0, -sideOffset);
    this.group.add(vTop);
    const vBot = makeSlab(roadW, sideWidth, asphaltCfg);
    vBot.position.set(0, 0, sideOffset);
    this.group.add(vBot);

    // ---- CROSSWALKS leading into the central intersection ----
    // Each crosswalk is a strip running across one of the four road arms.
    const crossDepth = 4 * BLOCK_SIZE; // 2 units deep (stripe band)
    // Place the crosswalk slightly INSIDE each road arm, near the intersection.
    const crossInset = halfRoad + crossDepth / 2 - 0.01;

    const crosswalkCfg: SlabConfig = {
      textureUrl: CROSSWALK_TEXTURE_URL,
      repeat: 1,
      tint: "#ffffff",
    };

    // Top (north) crosswalk: spans the full road width, depth = crossDepth on Z
    const cwN = makeSlab(roadW, crossDepth, crosswalkCfg, 0.005);
    cwN.position.set(0, 0.005, -crossInset);
    this.group.add(cwN);
    const cwS = makeSlab(roadW, crossDepth, crosswalkCfg, 0.005);
    cwS.position.set(0, 0.005, crossInset);
    this.group.add(cwS);

    // East/West crosswalks: rotate the stripe texture 90deg so bars are perpendicular.
    const crosswalkCfgRot: SlabConfig = {
      ...crosswalkCfg,
      rotate: true,
    };
    const cwE = makeSlab(crossDepth, roadW, crosswalkCfgRot, 0.005);
    cwE.position.set(crossInset, 0.005, 0);
    this.group.add(cwE);
    const cwW = makeSlab(crossDepth, roadW, crosswalkCfgRot, 0.005);
    cwW.position.set(-crossInset, 0.005, 0);
    this.group.add(cwW);

    // ---- DIAGONAL SHIBUYA SCRAMBLE crosswalks across the center ----
    // The famous diagonal stripes connect opposite corners of the intersection.
    const diagLen = Math.SQRT2 * roadW * 0.85;
    const diagCfg: SlabConfig = {
      textureUrl: CROSSWALK_TEXTURE_URL,
      repeat: 1,
      tint: "#ffffff",
      rotate: true,
    };
    const diag1 = makeSlab(diagLen, crossDepth, diagCfg, 0.007);
    diag1.rotation.y = Math.PI / 4;
    diag1.position.set(0, 0.007, 0);
    this.group.add(diag1);
    const diag2 = makeSlab(diagLen, crossDepth, diagCfg, 0.007);
    diag2.rotation.y = -Math.PI / 4;
    diag2.position.set(0, 0.007, 0);
    this.group.add(diag2);
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

  /** True if a world (x, z) position falls on a sidewalk quadrant (no roads). */
  isOnSidewalk(x: number, z: number): boolean {
    const halfRoad = (ROAD_WIDTH_BLOCKS * BLOCK_SIZE) / 2;
    return Math.abs(x) > halfRoad && Math.abs(z) > halfRoad;
  }
}
