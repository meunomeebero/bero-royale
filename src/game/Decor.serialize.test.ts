import { describe, it, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";

// Decor instantiates Three.js props via ModelLibrary (loads OBJ/MTL assets) and
// soft contact shadows via Shadow (needs a DOM canvas). Neither is available in
// the node test env, so stub both: ModelLibrary.create → a bare Group; BlobShadow
// → a no-op holder. This keeps the test on the PURE bookkeeping (the items map +
// cell gates + serialize), which is what we want to verify.
vi.mock("./ModelLibrary", () => ({
  ModelLibrary: {
    create: () => ({ object: new THREE.Group(), materials: [] }),
  },
}));
vi.mock("./Shadow", () => ({
  BlobShadow: class {
    mesh = new THREE.Object3D();
    placeStatic() {}
    dispose() {}
  },
}));

import { Decor } from "./Decor";
import type { Platform } from "./Platform";

const GRID = 180;
const BLOCK_SIZE = 0.5;
const SIZE = GRID * BLOCK_SIZE; // 90 world units across

/**
 * Minimal Platform stub: a flat, all-grass arena (no hills) so every in-bounds,
 * non-edge cell is placeable — exercising only the cell-gate + bookkeeping logic.
 */
function fakePlatform(): Platform {
  const gridHalf = GRID / 2;
  const half = SIZE / 2;
  const stub = {
    blockSize: BLOCK_SIZE,
    get gridSize() {
      return GRID;
    },
    getBounds() {
      return { minX: -half, maxX: half, minZ: -half, maxZ: half };
    },
    cellInBounds(ix: number, iz: number) {
      return (
        Number.isInteger(ix) &&
        Number.isInteger(iz) &&
        ix >= 0 &&
        iz >= 0 &&
        ix < GRID &&
        iz < GRID
      );
    },
    cellCenter(ix: number, iz: number) {
      return {
        x: (ix - gridHalf + 0.5) * BLOCK_SIZE,
        z: (iz - gridHalf + 0.5) * BLOCK_SIZE,
      };
    },
    cellHeight() {
      return 0; // flat — no hills
    },
    surfaceY() {
      return BLOCK_SIZE; // topY
    },
    isOnGrass(x: number, z: number) {
      return x > -half && x < half && z > -half && z < half;
    },
  };
  return stub as unknown as Platform;
}

describe("Decor — data-driven place/delete/serialize", () => {
  let decor: Decor;

  beforeEach(() => {
    // Empty data-driven build (no scatter) so the map starts clean.
    decor = new Decor(fakePlatform(), []);
  });

  it("starts empty", () => {
    expect(decor.serialize()).toEqual([]);
    expect(decor.obstacles.length).toBe(0);
  });

  it("placeAt returns an entry and serialize contains it", () => {
    const entry = decor.placeAt("tree1", 90, 90);
    expect(entry).not.toBeNull();
    expect(entry!.asset).toBe("tree1");
    expect(entry!.ix).toBe(90);
    expect(entry!.iz).toBe(90);
    expect(entry!.id).toBeTruthy();

    const ser = decor.serialize();
    expect(ser).toHaveLength(1);
    expect(ser[0]).toEqual(entry);
    // serialize copies — no shared ref with the internal entry.
    expect(ser[0]).not.toBe(entry);

    // entryAt finds it by cell.
    expect(decor.entryAt(90, 90)?.id).toBe(entry!.id);
    // A tree registers exactly one bullet obstacle.
    expect(decor.obstacles.length).toBe(1);
  });

  it("removeAt removes the prop and empties serialize", () => {
    decor.placeAt("tree1", 90, 90);
    expect(decor.serialize()).toHaveLength(1);

    expect(decor.removeAt(90, 90)).toBe(true);
    expect(decor.serialize()).toEqual([]);
    expect(decor.entryAt(90, 90)).toBeUndefined();
    // The obstacle was spliced out by reference.
    expect(decor.obstacles.length).toBe(0);
    // Removing an empty cell is a no-op.
    expect(decor.removeAt(90, 90)).toBe(false);
  });

  it("rejects placing on an occupied cell", () => {
    expect(decor.placeAt("tree1", 50, 50)).not.toBeNull();
    expect(decor.placeAt("tree2", 50, 50)).toBeNull();
    expect(decor.serialize()).toHaveLength(1);
  });

  it("out-of-bounds placeAt returns null", () => {
    expect(decor.placeAt("tree1", 999, 1)).toBeNull();
    expect(decor.placeAt("tree1", -1, 1)).toBeNull();
    expect(decor.placeAt("tree1", 1, GRID)).toBeNull();
    expect(decor.serialize()).toEqual([]);
  });

  it("non-tree props place without a bullet obstacle", () => {
    expect(decor.placeAt("grassflower1", 30, 30)).not.toBeNull();
    expect(decor.serialize()).toHaveLength(1);
    expect(decor.obstacles.length).toBe(0); // flowers have radius 0
  });

  it("the obstacles array reference is stable across mutations", () => {
    const ref = decor.obstacles;
    decor.placeAt("tree1", 10, 10);
    decor.placeAt("tree2", 11, 11);
    decor.removeAt(10, 10);
    // Same array object the whole time (handed once to Bullets.setObstacles).
    expect(decor.obstacles).toBe(ref);
    expect(decor.obstacles.length).toBe(1);
  });

  it("data-driven constructor builds exactly the given entries and dedups by id/cell", () => {
    const built = new Decor(fakePlatform(), [
      { id: "a", asset: "tree1", ix: 20, iz: 20 },
      { id: "a", asset: "tree2", ix: 21, iz: 21 }, // dup id → skipped
      { id: "b", asset: "tree2", ix: 20, iz: 20 }, // dup cell → skipped
      { id: "c", asset: "box1", ix: 22, iz: 22 },
    ]);
    const ser = built.serialize();
    expect(ser.map((e) => e.id).sort()).toEqual(["a", "c"]);
    expect(built.entryAt(20, 20)?.id).toBe("a");
    expect(built.entryAt(22, 22)?.asset).toBe("box1");
  });
});
