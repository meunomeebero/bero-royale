import * as THREE from "three";
import { getBlockKits } from "./TextureFactory";

const PLATFORM_GRID = 80;
const BLOCK_SIZE = 0.5;
const BLOCK_HEIGHT = 0.5;
const SIZE = PLATFORM_GRID * BLOCK_SIZE;

const LAVA_DEPTH_BLOCKS = 2;
const UNDER_LAYERS = 3;

// Number of one-block-tall hills scattered on the map
const NUM_HILLS = 18;
// Number of lava pits
const NUM_PITS = 10;

export type TileKind = "grass" | "lava";

interface Cell {
  ix: number;
  iz: number;
  /** Surface height in BLOCKS above the base (0 = base level, 1 = one bump). */
  height: number;
  kind: TileKind;
}

/**
 * Rural night forest grid: a sea of bluish-green grass tiles with optional
 * one-block hills you can hop on, and recessed lava pits.
 */
export class Platform {
  readonly group: THREE.Group;
  readonly topY: number; // base surface Y (height = 0)
  readonly size: number;
  readonly blockSize = BLOCK_SIZE;

  private cells: Cell[][] = [];

  constructor() {
    this.group = new THREE.Group();
    this.size = SIZE;
    this.topY = BLOCK_HEIGHT;

    this.buildBaseGrid();
    this.carveHills();
    this.carveLavaPits();
    this.buildSurfaceMeshes();
    this.buildHillMeshes();
    this.buildUnderLayers();
    this.buildLavaMeshes();
  }

  // ---- Grid construction ------------------------------------------------

  private buildBaseGrid() {
    for (let ix = 0; ix < PLATFORM_GRID; ix++) {
      const row: Cell[] = [];
      for (let iz = 0; iz < PLATFORM_GRID; iz++) {
        row.push({ ix, iz, height: 0, kind: "grass" });
      }
      this.cells.push(row);
    }
  }

  private carveHills() {
    const rand = () => Math.random();
    const gridHalf = PLATFORM_GRID / 2;
    let placed = 0;
    let tries = 0;
    while (placed < NUM_HILLS && tries++ < NUM_HILLS * 20) {
      const cx = Math.floor((rand() * 2 - 1) * (gridHalf - 4));
      const cz = Math.floor((rand() * 2 - 1) * (gridHalf - 4));
      // Hill radius 1..3 blocks (small bumps)
      const radius = 1 + Math.floor(rand() * 3);
      // Don't make a hill if any covered cell is already raised
      let ok = true;
      for (let dx = -radius; dx <= radius && ok; dx++) {
        for (let dz = -radius; dz <= radius && ok; dz++) {
          if (dx * dx + dz * dz > radius * radius) continue;
          const ix = cx + dx + gridHalf;
          const iz = cz + dz + gridHalf;
          if (
            ix < 1 ||
            iz < 1 ||
            ix >= PLATFORM_GRID - 1 ||
            iz >= PLATFORM_GRID - 1
          ) {
            ok = false;
            break;
          }
          if (this.cells[ix][iz].height > 0) {
            ok = false;
            break;
          }
        }
      }
      if (!ok) continue;
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          if (dx * dx + dz * dz > radius * radius) continue;
          const ix = cx + dx + gridHalf;
          const iz = cz + dz + gridHalf;
          this.cells[ix][iz].height = 1; // one block up
        }
      }
      placed++;
    }
  }

  private carveLavaPits() {
    const rand = () => Math.random();
    const gridHalf = PLATFORM_GRID / 2;
    const pits: Array<[number, number]> = [];
    for (let i = 0; i < NUM_PITS; i++) {
      let tries = 0;
      while (tries++ < 30) {
        const cx = Math.floor((rand() * 2 - 1) * (gridHalf - 4));
        const cz = Math.floor((rand() * 2 - 1) * (gridHalf - 4));
        let tooClose = false;
        for (const [px, pz] of pits) {
          if ((cx - px) ** 2 + (cz - pz) ** 2 < 40) {
            tooClose = true;
            break;
          }
        }
        if (tooClose) continue;
        const radius = 1 + Math.floor(rand() * 2);
        let valid = true;
        for (let dx = -radius; dx <= radius && valid; dx++) {
          for (let dz = -radius; dz <= radius && valid; dz++) {
            if (dx * dx + dz * dz > radius * radius) continue;
            const ix = cx + dx + gridHalf;
            const iz = cz + dz + gridHalf;
            if (
              ix < 1 ||
              iz < 1 ||
              ix >= PLATFORM_GRID - 1 ||
              iz >= PLATFORM_GRID - 1
            ) {
              valid = false;
              break;
            }
            // Don't put lava on a hill (would look weird with elevated rim)
            if (this.cells[ix][iz].height > 0) {
              valid = false;
              break;
            }
          }
        }
        if (!valid) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          for (let dz = -radius; dz <= radius; dz++) {
            if (dx * dx + dz * dz > radius * radius) continue;
            const ix = cx + dx + gridHalf;
            const iz = cz + dz + gridHalf;
            this.cells[ix][iz].kind = "lava";
          }
        }
        pits.push([cx, cz]);
        break;
      }
    }
  }

  // ---- Mesh building ----------------------------------------------------

  private buildSurfaceMeshes() {
    const kits = getBlockKits();
    const gridHalf = PLATFORM_GRID / 2;
    const surfaceY = BLOCK_HEIGHT / 2;

    const cells: Array<[number, number]> = [];
    for (let ix = 0; ix < PLATFORM_GRID; ix++) {
      for (let iz = 0; iz < PLATFORM_GRID; iz++) {
        const c = this.cells[ix][iz];
        if (c.kind === "lava") continue;
        if (c.height > 0) continue; // hill cubes handled separately
        cells.push([ix, iz]);
      }
    }
    if (cells.length === 0) return;

    const geom = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_HEIGHT, BLOCK_SIZE);
    const inst = new THREE.InstancedMesh(
      geom,
      kits.grass.materials,
      cells.length,
    );
    const dummy = new THREE.Object3D();
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

  private buildHillMeshes() {
    // Each hill cell needs TWO grass cubes stacked? No -- the base is already
    // built at height 0; we just add an extra cube on top (height 1).
    // To keep things simple we render a *single* grass cube at the hill height
    // (no base needed because the surface mesh already skips hill cells, so we
    // place TWO cubes: one base (dirt-like) + one grass top).
    const kits = getBlockKits();
    const gridHalf = PLATFORM_GRID / 2;
    const hillCells: Array<[number, number]> = [];
    for (let ix = 0; ix < PLATFORM_GRID; ix++) {
      for (let iz = 0; iz < PLATFORM_GRID; iz++) {
        if (this.cells[ix][iz].height > 0 && this.cells[ix][iz].kind === "grass") {
          hillCells.push([ix, iz]);
        }
      }
    }
    if (hillCells.length === 0) return;

    const geom = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_HEIGHT, BLOCK_SIZE);
    const dummy = new THREE.Object3D();

    // Base (dirt) cube at the original surface level
    const base = new THREE.InstancedMesh(
      geom,
      kits.dirt.materials,
      hillCells.length,
    );
    hillCells.forEach(([ix, iz], i) => {
      const x = (ix - gridHalf + 0.5) * BLOCK_SIZE;
      const z = (iz - gridHalf + 0.5) * BLOCK_SIZE;
      dummy.position.set(x, BLOCK_HEIGHT / 2, z);
      dummy.updateMatrix();
      base.setMatrixAt(i, dummy.matrix);
    });
    base.instanceMatrix.needsUpdate = true;
    this.group.add(base);

    // Grass top cube at +1 block
    const top = new THREE.InstancedMesh(
      geom,
      kits.grass.materials,
      hillCells.length,
    );
    hillCells.forEach(([ix, iz], i) => {
      const x = (ix - gridHalf + 0.5) * BLOCK_SIZE;
      const z = (iz - gridHalf + 0.5) * BLOCK_SIZE;
      dummy.position.set(x, BLOCK_HEIGHT / 2 + BLOCK_HEIGHT, z);
      dummy.updateMatrix();
      top.setMatrixAt(i, dummy.matrix);
    });
    top.instanceMatrix.needsUpdate = true;
    this.group.add(top);
  }

  private buildUnderLayers() {
    const kits = getBlockKits();
    const gridHalf = PLATFORM_GRID / 2;
    const geom = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_HEIGHT, BLOCK_SIZE);

    for (let layer = 0; layer < UNDER_LAYERS; layer++) {
      const y = -BLOCK_HEIGHT / 2 - layer * BLOCK_HEIGHT;
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
    const kits = getBlockKits();
    const gridHalf = PLATFORM_GRID / 2;
    const geom = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_HEIGHT, BLOCK_SIZE);
    const lavaCells: Array<[number, number]> = [];
    for (let ix = 0; ix < PLATFORM_GRID; ix++) {
      for (let iz = 0; iz < PLATFORM_GRID; iz++) {
        if (this.cells[ix][iz].kind === "lava") {
          lavaCells.push([ix, iz]);
        }
      }
    }
    if (lavaCells.length === 0) return;

    for (let layer = 0; layer < LAVA_DEPTH_BLOCKS; layer++) {
      const y = -BLOCK_HEIGHT / 2 - layer * BLOCK_HEIGHT;
      const mats = layer === 0 ? kits.lava.materials : kits.lavaRock.materials;
      const inst = new THREE.InstancedMesh(geom, mats, lavaCells.length);
      const dummy = new THREE.Object3D();
      lavaCells.forEach(([ix, iz], i) => {
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

  private cellAt(x: number, z: number): Cell | null {
    const gridHalf = PLATFORM_GRID / 2;
    const ix = Math.floor(x / BLOCK_SIZE + gridHalf);
    const iz = Math.floor(z / BLOCK_SIZE + gridHalf);
    if (ix < 0 || iz < 0 || ix >= PLATFORM_GRID || iz >= PLATFORM_GRID) {
      return null;
    }
    return this.cells[ix][iz];
  }

  /**
   * Surface height at (x,z) in WORLD units (top face Y of the topmost block).
   * For lava cells, returns the lava SURFACE Y (which is below base topY).
   */
  surfaceY(x: number, z: number): number {
    const c = this.cellAt(x, z);
    if (!c) return this.topY;
    if (c.kind === "lava") {
      // Lava surface is one block below base topY
      return this.topY - BLOCK_HEIGHT;
    }
    return this.topY + c.height * BLOCK_HEIGHT;
  }

  isLavaAt(x: number, z: number): boolean {
    const c = this.cellAt(x, z);
    return c?.kind === "lava";
  }

  /** Treat all non-lava tiles as "walkable grass" for decor placement. */
  isOnGrass(x: number, z: number): boolean {
    const c = this.cellAt(x, z);
    return !!c && c.kind === "grass";
  }

  /** Returns true if there is a one-block hill at (x,z). */
  isHill(x: number, z: number): boolean {
    const c = this.cellAt(x, z);
    return !!c && c.height > 0;
  }

  /**
   * Solid-block test used by bullets: returns true if (x,y,z) is inside a
   * raised hill cube (a 1-block-tall obstacle above ground level).
   */
  blocksAt(x: number, y: number, z: number): boolean {
    const c = this.cellAt(x, z);
    if (!c) return false;
    if (c.height <= 0) return false;
    // Hill cube spans from this.topY up to this.topY + c.height * BLOCK_HEIGHT
    const minY = this.topY;
    const maxY = this.topY + c.height * BLOCK_HEIGHT;
    return y >= minY && y <= maxY;
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
      return new THREE.Vector3(x, this.surfaceY(x, z) + 0.25, z);
    }
    return new THREE.Vector3(0, this.topY + 0.25, 0);
  }

  /** Back-compat: keeping the old name for places that used to check sidewalks. */
  isOnSidewalk(x: number, z: number): boolean {
    return this.isOnGrass(x, z) && !this.isHill(x, z);
  }
}
