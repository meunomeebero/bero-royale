import { describe, it, expect } from "vitest";
import { validateDef } from "../src/map";

/**
 * Server-side map validation — an INDEPENDENT copy of the client's
 * `validateMapDef` rules (server never imports client `src/`). Mirrors the same
 * strict-id + asset + bounds + version + shape checks. Pure logic, no disk/WS.
 * See docs/superpowers/plans/2026-06-25-map-editor.md (Task 4).
 */
describe("server map validation (validateDef)", () => {
  it("accepts a valid def", () => {
    expect(
      validateDef({ version: 1, decor: [{ id: "a", asset: "tree1", ix: 1, iz: 1 }] }),
    ).not.toBeNull();
  });

  it("accepts an empty decor list", () => {
    expect(validateDef({ version: 1, decor: [] })).toEqual({ version: 1, decor: [] });
  });

  it("rejects an unknown asset", () => {
    expect(
      validateDef({ version: 1, decor: [{ id: "a", asset: "dragon", ix: 1, iz: 1 }] }),
    ).toBeNull();
  });

  it("rejects an out-of-bounds cell (low and high)", () => {
    expect(
      validateDef({ version: 1, decor: [{ id: "a", asset: "tree1", ix: -1, iz: 1 }] }),
    ).toBeNull();
    expect(
      validateDef({ version: 1, decor: [{ id: "a", asset: "tree1", ix: 180, iz: 1 }] }),
    ).toBeNull();
    expect(
      validateDef({ version: 1, decor: [{ id: "a", asset: "tree1", ix: 1, iz: 999 }] }),
    ).toBeNull();
  });

  it("rejects a non-integer cell", () => {
    expect(
      validateDef({ version: 1, decor: [{ id: "a", asset: "tree1", ix: 1.5, iz: 1 }] }),
    ).toBeNull();
  });

  it("rejects the wrong version", () => {
    expect(validateDef({ version: 9, decor: [] })).toBeNull();
    expect(validateDef({ version: 2, decor: [] })).toBeNull();
  });

  it("rejects a non-array decor / non-object root", () => {
    expect(validateDef({ version: 1, decor: "x" })).toBeNull();
    expect(validateDef("x")).toBeNull();
    expect(validateDef(null)).toBeNull();
  });

  it("rejects a missing / non-string / empty id", () => {
    expect(
      validateDef({ version: 1, decor: [{ asset: "tree1", ix: 1, iz: 1 }] }),
    ).toBeNull();
    expect(
      validateDef({ version: 1, decor: [{ id: 7, asset: "tree1", ix: 1, iz: 1 }] }),
    ).toBeNull();
    expect(
      validateDef({ version: 1, decor: [{ id: "", asset: "tree1", ix: 1, iz: 1 }] }),
    ).toBeNull();
    expect(
      validateDef({ version: 1, decor: [{ id: "x".repeat(65), asset: "tree1", ix: 1, iz: 1 }] }),
    ).toBeNull();
  });

  it("rejects a duplicate id", () => {
    expect(
      validateDef({
        version: 1,
        decor: [
          { id: "dup", asset: "tree1", ix: 1, iz: 1 },
          { id: "dup", asset: "tree2", ix: 2, iz: 2 },
        ],
      }),
    ).toBeNull();
  });

  it("rejects a decor list over MAX_DECOR (2000)", () => {
    const tooMany = Array.from({ length: 2001 }, (_, i) => ({
      id: `d${i}`,
      asset: "tree1",
      ix: 1,
      iz: 1,
    }));
    expect(validateDef({ version: 1, decor: tooMany })).toBeNull();
  });
});
