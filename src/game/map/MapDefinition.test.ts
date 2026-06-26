import { describe, it, expect } from "vitest";
import { validateMapDef, makeDecorEntry, EMPTY_MAP, ENV_PROPS } from "./MapDefinition";

describe("MapDefinition", () => {
  it("accepts a valid def and round-trips through JSON", () => {
    const def = { version: 1, decor: [makeDecorEntry("tree1", 90, 90)] };
    const parsed = validateMapDef(JSON.parse(JSON.stringify(def)));
    expect(parsed).not.toBeNull();
    expect(parsed!.decor[0].asset).toBe("tree1");
    expect(parsed!.decor[0].id).toBeTruthy();
  });
  it("EMPTY_MAP is valid and has no decor", () => {
    expect(validateMapDef(EMPTY_MAP)?.decor).toEqual([]);
  });
  it("rejects unknown asset, out-of-bounds cell, wrong version, non-array", () => {
    expect(validateMapDef({ version: 1, decor: [{ id: "a", asset: "dragon", ix: 1, iz: 1 }] })).toBeNull();
    expect(validateMapDef({ version: 1, decor: [{ id: "a", asset: "tree1", ix: 999, iz: 1 }] })).toBeNull();
    expect(validateMapDef({ version: 2, decor: [] })).toBeNull();
    expect(validateMapDef({ version: 1, decor: "x" })).toBeNull();
    expect(validateMapDef(null)).toBeNull();
  });
  it("ENV_PROPS lists exactly the 7 editable props", () => {
    expect(ENV_PROPS).toEqual(["tree1","tree2","box1","box2","grassflower1","grassflower2","grassmushroom"]);
  });
  it("rejects a missing/empty/non-string id (strict, deterministic)", () => {
    expect(validateMapDef({ version: 1, decor: [{ asset: "tree1", ix: 1, iz: 1 }] })).toBeNull();
    expect(validateMapDef({ version: 1, decor: [{ id: "", asset: "tree1", ix: 1, iz: 1 }] })).toBeNull();
    expect(validateMapDef({ version: 1, decor: [{ id: 5, asset: "tree1", ix: 1, iz: 1 }] })).toBeNull();
    expect(validateMapDef({ version: 1, decor: [{ id: "x".repeat(65), asset: "tree1", ix: 1, iz: 1 }] })).toBeNull();
  });
  it("rejects duplicate ids", () => {
    expect(validateMapDef({ version: 1, decor: [
      { id: "x", asset: "tree1", ix: 1, iz: 1 },
      { id: "x", asset: "tree2", ix: 2, iz: 2 },
    ] })).toBeNull();
  });
});
