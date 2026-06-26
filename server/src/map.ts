import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { MAP_EDITOR_PASSWORD } from "./env";

/**
 * Server-side map store + editor handlers for the (v1, decor-only) map editor.
 *
 * The active map is a single JSON file under `server/public/maps/active.json`.
 * Validation here is an INDEPENDENT server-side copy of the client's
 * `validateMapDef` rules (see `src/game/map/MapDefinition.ts`) — by design we do
 * NOT import client `src/` into the server; the wire shape is agreed by
 * convention and re-checked here so a bad/oversized/forged body is rejected.
 *
 * The password (`MAP_EDITOR_PASSWORD`) is checked SERVER-SIDE on every write; the
 * client gate is cosmetic.
 */

/** The 7 editable env props — the only assets a decor entry may reference. */
const ENV_PROPS = [
  "tree1",
  "tree2",
  "box1",
  "box2",
  "grassflower1",
  "grassflower2",
  "grassmushroom",
] as const;
const PROP_SET = new Set<string>(ENV_PROPS);

/** `Platform.PLATFORM_GRID` — cells `(ix,iz)` live in `[0, GRID)`. */
const GRID = 180;
/** Hard cap on authored decor (matches client `MAX_DECOR`). */
const MAX_DECOR = 2000;

/** A single placed prop, addressable by its unique `id`. */
export interface DecorEntry {
  id: string;
  asset: string;
  ix: number;
  iz: number;
}
/** The serializable active map (decor list only in v1). */
export interface MapDef {
  version: 1;
  decor: DecorEntry[];
}

/**
 * Independent, strict server-side validation — a copy of the client's
 * `validateMapDef` rules (NOT an import). Returns a normalized `MapDef` or `null`
 * on ANY violation:
 *   - `version === 1`
 *   - `decor` is an array of length `≤ MAX_DECOR`
 *   - each entry has a UNIQUE, NON-EMPTY, STRING `id`
 *   - `asset` is one of the 7 env props
 *   - `ix`/`iz` are integers in `[0, GRID)`
 */
export function validateDef(x: unknown): MapDef | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (o.version !== 1 || !Array.isArray(o.decor) || o.decor.length > MAX_DECOR) {
    return null;
  }
  const out: DecorEntry[] = [];
  const seen = new Set<string>();
  for (const e of o.decor) {
    if (!e || typeof e !== "object") return null;
    const { id, asset, ix, iz } = e as Record<string, unknown>;
    // Strict id: a unique non-empty string ≤64 chars (protects keyed render +
    // place/delete + bounds the persisted/broadcast payload size).
    if (typeof id !== "string" || id.length === 0 || id.length > 64 || seen.has(id)) return null;
    if (typeof asset !== "string" || !PROP_SET.has(asset)) return null;
    if (!Number.isInteger(ix) || !Number.isInteger(iz)) return null;
    if (
      (ix as number) < 0 ||
      (ix as number) >= GRID ||
      (iz as number) < 0 ||
      (iz as number) >= GRID
    ) {
      return null;
    }
    seen.add(id);
    out.push({ id, asset, ix: ix as number, iz: iz as number });
  }
  return { version: 1, decor: out };
}

// ESM has no `__dirname`; derive it from the module URL (same pattern as env.ts).
const __dirname = dirname(fileURLToPath(import.meta.url));
/** Absolute path of the single active-map file, served from `server/public`. */
const ACTIVE_MAP_PATH = join(__dirname, "../public/maps/active.json");

/**
 * Read the persisted active map, or `null` when the file is missing or the JSON
 * is unparseable/invalid. A present-but-invalid file is treated as "no map" (the
 * game falls back to the seeded scatter) rather than crashing.
 */
export async function readActiveMap(): Promise<MapDef | null> {
  let text: string;
  try {
    text = await readFile(ACTIVE_MAP_PATH, "utf8");
  } catch {
    return null; // missing file → no active map
  }
  try {
    return validateDef(JSON.parse(text));
  } catch {
    return null; // unparseable → no active map
  }
}

/** Persist `def` as the active map, creating the `maps/` directory if needed. */
export async function writeActiveMap(def: MapDef): Promise<void> {
  await mkdir(dirname(ACTIVE_MAP_PATH), { recursive: true });
  await writeFile(ACTIVE_MAP_PATH, JSON.stringify(def), "utf8");
}

/**
 * In-memory copy of the active map, kept hot so rooms (Task 6) can read the decor
 * list on join without a disk hit. Refreshed on a successful PUT and seeded at
 * boot via {@link initMapCache}.
 */
export let activeMapCache: MapDef | null = null;

/** Seed {@link activeMapCache} from disk at startup. Call once during boot. */
export async function initMapCache(): Promise<void> {
  activeMapCache = await readActiveMap();
}

/** A handler outcome the route layer maps onto `set.status` + the JSON body. */
export interface HandlerResult {
  status: number;
  body: unknown;
}

/**
 * POST /api/editor/auth — cosmetic-gate check. Returns 200 `{ok:true}` iff the
 * JSON body's `password` matches {@link MAP_EDITOR_PASSWORD}, else 401.
 */
export function authHandler(body: unknown): HandlerResult {
  const password = (body as { password?: unknown } | null)?.password;
  if (password === MAP_EDITOR_PASSWORD) {
    return { status: 200, body: { ok: true } };
  }
  return { status: 401, body: { ok: false } };
}

/** GET /api/map — the active map (or `null`). Always 200 `{def}`. */
export async function getMapHandler(): Promise<HandlerResult> {
  return { status: 200, body: { def: await readActiveMap() } };
}

/**
 * PUT /api/map — replace the active map. 401 unless header
 * `x-editor-password` matches; 400 when `body.def` fails {@link validateDef};
 * else persists, refreshes {@link activeMapCache}, and returns 200 `{ok:true}`.
 */
export async function putMapHandler(
  headerPassword: string | undefined,
  body: unknown,
): Promise<HandlerResult> {
  if (headerPassword !== MAP_EDITOR_PASSWORD) {
    return { status: 401, body: { ok: false } };
  }
  const def = validateDef((body as { def?: unknown } | null)?.def);
  if (!def) {
    return { status: 400, body: { ok: false, error: "invalid map" } };
  }
  await writeActiveMap(def);
  activeMapCache = def;
  return { status: 200, body: { ok: true } };
}
