import * as THREE from "three";

const PLATFORM_GRID = 80;
const BLOCK_SIZE = 0.5;
const BLOCK_HEIGHT = 0.5; // full cubes for Minecraft vibe
const SIZE = PLATFORM_GRID * BLOCK_SIZE; // 40 units across

// Width of the avenues (in blocks). Roads run through the middle of the map
// forming a giant "+" (cross) with a Shibuya-style scramble crossing.
const ROAD_WIDTH_BLOCKS = 16;

// Lava cubes are sunk this many cubes below the surface; player falls in.
const LAVA_DEPTH_BLOCKS = 2;

const ASPHALT_TEXTURE_URL =
  "https://grazia-prod.oss-ap-southeast-1.aliyuncs.com/resources/uid_100032862/asphalt_moss_tile_d5e9cb5e.png";
const SIDEWALK_TEXTURE_URL =
  "https://grazia-prod.oss-ap-southeast-1.aliyuncs.com/resources/uid_100032862/sidewalk_tile_bf7c93b8.png";
const CROSSWALK_TEXTURE_URL =
  "https://grazia-prod.oss-ap-southeast-1.aliyuncs.com/resources/uid_100032862/crosswalk_tile_9c610974.png";

export type TileKind =
  | "sidewalk"
  | "asphalt"
  | "crosswalk_h"
  | "crosswalk_v"
  | "lava";

interface LavaCell {
  ix: number;
  iz: number;
}

function loadTopTexture(url: string, rotate = false): THREE.Texture {
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin("anonymous");
  const tex = loader.load(url);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipMapLinearFilter;
  if (rotate) {
    tex.center.set(0.5, 0.5);
    tex.rotation = Math.PI / 2;
  }
  return tex;
}

function makeCubeMaterials(
  topUrl: string,
  tint: string,
  sideColor: string,
  rotate = false,
): THREE.Material[] {
  const tex = loadTopTexture(topUrl, rotate);
  const tintCol = new THREE.Color(tint);
  const topMat = new THREE.MeshLambertMaterial({
    map: tex,
    color: tintCol,
  });
  const sideMat = new THREE.MeshLambertMaterial({
    color: new THREE.Color(sideColor),
  });
  // BoxGeometry face order: +X, -X, +Y, -Y, +Z, -Z
  return [sideMat, sideMat, topMat, sideMat, sideMat, sideMat];
}

export class Platform {
  readonly group: THREE.Group;
  readonly topY: number;
  readonly size: number;
  readonly blockSize = BLOCK_SIZE;

  /** ix,iz -> tile kind for the topmost surface (lava cells return "lava"). */
  private tileMap: TileKind[][] = [];
  private lavaCells: LavaCell[] = [];

  constructor() {
    this.group = new THREE.Group();
    this.size = SIZE;
    // Surface cubes are centered at y = BLOCK_HEIGHT/2, so their top face
    // sits at y = BLOCK_HEIGHT. `topY` is the world Y where actors stand on.
    this.topY = BLOCK_HEIGHT;
    // Build the logical grid first (so we know which cubes are roads, etc.)
    this.buildTileMap();
    // Carve some lava pits + a winding lava river BEFORE meshing
    this.carveLava();
    // Build instanced meshes
    this.buildSurfaceMeshes();
    this.buildEdgeAndUnderMeshes();
    this.buildLavaMeshes();
  }

  // ---- Grid construction ------------------------------------------------

  private buildTileMap() {
    const halfRoad = ROAD_WIDTH_BLOCKS / 2; // in BLOCKS, from center
    const gridHalf = PLATFORM_GRID / 2;
    const crossInsetBlocks = 4; // crosswalk band thickness in blocks
    // Diagonal scramble crosswalks band thickness (blocks) along the diagonal
    const diagBand = 3;

    for (let ix = 0; ix < PLATFORM_GRID; ix++) {
      const row: TileKind[] = [];
      // World-grid relative coords (center is 0,0)
      const gx = ix - gridHalf + 0.5;
      for (let iz = 0; iz < PLATFORM_GRID; iz++) {
        const gz = iz - gridHalf + 0.5;
        const onRoadX = Math.abs(gx) < halfRoad;
        const onRoadZ = Math.abs(gz) < halfRoad;

        let kind: TileKind;
        if (onRoadX && onRoadZ) {
          // Central intersection -- check for diagonal scramble crosswalks
          // Diagonal 1: gx ~ gz
          // Diagonal 2: gx ~ -gz
          const onDiag1 = Math.abs(gx - gz) < diagBand;
          const onDiag2 = Math.abs(gx + gz) < diagBand;
          if (onDiag1 || onDiag2) {
            // Treat diagonals as crosswalk_h (the stripe direction is good enough at this zoom)
            kind = "crosswalk_h";
          } else {
            kind = "asphalt";
          }
        } else if (onRoadX) {
          // Vertical road strip -- check if this is one of the N/S crosswalks
          // (within crossInsetBlocks just outside the intersection)
          const distFromCenter = Math.abs(gz) - halfRoad;
          if (distFromCenter >= 0 && distFromCenter < crossInsetBlocks) {
            kind = "crosswalk_h"; // stripes run perpendicular to N/S walking direction
          } else {
            kind = "asphalt";
          }
        } else if (onRoadZ) {
          const distFromCenter = Math.abs(gx) - halfRoad;
          if (distFromCenter >= 0 && distFromCenter < crossInsetBlocks) {
            kind = "crosswalk_v";
          } else {
            kind = "asphalt";
          }
        } else {
          kind = "sidewalk";
        }
        row.push(kind);
      }
      this.tileMap.push(row);
    }
  }

  private carveLava() {
    // Deterministic-ish pseudo random; seed-free is fine because re-running
    // gives a fresh map every page load (player loves variety).
    const rand = () => Math.random();

    // 1) River: winding diagonal band of lava cubes ~3 blocks wide
    const halfRoad = ROAD_WIDTH_BLOCKS / 2;
    const gridHalf = PLATFORM_GRID / 2;
    let rx = -gridHalf + 4;
    let rz = -gridHalf * 0.7;
    let angle = Math.PI * 0.2;
    const STEPS = 90;
    for (let s = 0; s < STEPS; s++) {
      const cx = Math.round(rx);
      const cz = Math.round(rz);
      // Carve a 3-wide segment perpendicular to direction
      for (let w = -1; w <= 1; w++) {
        const nx = Math.round(cx + Math.sin(angle) * w);
        const nz = Math.round(cz - Math.cos(angle) * w);
        this.markLava(nx + gridHalf, nz + gridHalf, halfRoad);
      }
      rx += Math.cos(angle) * 1.0;
      rz += Math.sin(angle) * 1.0;
      angle += (rand() - 0.5) * 0.45;
      if (Math.abs(rx) > gridHalf - 2 || Math.abs(rz) > gridHalf - 2) break;
    }

    // 2) Scattered round pits
    const NUM_PITS = 14;
    const pits: Array<[number, number]> = [];
    for (let i = 0; i < NUM_PITS; i++) {
      let tries = 0;
      while (tries++ < 30) {
        const cx = Math.floor((rand() * 2 - 1) * (gridHalf - 4));
        const cz = Math.floor((rand() * 2 - 1) * (gridHalf - 4));
        // Don't drop pits right on the central intersection
        if (Math.abs(cx) < halfRoad + 2 && Math.abs(cz) < halfRoad + 2) {
          continue;
        }
        // Keep pits apart
        let tooClose = false;
        for (const [px, pz] of pits) {
          if ((cx - px) ** 2 + (cz - pz) ** 2 < 36) {
            tooClose = true;
            break;
          }
        }
        if (tooClose) continue;
        const radius = 1 + Math.floor(rand() * 2); // 1..2 blocks
        for (let dx = -radius; dx <= radius; dx++) {
          for (let dz = -radius; dz <= radius; dz++) {
            if (dx * dx + dz * dz <= radius * radius) {
              this.markLava(cx + dx + gridHalf, cz + dz + gridHalf, halfRoad);
            }
          }
        }
        pits.push([cx, cz]);
        break;
      }
    }
  }

  private markLava(ix: number, iz: number, halfRoadBlocks: number) {
    if (
      ix < 0 ||
      iz < 0 ||
      ix >= PLATFORM_GRID ||
      iz >= PLATFORM_GRID
    ) {
      return;
    }
    // Don't carve lava on the central intersection (keep it walkable always)
    const gridHalf = PLATFORM_GRID / 2;
    const gx = ix - gridHalf + 0.5;
    const gz = iz - gridHalf + 0.5;
    if (Math.abs(gx) < halfRoadBlocks && Math.abs(gz) < halfRoadBlocks) {
      return;
    }
    if (this.tileMap[ix][iz] === "lava") return;
    this.tileMap[ix][iz] = "lava";
    this.lavaCells.push({ ix, iz });
  }

  // ---- Mesh building ----------------------------------------------------

  private buildSurfaceMeshes() {
    const gridHalf = PLATFORM_GRID / 2;
    const surfaceY = BLOCK_HEIGHT / 2;

    // Collect indices per tile kind
    const groups: Partial<Record<TileKind, Array<[number, number]>>> = {
      sidewalk: [],
      asphalt: [],
      crosswalk_h: [],
      crosswalk_v: [],
    };
    for (let ix = 0; ix < PLATFORM_GRID; ix++) {
      for (let iz = 0; iz < PLATFORM_GRID; iz++) {
        const kind = this.tileMap[ix][iz];
        if (kind === "lava") continue;
        groups[kind]!.push([ix, iz]);
      }
    }

    const geom = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_HEIGHT, BLOCK_SIZE);

    const styles: Record<
      Exclude<TileKind, "lava">,
      { mats: THREE.Material[] }
    > = {
      sidewalk: {
        mats: makeCubeMaterials(
          SIDEWALK_TEXTURE_URL,
          "#c4c8cf",
          "#1c1c28",
        ),
      },
      asphalt: {
        mats: makeCubeMaterials(
          ASPHALT_TEXTURE_URL,
          "#8a8e94",
          "#15151c",
        ),
      },
      crosswalk_h: {
        mats: makeCubeMaterials(
          CROSSWALK_TEXTURE_URL,
          "#ffffff",
          "#15151c",
        ),
      },
      crosswalk_v: {
        mats: makeCubeMaterials(
          CROSSWALK_TEXTURE_URL,
          "#ffffff",
          "#15151c",
          true,
        ),
      },
    };

    const dummy = new THREE.Object3D();
    for (const k of Object.keys(groups) as Array<Exclude<TileKind, "lava">>) {
      const cells = groups[k]!;
      if (cells.length === 0) continue;
      const inst = new THREE.InstancedMesh(geom, styles[k].mats, cells.length);
      cells.forEach(([ix, iz], i) => {
        const x = (ix - gridHalf + 0.5) * BLOCK_SIZE;
        const z = (iz - gridHalf + 0.5) * BLOCK_SIZE;
        dummy.position.set(x, surfaceY, z);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      });
      inst.instanceMatrix.needsUpdate = true;
      this.group.add(inst);
    }
  }

  private buildEdgeAndUnderMeshes() {
    // A second layer of dark "earth/rock" cubes UNDER the surface, exposed at
    // the platform borders. This gives the floating-island Minecraft vibe.
    const UNDER_LAYERS = 2;
    const gridHalf = PLATFORM_GRID / 2;
    const geom = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_HEIGHT, BLOCK_SIZE);
    const dirtMat = new THREE.MeshLambertMaterial({
      color: new THREE.Color("#2a2230"),
    });
    const rockMat = new THREE.MeshLambertMaterial({
      color: new THREE.Color("#1a1622"),
    });

    // To keep the count reasonable, only render the OUTER 2-cube rim of each
    // under-layer (the player can never see the inside). Plus a single
    // border row at the platform top edge so corners look chunky.
    for (let layer = 0; layer < UNDER_LAYERS; layer++) {
      const y = -BLOCK_HEIGHT / 2 - layer * BLOCK_HEIGHT;
      const mat = layer === 0 ? dirtMat : rockMat;
      const cells: Array<[number, number]> = [];
      for (let ix = 0; ix < PLATFORM_GRID; ix++) {
        for (let iz = 0; iz < PLATFORM_GRID; iz++) {
          // Only outer 2-cell ring
          if (
            ix > 1 &&
            ix < PLATFORM_GRID - 2 &&
            iz > 1 &&
            iz < PLATFORM_GRID - 2
          ) {
            continue;
          }
          cells.push([ix, iz]);
        }
      }
      const inst = new THREE.InstancedMesh(geom, mat, cells.length);
      const dummy = new THREE.Object3D();
      cells.forEach(([ix, iz], i) => {
        const x = (ix - gridHalf + 0.5) * BLOCK_SIZE;
        const z = (iz - gridHalf + 0.5) * BLOCK_SIZE;
        dummy.position.set(x, y, z);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      });
      inst.instanceMatrix.needsUpdate = true;
      this.group.add(inst);
    }
  }

  private buildLavaMeshes() {
    if (this.lavaCells.length === 0) return;
    const gridHalf = PLATFORM_GRID / 2;
    const geom = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_HEIGHT, BLOCK_SIZE);

    // Bright glowing lava material
    const lavaMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color("#ff5a16"),
    });
    const lavaDarkMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color("#7a1a05"),
    });

    // We place LAVA_DEPTH_BLOCKS layers of cubes BELOW the surface so the pit
    // has visible glowing walls; the top layer uses the bright color, lower
    // layers use the darker one.
    for (let layer = 0; layer < LAVA_DEPTH_BLOCKS; layer++) {
      const y = -BLOCK_HEIGHT / 2 - layer * BLOCK_HEIGHT;
      const mat = layer === 0 ? lavaMat : lavaDarkMat;
      const inst = new THREE.InstancedMesh(
        geom,
        mat,
        this.lavaCells.length,
      );
      const dummy = new THREE.Object3D();
      this.lavaCells.forEach(({ ix, iz }, i) => {
        const x = (ix - gridHalf + 0.5) * BLOCK_SIZE;
        const z = (iz - gridHalf + 0.5) * BLOCK_SIZE;
        dummy.position.set(x, y, z);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      });
      inst.instanceMatrix.needsUpdate = true;
      this.group.add(inst);
    }

    // Add a subtle "rim" of glowing cubes just at the surface level around
    // each pit so the pit edges glow (like Minecraft lava block emitters).
    const rimMat = new THREE.MeshLambertMaterial({
      color: new THREE.Color("#ff3a08"),
      emissive: new THREE.Color("#ff3a08"),
      emissiveIntensity: 0.7,
    });
    // Find boundary cells (those that have at least one non-lava neighbor)
    const boundaryCells: Array<[number, number]> = [];
    for (const { ix, iz } of this.lavaCells) {
      const neighbors = [
        [ix - 1, iz],
        [ix + 1, iz],
        [ix, iz - 1],
        [ix, iz + 1],
      ];
      for (const [nx, nz] of neighbors) {
        if (
          nx >= 0 &&
          nz >= 0 &&
          nx < PLATFORM_GRID &&
          nz < PLATFORM_GRID &&
          this.tileMap[nx][nz] !== "lava"
        ) {
          boundaryCells.push([ix, iz]);
          break;
        }
      }
    }
    if (boundaryCells.length > 0) {
      const rimInst = new THREE.InstancedMesh(
        new THREE.BoxGeometry(BLOCK_SIZE, 0.08, BLOCK_SIZE),
        rimMat,
        boundaryCells.length,
      );
      const dummy = new THREE.Object3D();
      boundaryCells.forEach(([ix, iz], i) => {
        const x = (ix - gridHalf + 0.5) * BLOCK_SIZE;
        const z = (iz - gridHalf + 0.5) * BLOCK_SIZE;
        // Place rim just slightly above the surface so it's a glowing "lip"
        dummy.position.set(x, BLOCK_HEIGHT / 2 + 0.04, z);
        dummy.updateMatrix();
        rimInst.setMatrixAt(i, dummy.matrix);
      });
      rimInst.instanceMatrix.needsUpdate = true;
      this.group.add(rimInst);
    }
  }

  // ---- Public query API -------------------------------------------------

  getBounds() {
    const half = this.size / 2;
    return { minX: -half, maxX: half, minZ: -half, maxZ: half };
  }

  /** Return the tile kind at a world (x,z) position, or null if off-map. */
  tileAt(x: number, z: number): TileKind | null {
    const gridHalf = PLATFORM_GRID / 2;
    const ix = Math.floor(x / BLOCK_SIZE + gridHalf);
    const iz = Math.floor(z / BLOCK_SIZE + gridHalf);
    if (ix < 0 || iz < 0 || ix >= PLATFORM_GRID || iz >= PLATFORM_GRID) {
      return null;
    }
    return this.tileMap[ix][iz];
  }

  /** True if (x,z) is over a lava tile. */
  isLavaAt(x: number, z: number): boolean {
    return this.tileAt(x, z) === "lava";
  }

  /** Random spawn that AVOIDS lava (and stays away from edges + the lava river). */
  randomSpawn(margin = 4): THREE.Vector3 {
    const half = this.size / 2 - margin;
    for (let tries = 0; tries < 60; tries++) {
      const x = (Math.random() * 2 - 1) * half;
      const z = (Math.random() * 2 - 1) * half;
      if (this.isLavaAt(x, z)) continue;
      // Also check a small ring around (avoid touching lava edge)
      let nearLava = false;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (this.isLavaAt(x + dx * BLOCK_SIZE, z + dz * BLOCK_SIZE)) {
            nearLava = true;
            break;
          }
        }
        if (nearLava) break;
      }
      if (nearLava) continue;
      return new THREE.Vector3(x, this.topY + 0.25, z);
    }
    // Fallback: spawn at the center intersection (never lava)
    return new THREE.Vector3(0, this.topY + 0.25, 0);
  }

  /** True if a world (x, z) position falls on a sidewalk cell. */
  isOnSidewalk(x: number, z: number): boolean {
    return this.tileAt(x, z) === "sidewalk";
  }
}
