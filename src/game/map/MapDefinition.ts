export type EnvProp =
  | "tree1" | "tree2" | "box1" | "box2"
  | "grassflower1" | "grassflower2" | "grassmushroom";
export const ENV_PROPS: EnvProp[] = ["tree1","tree2","box1","box2","grassflower1","grassflower2","grassmushroom"];
const PROP_SET = new Set<string>(ENV_PROPS);
export const GRID = 180; // Platform.PLATFORM_GRID — cells (ix,iz) in [0,GRID)
export const MAX_DECOR = 2000;

export interface DecorEntry { id: string; asset: EnvProp; ix: number; iz: number; }
export interface MapDefinition { version: 1; decor: DecorEntry[]; }
export const EMPTY_MAP: MapDefinition = { version: 1, decor: [] };

let _seq = 0;
export function makeDecorEntry(asset: EnvProp, ix: number, iz: number): DecorEntry {
  _seq = (_seq + 1) % 1e9;
  return { id: `d${Date.now().toString(36)}${_seq.toString(36)}`, asset, ix, iz };
}

export function validateMapDef(x: unknown): MapDefinition | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (o.version !== 1 || !Array.isArray(o.decor) || o.decor.length > MAX_DECOR) return null;
  const out: DecorEntry[] = [];
  const seen = new Set<string>();
  for (const e of o.decor) {
    if (!e || typeof e !== "object") return null;
    const { id, asset, ix, iz } = e as Record<string, unknown>;
    // Strict id: a unique non-empty string (deterministic across client/server/
    // reload; protects keyed render + place/delete bookkeeping).
    if (typeof id !== "string" || id.length === 0 || id.length > 64 || seen.has(id)) return null;
    if (typeof asset !== "string" || !PROP_SET.has(asset)) return null;
    if (!Number.isInteger(ix) || !Number.isInteger(iz)) return null;
    if ((ix as number) < 0 || (ix as number) >= GRID || (iz as number) < 0 || (iz as number) >= GRID) return null;
    seen.add(id);
    out.push({ id, asset: asset as EnvProp, ix: ix as number, iz: iz as number });
  }
  return { version: 1, decor: out };
}
