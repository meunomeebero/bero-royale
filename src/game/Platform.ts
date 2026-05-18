import * as THREE from "three";
import { getBlockKits } from "./TextureFactory";

const PLATFORM_GRID = 80;
const BLOCK_SIZE = 0.5;
const BLOCK_HEIGHT = 0.5; // full cubes (Minecraft vibe)
const SIZE = PLATFORM_GRID * BLOCK_SIZE; // 40 units across

// Width of the avenues (in blocks). Roads run through the middle of the map
// forming a giant "+" (cross) with a Shibuya-style scramble crossing.
const ROAD_WIDTH_BLOCKS = 16;

// Lava cubes are sunk this many cubes below the surface; player falls in.
const LAVA_DEPTH_BLOCKS = 2;
// Earth layers exposed at the platform border
const UNDER_LAYERS = 3;

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

/**
 * The world is built like a Minecraft chunk: 80x80 grid of cubes, each face
 * gets its own pixel-art texture (top vs side vs bottom). Lava is recessed
 * to form real voxel-shaped pits.
 */
export class Platform {
  readonly group: THREE.Group;
  readonly topY: number;
  readonly size: number;
  readonly blockSize = BLOCK_SIZE;

  private tileMap: TileKind[][] = [];
  private lavaCells: LavaCell[] = [];

  constructor() {
    this.group = new THREE.Group();
    this.size = SIZE;
    // Surface block center is at +BLOCK_HEIGHT/2, top face sits at +BLOCK_HEIGHT.
    this.topY = BLOCK_HEIGHT;

    this.buildTileMap();
    this.carveLava();
    this.buildSurfaceMeshes();
    this.buildUnderLayers();
    this.buildLavaMeshes();
  }

  // ---- Grid construction ------------------------------------------------

  private buildTileMap() {
    const halfRoad = ROAD_WIDTH_BLOCKS / 2;
    const gridHalf = PLATFORM_GRID / 2;
    const crossInsetBlocks = 4;
    const diagBand = 3;

    for (let ix = 0; ix < PLATFORM_GRID; ix++) {
      const row: TileKind[] = [];
      const gx = ix - gridHalf + 0.5;
      for (let iz = 0; iz < PLATFORM_GRID; iz++) {
        const gz = iz - gridHalf + 0.5;
        const onRoadX = Math.abs(gx) < halfRoad;
        const onRoadZ = Math.abs(gz) < halfRoad;

        let kind: TileKind;
        if (onRoadX && onRoadZ) {
          const onDiag1 = Math.abs(gx - gz) < diagBand;
          const onDiag2 = Math.abs(gx + gz) < diagBand;
          kind = onDiag1 || onDiag2 ? "crosswalk_h" : "asphalt";
        } else if (onRoadX) {
          const distFromCenter = Math.abs(gz) - halfRoad;
          kind =
            distFromCenter >= 0 && distFromCenter < crossInsetBlocks
              ? "crosswalk_h"
              : "asphalt";
        } else if (onRoadZ) {
          const distFromCenter = Math.abs(gx) - halfRoad;
          kind =
            distFromCenter >= 0 && distFromCenter < crossInsetBlocks
              ? "crosswalk_v"
              : "asphalt";
        } else {
          kind = "sidewalk";
        }
        row.push(kind);
      }
      this.tileMap.push(row);
    }
  }

  private carveLava() {
    const rand = () => Math.random();
    const halfRoad = ROAD_WIDTH_BLOCKS / 2;
    const gridHalf = PLATFORM_GRID / 2;

    // 1) Winding river of lava (3 blocks wide)
    let rx = -gridHalf + 4;
    let rz = -gridHalf * 0.7;
    let angle = Math.PI * 0.2;
    const STEPS = 90;
    for (let s = 0; s < STEPS; s++) {
      const cx = Math.round(rx);
      const cz = Math.round(rz);
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

    // 2) Round pits
    const NUM_PITS = 14;
    const pits: Array<[number, number]> = [];
    for (let i = 0; i < NUM_PITS; i++) {
      let tries = 0;
      while (tries++ < 30) {
        const cx = Math.floor((rand() * 2 - 1) * (gridHalf - 4));
        const cz = Math.floor((rand() * 2 - 1) * (gridHalf - 4));
        if (Math.abs(cx) < halfRoad + 2 && Math.abs(cz) < halfRoad + 2) {
          continue;
        }
        let tooClose = false;
        for (const [px, pz] of pits) {
          if ((cx - px) ** 2 + (cz - pz) ** 2 < 36) {
            tooClose = true;
            break;
          }
        }
        if (tooClose) continue;
        const radius = 1 + Math.floor(rand() * 2);
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
    if (ix < 0 || iz < 0 || ix >= PLATFORM_GRID || iz >= PLATFORM_GRID) return;
    const gridHalf = PLATFORM_GRID / 2;
    const gx = ix - gridHalf + 0.5;
    const gz = iz - gridHalf + 0.5;
    if (Math.abs(gx) < halfRoadBlocks && Math.abs(gz) < halfRoadBlocks) return;
    if (this.tileMap[ix][iz] === "lava") return;
    this.tileMap[ix][iz] = "lava";
    this.lavaCells.push({ ix, iz });
  }

  // ---- Mesh building ----------------------------------------------------

  private buildSurfaceMeshes() {
    const kits = getBlockKits();
    const gridHalf = PLATFORM_GRID / 2;
    const surfaceY = BLOCK_HEIGHT / 2;

    const groups: Record<Exclude<TileKind, "lava">, Array<[number, number]>> = {
      sidewalk: [],
      asphalt: [],
      crosswalk_h: [],
      crosswalk_v: [],
    };
    for (let ix = 0; ix < PLATFORM_GRID; ix++) {
      for (let iz = 0; iz < PLATFORM_GRID; iz++) {
        const kind = this.tileMap[ix][iz];
        if (kind === "lava") continue;
        groups[kind].push([ix, iz]);
      }
    }

    const kitMap: Record<Exclude<TileKind, "lava">, THREE.Material[]> = {
      sidewalk: kits.sidewalk.materials,
      asphalt: kits.asphalt.materials,
      crosswalk_h: kits.crosswalkH.materials,
      crosswalk_v: kits.crosswalkV.materials,
    };

    const geom = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_HEIGHT, BLOCK_SIZE);
    const dummy = new THREE.Object3D();

    for (const k of Object.keys(groups) as Array<Exclude<TileKind, "lava">>) {
      const cells = groups[k];
      if (cells.length === 0) continue;
      const inst = new THREE.InstancedMesh(geom, kitMap[k], cells.length);
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

  private buildUnderLayers() {
    // Cubes BELOW the surface, exposed at the platform border so the floating
    // island shows its earth/stone undersides. Only the outer 2-cell ring is
    // rendered per layer (the inside is invisible from any camera angle).
    const kits = getBlockKits();
    const gridHalf = PLATFORM_GRID / 2;
    const geom = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_HEIGHT, BLOCK_SIZE);

    for (let layer = 0; layer < UNDER_LAYERS; layer++) {
      const y = -BLOCK_HEIGHT / 2 - layer * BLOCK_HEIGHT;
      // Top under-layer = dirt, lower ones = stone
      const mats = layer === 0 ? kits.dirt.materials : kits.stone.materials;
      const cells: Array<[number, number]> = [];
      for (let ix = 0; ix < PLATFORM_GRID; ix++) {
        for (let iz = 0; iz < PLATFORM_GRID; iz++) {
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
      const inst = new THREE.InstancedMesh(geom, mats, cells.length);
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
    const kits = getBlockKits();
    const gridHalf = PLATFORM_GRID / 2;
    const geom = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_HEIGHT, BLOCK_SIZE);

    // Layer 0 = bright lava cubes recessed just below surface (top face visible
    // from above, glowing). Lower layers = darker cooled rock.
    for (let layer = 0; layer < LAVA_DEPTH_BLOCKS; layer++) {
      const y = -BLOCK_HEIGHT / 2 - layer * BLOCK_HEIGHT;
      const mats =
        layer === 0 ? kits.lava.materials : kits.lavaRock.materials;
      const inst = new THREE.InstancedMesh(geom, mats, this.lavaCells.length);
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
  }

  // ---- Public query API -------------------------------------------------

  getBounds() {
    const half = this.size / 2;
    return { minX: -half, maxX: half, minZ: -half, maxZ: half };
  }

  tileAt(x: number, z: number): TileKind | null {
    const gridHalf = PLATFORM_GRID / 2;
    const ix = Math.floor(x / BLOCK_SIZE + gridHalf);
    const iz = Math.floor(z / BLOCK_SIZE + gridHalf);
    if (ix < 0 || iz < 0 || ix >= PLATFORM_GRID || iz >= PLATFORM_GRID) {
      return null;
    }
    return this.tileMap[ix][iz];
  }

  isLavaAt(x: number, z: number): boolean {
    return this.tileAt(x, z) === "lava";
  }

  randomSpawn(margin = 4): THREE.Vector3 {
    const half = this.size / 2 - margin;
    for (let tries = 0; tries < 60; tries++) {
      const x = (Math.random() * 2 - 1) * half;
      const z = (Math.random() * 2 - 1) * half;
      if (this.isLavaAt(x, z)) continue;
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
    return new THREE.Vector3(0, this.topY + 0.25, 0);
  }

  isOnSidewalk(x: number, z: number): boolean {
    return this.tileAt(x, z) === "sidewalk";
  }
}
