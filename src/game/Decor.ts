import * as THREE from "three";
import type { Platform } from "./Platform";
import { ModelLibrary } from "./ModelLibrary";
import { BlobShadow } from "./Shadow";
import { mulberry32 } from "./rng";
import type { DecorEntry, EnvProp } from "./map/MapDefinition";
import { makeDecorEntry } from "./map/MapDefinition";

export interface DecorObstacle {
  x: number;
  z: number;
  radius: number;
  topY: number;
  baseY: number;
}

type Anim = "sway" | "treesway" | "float" | null;

interface PropSpec {
  cat: "env" | "collectibles";
  name: string;
  height: number;
  /** Bullet-collision radius; 0 = no collision. */
  radius: number;
  /** Contact-shadow radius; 0 = no shadow. */
  shadow: number;
  anim: Anim;
}

const TREE1: PropSpec = { cat: "env", name: "tree1", height: 1.3, radius: 0.26, shadow: 0.52, anim: "treesway" };
const TREE2: PropSpec = { cat: "env", name: "tree2", height: 1.45, radius: 0.28, shadow: 0.56, anim: "treesway" };
const MUSHROOM: PropSpec = { cat: "env", name: "grassmushroom", height: 0.55, radius: 0, shadow: 0.3, anim: "sway" };
const FLOWER1: PropSpec = { cat: "env", name: "grassflower1", height: 0.5, radius: 0, shadow: 0.24, anim: "sway" };
const FLOWER2: PropSpec = { cat: "env", name: "grassflower2", height: 0.5, radius: 0, shadow: 0.24, anim: "sway" };
const GRASS1: PropSpec = { cat: "env", name: "grass1", height: 0.42, radius: 0, shadow: 0.2, anim: "sway" };
const GRASS2: PropSpec = { cat: "env", name: "grass2", height: 0.46, radius: 0, shadow: 0.2, anim: "sway" };
const GRASS3: PropSpec = { cat: "env", name: "grass3", height: 0.46, radius: 0, shadow: 0.2, anim: "sway" };
const BOX1: PropSpec = { cat: "env", name: "box1", height: 0.5, radius: 0, shadow: 0.3, anim: null };
const BOX2: PropSpec = { cat: "env", name: "box2", height: 0.5, radius: 0, shadow: 0.3, anim: null };

/**
 * Editor-placeable env props (the 7 `EnvProp` assets) → their `PropSpec`.
 * `placeAt` uses this so a data-driven prop renders/sizes exactly like a scattered
 * one (only trees carry a bullet obstacle). Boxes are editor-only (not scattered).
 */
const PROP_FOR_ASSET: Record<EnvProp, PropSpec> = {
  tree1: TREE1,
  tree2: TREE2,
  box1: BOX1,
  box2: BOX2,
  grassflower1: FLOWER1,
  grassflower2: FLOWER2,
  grassmushroom: MUSHROOM,
};

// On lush grass-field cells: grass/flowers/mushrooms dominate.
const FIELD_PALETTE: Array<{ weight: number; spec: PropSpec }> = [
  { weight: 16, spec: GRASS1 }, { weight: 16, spec: GRASS2 }, { weight: 16, spec: GRASS3 },
  { weight: 9, spec: FLOWER1 }, { weight: 9, spec: FLOWER2 },
  { weight: 7, spec: MUSHROOM },
];

// Everywhere else: occasional trees over a grassy meadow (no crates/clutter).
const MIXED_PALETTE: Array<{ weight: number; spec: PropSpec }> = [
  { weight: 9, spec: TREE1 }, { weight: 9, spec: TREE2 },
  { weight: 7, spec: MUSHROOM },
  { weight: 7, spec: FLOWER1 }, { weight: 7, spec: FLOWER2 },
  { weight: 9, spec: GRASS1 }, { weight: 9, spec: GRASS2 }, { weight: 9, spec: GRASS3 },
];

const FIELD_TOTAL = FIELD_PALETTE.reduce((s, p) => s + p.weight, 0);
const MIXED_TOTAL = MIXED_PALETTE.reduce((s, p) => s + p.weight, 0);

/** Edge margin (world units) every prop must keep from the arena border. */
const EDGE_MARGIN = 0.6;

interface AnimEntry {
  obj: THREE.Object3D;
  anim: Anim;
  phase: number;
  amp: number;
  speed: number;
  baseY: number;
  spin: number;
}

/**
 * One placed prop. The `Decor.items` map is the single source of truth; the
 * `group.children` and `obstacles[]` views hold the SAME object/obstacle refs
 * stored here, so a mutation through either is consistent with zero syncing.
 */
interface DecorRecord {
  entry: DecorEntry;
  object: THREE.Object3D;
  obstacle?: DecorObstacle;
  anim?: AnimEntry;
  shadow?: BlobShadow;
}

/** Place-time geometry/look for a prop, randomized just like the scatter. */
interface PlaceParams {
  height: number;
  yaw: number;
  shadowRadius: number;
}

/**
 * Scatters voxel props from the asset pack across the map and gives them life:
 * grass/flowers sway in the breeze, food collectibles bob and spin, and every
 * prop casts a soft contact shadow. Solid props (trees, crates) register bullet
 * collision.
 *
 * Data-driven: a single `items` map is the source of truth, addressable by entry
 * id and queryable by cell. `group.children` and `obstacles[]` are derived VIEWS
 * holding the same object/obstacle refs. Constructed from a `number` (seed → run
 * the legacy procedural scatter) or a `DecorEntry[]` (build exactly those, in
 * order). The editor then mutates the live world via `placeAt`/`removeAt`.
 */
export class Decor {
  readonly group: THREE.Group;
  /**
   * Live collider list handed ONCE to `Bullets.setObstacles`. The reference is
   * stable for the lifetime of this `Decor` — only ever mutated in place
   * (push/splice). NEVER reassigned, or bullet collision silently breaks.
   */
  readonly obstacles: DecorObstacle[] = [];

  private readonly platform: Platform;
  /** Source of truth: entry id → record. */
  private items = new Map<string, DecorRecord>();
  /** Fast cell → entry id lookup so placement/delete are O(1). */
  private cellToId = new Map<number, string>();
  private t = 0;

  constructor(platform: Platform, source: number | DecorEntry[] = 12345) {
    this.platform = platform;
    this.group = new THREE.Group();

    if (Array.isArray(source)) {
      this.buildFromEntries(source);
    } else {
      this.scatter(source);
    }
  }

  // ---- Data-driven build ------------------------------------------------

  /** Build exactly the given entries, in order, deduping by id and by cell. */
  private buildFromEntries(entries: DecorEntry[]) {
    for (const entry of entries) {
      if (this.items.has(entry.id)) continue;
      if (!this.platform.cellInBounds(entry.ix, entry.iz)) continue;
      if (this.cellToId.has(cellKey(entry.ix, entry.iz))) continue;
      const spec = PROP_FOR_ASSET[entry.asset];
      if (!spec) continue;
      // No seeded RNG on the data path: canonical look (full height, yaw 0).
      this.instantiate(entry, spec, {
        height: spec.height,
        yaw: 0,
        shadowRadius: spec.shadow,
      });
    }
  }

  // ---- Legacy procedural scatter ----------------------------------------

  /**
   * The original seeded scatter — placement logic is byte-for-byte identical;
   * each accepted prop is now routed through `instantiate` so the seeded and
   * data-driven paths share one creation code path.
   */
  private scatter(seed: number) {
    const platform = this.platform;
    const bounds = platform.getBounds();
    // Decor sub-stream: keep decor and terrain PRNGs disjoint so neither
    // shifts the other's draw sequence.
    const rand = mulberry32((seed ^ 0x85ebca6b) >>> 0);

    const TOTAL = 240;
    let placed = 0;
    let attempts = 0;
    while (placed < TOTAL && attempts < TOTAL * 8) {
      attempts++;
      const x = bounds.minX + rand() * (bounds.maxX - bounds.minX);
      const z = bounds.minZ + rand() * (bounds.maxZ - bounds.minZ);
      if (!platform.isOnGrass(x, z)) continue;
      if (platform.isHill(x, z)) continue;
      if (
        x < bounds.minX + EDGE_MARGIN ||
        x > bounds.maxX - EDGE_MARGIN ||
        z < bounds.minZ + EDGE_MARGIN ||
        z > bounds.maxZ - EDGE_MARGIN
      ) {
        continue;
      }

      const onField = platform.isGrassField(x, z);
      const spec = pickSpec(rand, onField);
      // RNG consumption order MUST match the original scatter exactly (height →
      // yaw → shadow-radius → anim params) so placement is byte-for-byte identical.
      const height = spec.height * (0.85 + rand() * 0.3);
      const yaw = rand() * Math.PI * 2;
      const shadowRadius = spec.shadow > 0 ? spec.shadow * (0.9 + rand() * 0.3) : 0;
      // Scattered props get an entry/id so they render through the same `instantiate`
      // path, but they are NOT cell-indexed (see instantiateAtWorld: `cellToId` is set
      // only on the data/editor path). The seeded scatter is render-only — only an
      // authored (data) map is editable/serializable.
      const entry = makeDecorEntry(spec.name as EnvProp, ...this.worldToCell(x, z));
      this.instantiateAtWorld(entry, spec, { height, yaw, shadowRadius }, x, z, rand);
      placed++;
    }
  }

  // ---- Shared instantiation ---------------------------------------------

  /**
   * Create + position a prop at its entry's CELL CENTER (surfaceY for Y), wire its
   * obstacle/sway/shadow, and store the record + both derived views. Used by the
   * data-driven build and by `placeAt` (no RNG: canonical look).
   */
  private instantiate(entry: DecorEntry, spec: PropSpec, params: PlaceParams) {
    const c = this.platform.cellCenter(entry.ix, entry.iz);
    this.instantiateAtWorld(entry, spec, params, c.x, c.z);
  }

  /**
   * Lower-level instantiate at an explicit world XZ (cell center, or a scatter
   * sample). When `rand` is provided (scatter path), the prop's animation
   * parameters are drawn from it in the ORIGINAL order so the decor PRNG stream
   * advances identically to the legacy scatter. Without it (data/editor path)
   * the animation uses deterministic, position-derived parameters.
   */
  private instantiateAtWorld(
    entry: DecorEntry,
    spec: PropSpec,
    params: PlaceParams,
    x: number,
    z: number,
    rand?: () => number,
  ) {
    const { object } = ModelLibrary.create(spec.cat, spec.name, params.height);
    const baseY = this.platform.surfaceY(x, z);
    object.position.set(x, baseY, z);
    object.rotation.y = params.yaw;
    this.group.add(object);

    const record: DecorRecord = { entry, object };

    // Square voxel contact shadow under the prop.
    if (params.shadowRadius > 0) {
      const shadow = new BlobShadow(params.shadowRadius, 0.14);
      shadow.placeStatic(x, baseY + 0.02, z);
      this.group.add(shadow.mesh);
      record.shadow = shadow;
    }

    // Only solid props (trees) carry a bullet obstacle (radius from PropSpec).
    if (spec.radius > 0) {
      const obstacle: DecorObstacle = {
        x,
        z,
        radius: spec.radius,
        baseY,
        topY: baseY + params.height,
      };
      this.obstacles.push(obstacle); // in-place push: never reassign `obstacles`
      record.obstacle = obstacle;
    }

    if (spec.anim) {
      // Consume the SAME rand() calls the original `animEntryFor(…, rand)` did,
      // in the same order, so the scatter PRNG sequence is preserved.
      record.anim = rand
        ? seededAnimEntry(spec.anim, object, baseY, rand)
        : deterministicAnimEntry(spec.anim, object, baseY);
    }

    this.items.set(entry.id, record);
    // Only the data/editor path is cell-addressable (one prop per cell). The seeded
    // scatter is render-only and may legally overlap a cell; indexing it would let a
    // later same-cell scatter prop clobber cellToId → break removeAt/serialize. The
    // scatter path passes `rand`; the data/editor path does not.
    if (!rand) this.cellToId.set(cellKey(entry.ix, entry.iz), entry.id);
  }

  // ---- Addressable place / delete (editor) ------------------------------

  /**
   * Non-mutating placement test: `true` iff `placeAt(asset,ix,iz)` would succeed
   * (known asset, in bounds, grass, flat/height-0, ≥`EDGE_MARGIN` from the edge,
   * cell free). The editor calls this to tint the placement ghost green/red
   * WITHOUT building a prop, so `placeAt` simply enforces it before mutating.
   */
  canPlaceAt(asset: EnvProp, ix: number, iz: number): boolean {
    if (!PROP_FOR_ASSET[asset]) return false;
    if (!this.platform.cellInBounds(ix, iz)) return false;
    if (this.cellToId.has(cellKey(ix, iz))) return false;
    if (this.platform.cellHeight(ix, iz) !== 0) return false;

    const c = this.platform.cellCenter(ix, iz);
    const bounds = this.platform.getBounds();
    // All in-bounds cells are grass, but keep the explicit gate for symmetry.
    if (!this.platform.isOnGrass(c.x, c.z)) return false;
    if (
      c.x < bounds.minX + EDGE_MARGIN ||
      c.x > bounds.maxX - EDGE_MARGIN ||
      c.z < bounds.minZ + EDGE_MARGIN ||
      c.z > bounds.maxZ - EDGE_MARGIN
    ) {
      return false;
    }
    return true;
  }

  /**
   * Place `asset` at cell `(ix,iz)`. Returns the new entry, or `null` if the cell
   * fails any gate (see {@link canPlaceAt}): out of bounds, a hill (height ≠ 0),
   * too near the edge, or already occupied. Same constraints the scatter obeyed.
   */
  placeAt(asset: EnvProp, ix: number, iz: number): DecorEntry | null {
    const spec = PROP_FOR_ASSET[asset];
    if (!spec) return null;
    if (!this.canPlaceAt(asset, ix, iz)) return null;

    const entry = makeDecorEntry(asset, ix, iz);
    this.instantiate(entry, spec, {
      height: spec.height,
      yaw: 0,
      shadowRadius: spec.shadow,
    });
    return entry;
  }

  /** Remove the prop at cell `(ix,iz)` (dispose its object + splice its obstacle). */
  removeAt(ix: number, iz: number): boolean {
    const key = cellKey(ix, iz);
    const id = this.cellToId.get(key);
    if (id === undefined) return false;
    const record = this.items.get(id);
    if (!record) {
      this.cellToId.delete(key);
      return false;
    }

    this.group.remove(record.object);
    disposeObject(record.object);
    if (record.shadow) {
      this.group.remove(record.shadow.mesh);
      record.shadow.dispose();
    }
    if (record.obstacle) {
      // In-place splice by reference — never reassign `this.obstacles`.
      const i = this.obstacles.indexOf(record.obstacle);
      if (i >= 0) this.obstacles.splice(i, 1);
    }

    this.items.delete(id);
    this.cellToId.delete(key);
    return true;
  }

  /** The entry occupying cell `(ix,iz)`, or `undefined`. */
  entryAt(ix: number, iz: number): DecorEntry | undefined {
    const id = this.cellToId.get(cellKey(ix, iz));
    if (id === undefined) return undefined;
    return this.items.get(id)?.entry;
  }

  /** Snapshot the current layout as plain `DecorEntry` copies (no shared refs). */
  serialize(): DecorEntry[] {
    const out: DecorEntry[] = [];
    for (const record of this.items.values()) {
      const e = record.entry;
      out.push({ id: e.id, asset: e.asset, ix: e.ix, iz: e.iz });
    }
    return out;
  }

  // ---- Per-frame animation (allocation-free) ----------------------------

  /** Breeze sway, bobbing food, spinning collectibles. */
  update(dt: number) {
    this.t += dt;
    const t = this.t;
    for (const record of this.items.values()) {
      const a = record.anim;
      if (!a) continue;
      if (a.anim === "sway" || a.anim === "treesway") {
        a.obj.rotation.z = Math.sin(t * a.speed + a.phase) * a.amp;
      } else if (a.anim === "float") {
        a.obj.position.y = a.baseY + 0.12 + Math.sin(t * 2 + a.phase) * 0.07;
        a.obj.rotation.y += dt * a.spin;
      }
    }
  }

  dispose() {
    for (const record of this.items.values()) {
      disposeObject(record.object); // per-instance materials only (geometry is shared)
      if (record.shadow) record.shadow.dispose();
    }
    this.obstacles.splice(0); // empty in place — never reassign (bullets holds the ref)
    this.items.clear();
    this.cellToId.clear();
  }

  // ---- Cell helpers -----------------------------------------------------

  /** World XZ → containing cell (inverse of `Platform.cellCenter`). */
  private worldToCell(x: number, z: number): [number, number] {
    const gridHalf = this.platform.gridSize / 2;
    const ix = Math.floor(x / this.platform.blockSize + gridHalf);
    const iz = Math.floor(z / this.platform.blockSize + gridHalf);
    return [ix, iz];
  }
}

/** Pack cell `(ix,iz)` into one number key (ix,iz ∈ [0,180)). */
function cellKey(ix: number, iz: number): number {
  return ix * 1000 + iz;
}

/** Recursively dispose a prop's per-instance cloned materials.
 *  IMPORTANT: do NOT dispose geometry — `ModelLibrary.create` does `tmpl.clone(true)`,
 *  which SHARES the template's BufferGeometry across every instance of that asset.
 *  Disposing it here would break all other (and future) instances of the same prop.
 *  Only the materials are per-instance clones (ModelLibrary clones them) and safe to free. */
function disposeObject(obj: THREE.Object3D) {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material;
    if (Array.isArray(mat)) {
      for (const m of mat) m.dispose();
    } else if (mat) {
      mat.dispose();
    }
  });
}

/**
 * Original seeded animation parameters — consumes `rand` in the SAME order as the
 * legacy `animEntryFor` so the scatter PRNG sequence (and thus every subsequent
 * prop's placement) is byte-for-byte identical.
 */
function seededAnimEntry(
  anim: Anim,
  obj: THREE.Object3D,
  baseY: number,
  rand: () => number,
): AnimEntry {
  const phase = rand() * Math.PI * 2;
  if (anim === "treesway") {
    return { obj, anim, phase, amp: 0.04, speed: 0.9 + rand() * 0.3, baseY, spin: 0 };
  }
  if (anim === "float") {
    return { obj, anim, phase, amp: 0, speed: 2, baseY, spin: 0.8 + rand() * 0.9 };
  }
  // sway (grass / flowers / mushrooms)
  return { obj, anim, phase, amp: 0.1 + rand() * 0.06, speed: 1.4 + rand() * 0.8, baseY, spin: 0 };
}

/**
 * Deterministic animation parameters for data-driven / editor-placed props: a
 * stable per-position phase (no RNG to thread) with the palette's mid-range
 * amplitude/speed. Allocation-free.
 */
function deterministicAnimEntry(anim: Anim, obj: THREE.Object3D, baseY: number): AnimEntry {
  const phase = pseudoPhase(obj.position.x, obj.position.z);
  if (anim === "treesway") {
    return { obj, anim, phase, amp: 0.04, speed: 1.05, baseY, spin: 0 };
  }
  if (anim === "float") {
    return { obj, anim, phase, amp: 0, speed: 2, baseY, spin: 1.25 };
  }
  // sway (grass / flowers / mushrooms)
  return { obj, anim, phase, amp: 0.13, speed: 1.8, baseY, spin: 0 };
}

/** Stable, allocation-free pseudo-phase in [0, 2π) from position. */
function pseudoPhase(x: number, z: number): number {
  const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return (v - Math.floor(v)) * Math.PI * 2;
}

function pickSpec(rand: () => number, onField: boolean): PropSpec {
  const palette = onField ? FIELD_PALETTE : MIXED_PALETTE;
  const total = onField ? FIELD_TOTAL : MIXED_TOTAL;
  let roll = rand() * total;
  for (const entry of palette) {
    roll -= entry.weight;
    if (roll <= 0) return entry.spec;
  }
  return palette[0].spec;
}
