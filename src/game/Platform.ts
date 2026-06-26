import * as THREE from "three";
import { ModelLibrary } from "./ModelLibrary";
import { mulberry32 } from "./rng";

const PLATFORM_GRID = 180; // +50% bigger arena (was 120 → 90 world units wide)
const BLOCK_SIZE = 0.5;
const BLOCK_HEIGHT = 0.5;
const SIZE = PLATFORM_GRID * BLOCK_SIZE;

const UNDER_LAYERS = 3;

// Number of one-block-tall hills scattered on the map (scaled with the area)
const NUM_HILLS = 57;
// Number of lush grass-field patches carpeting the ground
const NUM_FIELDS = 30;

// Pack env tiles: bare ground + grassy variants (tufts on top).
const GROUND_TILE = "nograss";
const GRASS_TILES = ["grass1", "grass2", "grass3"] as const;

export type TileKind = "grass";

interface Cell {
  ix: number;
  iz: number;
  /** Surface height in BLOCKS above the base (0 = base level, 1 = one bump). */
  height: number;
  /** 0 = bare ground, 1..3 = grass-field variant. */
  field: number;
}

interface Tile {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshLambertMaterial;
}

/**
 * Rural candy-meadow grid: a big sea of pastel ground tiles with lush
 * grass-field patches, one-block hills you can hop on, and grassy hilltops.
 */
export class Platform {
  readonly group: THREE.Group;
  readonly topY: number; // base surface Y (height = 0)
  readonly size: number;
  readonly blockSize = BLOCK_SIZE;

  private cells: Cell[][] = [];
  private bareTile: Tile;
  private grassTiles: Tile[];

  /** Terrain layout PRNG (hills + grass fields). Deterministic from seed. */
  private terrainRng: () => number;
  /** Spawn PRNG — separate sub-stream so respawns never perturb terrain. */
  private spawnRng: () => number;

  constructor(seed: number = 12345) {
    this.group = new THREE.Group();
    this.size = SIZE;
    this.topY = BLOCK_HEIGHT;

    this.terrainRng = mulberry32(seed);
    this.spawnRng = mulberry32((seed ^ 0x9e3779b9) >>> 0);

    this.bareTile = ModelLibrary.bakeTile(GROUND_TILE);
    this.grassTiles = GRASS_TILES.map((n) => ModelLibrary.bakeTile(n));

    this.buildBaseGrid();
    this.carveHills();
    this.carveGrassFields();
    this.buildSurfaceMeshes();
    this.buildHillMeshes();
    this.buildUnderLayers();
  }

  // ---- Grid construction ------------------------------------------------

  private buildBaseGrid() {
    for (let ix = 0; ix < PLATFORM_GRID; ix++) {
      const row: Cell[] = [];
      for (let iz = 0; iz < PLATFORM_GRID; iz++) {
        row.push({ ix, iz, height: 0, field: 0 });
      }
      this.cells.push(row);
    }
  }

  private carveHills() {
    const rand = this.terrainRng;
    const gridHalf = PLATFORM_GRID / 2;
    let placed = 0;
    let tries = 0;
    while (placed < NUM_HILLS && tries++ < NUM_HILLS * 20) {
      const cx = Math.floor((rand() * 2 - 1) * (gridHalf - 4));
      const cz = Math.floor((rand() * 2 - 1) * (gridHalf - 4));
      const radius = 1 + Math.floor(rand() * 3);
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
          this.cells[ix][iz].height = 1;
        }
      }
      placed++;
    }
  }

  private carveGrassFields() {
    const rand = this.terrainRng;
    const gridHalf = PLATFORM_GRID / 2;
    let placed = 0;
    let tries = 0;
    while (placed < NUM_FIELDS && tries++ < NUM_FIELDS * 30) {
      const cx = Math.floor((rand() * 2 - 1) * (gridHalf - 6));
      const cz = Math.floor((rand() * 2 - 1) * (gridHalf - 6));
      const radius = 3 + Math.floor(rand() * 6);
      const variant = 1 + Math.floor(rand() * GRASS_TILES.length);
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          const d2 = dx * dx + dz * dz;
          if (d2 > radius * radius) continue;
          const ix = cx + dx + gridHalf;
          const iz = cz + dz + gridHalf;
          if (ix < 0 || iz < 0 || ix >= PLATFORM_GRID || iz >= PLATFORM_GRID) {
            continue;
          }
          // soft, organic edge
          if (d2 > (radius - 1) * (radius - 1) && rand() < 0.5) continue;
          this.cells[ix][iz].field = variant;
        }
      }
      placed++;
    }
  }

  // ---- Mesh building ----------------------------------------------------

  /**
   * Instance a baked tile across a set of cells. The baked tile has its base at
   * y=0 and footprint 1, so we scale by BLOCK_SIZE and sit the base at `baseY`
   * (tile top lands at baseY + BLOCK_HEIGHT).
   */
  private addTileLayer(tile: Tile, cells: Array<[number, number]>, baseY: number) {
    if (cells.length === 0) return;
    const gridHalf = PLATFORM_GRID / 2;
    const inst = new THREE.InstancedMesh(
      tile.geometry,
      tile.material,
      cells.length,
    );
    const dummy = new THREE.Object3D();
    cells.forEach(([ix, iz], i) => {
      const x = (ix - gridHalf + 0.5) * BLOCK_SIZE;
      const z = (iz - gridHalf + 0.5) * BLOCK_SIZE;
      dummy.position.set(x, baseY, z);
      dummy.scale.setScalar(BLOCK_SIZE);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    });
    inst.instanceMatrix.needsUpdate = true;
    this.group.add(inst);
  }

  private buildSurfaceMeshes() {
    const bare: Array<[number, number]> = [];
    const grass: Array<Array<[number, number]>> = this.grassTiles.map(() => []);
    for (let ix = 0; ix < PLATFORM_GRID; ix++) {
      for (let iz = 0; iz < PLATFORM_GRID; iz++) {
        const c = this.cells[ix][iz];
        if (c.height > 0) continue; // hill cubes handled separately
        if (c.field > 0) grass[c.field - 1].push([ix, iz]);
        else bare.push([ix, iz]);
      }
    }
    this.addTileLayer(this.bareTile, bare, 0);
    grass.forEach((cells, i) => this.addTileLayer(this.grassTiles[i], cells, 0));
  }

  private buildHillMeshes() {
    const hillCells: Array<[number, number]> = [];
    for (let ix = 0; ix < PLATFORM_GRID; ix++) {
      for (let iz = 0; iz < PLATFORM_GRID; iz++) {
        if (this.cells[ix][iz].height > 0) hillCells.push([ix, iz]);
      }
    }
    if (hillCells.length === 0) return;

    // Bare base block at the original surface level...
    this.addTileLayer(this.bareTile, hillCells, 0);
    // ...with a grassy top one block up (variety by position).
    const buckets: Array<Array<[number, number]>> = this.grassTiles.map(() => []);
    for (const [ix, iz] of hillCells) {
      buckets[(ix + iz) % this.grassTiles.length].push([ix, iz]);
    }
    buckets.forEach((cells, i) =>
      this.addTileLayer(this.grassTiles[i], cells, BLOCK_HEIGHT),
    );
  }

  private buildUnderLayers() {
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
    // Cliff sides at the world edge: stack the pack ground tile downward so the
    // border depth matches the surface instead of showing bare dirt/stone.
    for (let layer = 0; layer < UNDER_LAYERS; layer++) {
      this.addTileLayer(this.bareTile, cells, -BLOCK_HEIGHT * (layer + 1));
    }
  }

  // ---- Public query API -------------------------------------------------

  getBounds() {
    const half = this.size / 2;
    return { minX: -half, maxX: half, minZ: -half, maxZ: half };
  }

  /** Total cells per axis — grid is `gridSize²`, cells `(ix,iz) ∈ [0, gridSize)`. */
  get gridSize(): number {
    return PLATFORM_GRID;
  }

  /**
   * World-space center (XZ) of cell `(ix,iz)` — the canonical cell→world mapping
   * (mirrors `addTileLayer`). Y is omitted; callers use `surfaceY` for the prop base.
   */
  cellCenter(ix: number, iz: number): { x: number; z: number } {
    const gridHalf = PLATFORM_GRID / 2;
    return {
      x: (ix - gridHalf + 0.5) * BLOCK_SIZE,
      z: (iz - gridHalf + 0.5) * BLOCK_SIZE,
    };
  }

  /** True if `(ix,iz)` is a valid integer cell inside the grid. */
  cellInBounds(ix: number, iz: number): boolean {
    return (
      Number.isInteger(ix) &&
      Number.isInteger(iz) &&
      ix >= 0 &&
      iz >= 0 &&
      ix < PLATFORM_GRID &&
      iz < PLATFORM_GRID
    );
  }

  /** Surface height in BLOCKS at cell `(ix,iz)` (0 = base, 1 = one hill bump). */
  cellHeight(ix: number, iz: number): number {
    if (!this.cellInBounds(ix, iz)) return 0;
    return this.cells[ix][iz].height;
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

  /** Surface height at (x,z) in WORLD units (top face Y of the topmost block). */
  surfaceY(x: number, z: number): number {
    const c = this.cellAt(x, z);
    if (!c) return this.topY;
    return this.topY + c.height * BLOCK_HEIGHT;
  }

  /** No lava in the candy meadow — kept for callers that still ask. */
  isLavaAt(_x: number, _z: number): boolean {
    return false;
  }

  /** All in-bounds tiles are walkable grass now. */
  isOnGrass(x: number, z: number): boolean {
    return !!this.cellAt(x, z);
  }

  /** True if this cell is part of a lush grass-field patch. */
  isGrassField(x: number, z: number): boolean {
    const c = this.cellAt(x, z);
    return !!c && c.field > 0;
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
    const minY = this.topY;
    const maxY = this.topY + c.height * BLOCK_HEIGHT;
    return y >= minY && y <= maxY;
  }

  randomSpawn(margin = 4): THREE.Vector3 {
    const half = this.size / 2 - margin;
    const x = (this.spawnRng() * 2 - 1) * half;
    const z = (this.spawnRng() * 2 - 1) * half;
    return new THREE.Vector3(x, this.surfaceY(x, z) + 0.25, z);
  }

  /** Back-compat: keeping the old name for places that used to check sidewalks. */
  isOnSidewalk(x: number, z: number): boolean {
    return this.isOnGrass(x, z) && !this.isHill(x, z);
  }
}
