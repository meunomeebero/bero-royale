# Map Editor (v1, decor-only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A password-gated `/editor` route where the super-user places/deletes trees & decor on an overhead view and saves a single official map that replaces the procedural scatter for everyone.

**Architecture:** Introduce a tiny serializable `MapDefinition` (decor list only). `Decor` becomes data-driven (build the saved list instead of scattering; addressable by id for place/delete). The server persists the active map to a JSON file behind a server-side password check, and the room hands the decor list to clients on join (terrain stays seeded as today). The editor is a lightweight Three.js overhead canvas (NOT the full game) reusing `ModelLibrary` + `buildWorld`.

**Tech Stack:** Vite + React + TS + Three.js (client); Node + Elysia-over-raw-http + `ws` + `postgres.js` (server); Vitest (tests).

## Global Constraints
- Package manager: `corepack pnpm ...` (pnpm not on PATH). Client typecheck `corepack pnpm exec tsc -p tsconfig.app.json --noEmit`; server `corepack pnpm -C server exec tsc --noEmit`; lint `corepack pnpm exec eslint`; tests `corepack pnpm exec vitest run`; build `corepack pnpm build:prod` + `corepack pnpm build:server`.
- No new runtime deps. Three.js, react-router already present.
- Arena bounds unchanged (`Platform`: grid 180², cells `(ix,iz)∈[0,180)`, `BLOCK_SIZE=0.5`, world ±45). Decor cells must be on grass, `height===0`, ≥0.6 from edges (the gates `Decor` already uses).
- Wire shape is JSON; client and server agree on the shape by convention (server validates independently — do NOT import client `src/` types into `server/`).
- Password for now: `29981721`, checked **server-side** on every write; the client gate is cosmetic.
- Editable assets (env props): `tree1, tree2, box1, box2, grassflower1, grassflower2, grassmushroom`.
- Snap-to-grid; no per-prop rotation in v1 (yaw 0).
- Empty/missing map ⇒ today's seeded scatter (zero regression).

---

### Task 1: `MapDefinition` type + validation (client)

**Files:**
- Create: `src/game/map/MapDefinition.ts`
- Test: `src/game/map/MapDefinition.test.ts`

**Interfaces:**
- Produces: `EnvProp` (union), `ENV_PROPS: EnvProp[]`, `DecorEntry = {id:string; asset:EnvProp; ix:number; iz:number}`, `MapDefinition = {version:1; decor:DecorEntry[]}`, `EMPTY_MAP: MapDefinition`, `makeDecorEntry(asset,ix,iz): DecorEntry`, `validateMapDef(x:unknown): MapDefinition | null`, `MAX_DECOR=2000`.

- [ ] **Step 1: Write failing tests** — `src/game/map/MapDefinition.test.ts`:
```ts
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
});
```

- [ ] **Step 2: Run test, verify FAIL**
Run: `corepack pnpm exec vitest run src/game/map/MapDefinition.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `src/game/map/MapDefinition.ts`:
```ts
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
  for (const e of o.decor) {
    if (!e || typeof e !== "object") return null;
    const { id, asset, ix, iz } = e as Record<string, unknown>;
    if (typeof asset !== "string" || !PROP_SET.has(asset)) return null;
    if (!Number.isInteger(ix) || !Number.isInteger(iz)) return null;
    if ((ix as number) < 0 || (ix as number) >= GRID || (iz as number) < 0 || (iz as number) >= GRID) return null;
    out.push({ id: typeof id === "string" && id ? id : makeDecorEntry(asset as EnvProp, ix as number, iz as number).id, asset: asset as EnvProp, ix: ix as number, iz: iz as number });
  }
  return { version: 1, decor: out };
}
```

- [ ] **Step 4: Run test, verify PASS** — `corepack pnpm exec vitest run src/game/map/MapDefinition.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add src/game/map/MapDefinition.ts src/game/map/MapDefinition.test.ts && git commit -m "feat(map): MapDefinition schema + validation (editor v1)"`

---

### Task 2: `Decor` data-driven + addressable place/delete

**Files:**
- Modify: `src/game/Decor.ts` (constructor; add place/remove/serialize; addressable id-map)
- Read first: `src/game/Decor.ts` (current scatter loop + 4 parallel arrays), `src/game/ModelLibrary.ts` (`create("env", name, height)`), `src/game/Platform.ts` (`cellAt`, `surfaceY`, grid→world mapping).
- Test: `src/game/Decor.serialize.test.ts` (pure id/serialize logic only — see note)

**Interfaces:**
- Consumes: `DecorEntry`, `EnvProp` from Task 1; `ModelLibrary.create`, `Platform`.
- Produces (on `Decor`): constructor `new Decor(platform, seedOrDecor)` where the 2nd arg is `number` (seeded scatter, unchanged) OR `DecorEntry[]` (build exactly these); `placeAt(asset: EnvProp, ix: number, iz: number): DecorEntry | null` (null if cell invalid/occupied); `removeAt(ix: number, iz: number): boolean`; `entryAt(ix:number,iz:number): DecorEntry | undefined`; `serialize(): DecorEntry[]`; `obstacles` array stays the live collider list.

**Note on testing:** `Decor` instantiates Three.js objects via `ModelLibrary` (loads OBJ assets) — not unit-testable in Vitest. TDD only the pure bookkeeping by keeping the id→entry `Map` + `serialize()` independent of the meshes; the test below drives that via a thin path. Visual/collision behavior is verified manually in Tasks 5–7.

- [ ] **Step 1: Implement the data-driven constructor + APIs.** Refactor `Decor` so a single private `items: Map<string, { entry: DecorEntry; object: THREE.Object3D; obstacle?: Obstacle; anim?: …; shadow?: … }>` is the source of truth; rebuild `this.obstacles` from `items` on every mutation. Constructor: if 2nd arg is an array, loop it calling an internal `instantiate(entry)`; else run the existing scatter, pushing each placed prop through `instantiate` (so both paths share one code path). `placeAt`: gate cell (grass, height 0, in-bounds, not occupied) → `makeDecorEntry` → `instantiate` → return entry. `removeAt`: find item by cell, dispose its object + drop from `items` + rebuild obstacles. `serialize`: `[...items.values()].map(i => i.entry)`.
  - Keep cell↔world mapping consistent with `Platform` (cell center world XZ; `surfaceY` for Y). Only `tree1/tree2` get an obstacle (radius from `PropSpec`); others radius 0.

- [ ] **Step 2: Write the pure serialize/place/remove test** — `src/game/Decor.serialize.test.ts`. Mock `ModelLibrary.create` to return a bare `new THREE.Group()` (no asset load) and pass a `Platform` stub exposing `cellAt`/`surfaceY`/grass check; assert: `placeAt("tree1",90,90)` returns an entry and `serialize()` contains it; `removeAt(90,90)` returns true and empties `serialize()`; placing on an out-of-bounds cell returns null. (If mocking `ModelLibrary` proves heavy, extract the cell-gate + id bookkeeping into a pure `DecorModel` class and test that directly.)

- [ ] **Step 3: Run test, verify PASS** — `corepack pnpm exec vitest run src/game/Decor.serialize.test.ts`.

- [ ] **Step 4: Verify the seeded fallback is unchanged** — `corepack pnpm exec tsc -p tsconfig.app.json --noEmit` clean; `corepack pnpm dev` → local game still shows the same scattered decor (no `decor` arg path). Manual check.

- [ ] **Step 5: Commit** — `git commit -am "feat(map): data-driven Decor with addressable place/delete + serialize"`

---

### Task 3: `buildWorld` extraction (shared by game + editor)

**Files:**
- Create: `src/game/map/buildWorld.ts`
- Modify: `src/game/Game.ts:511-611` (`buildWorld`/world section) to call it.

**Interfaces:**
- Produces: `buildWorld(scene: THREE.Scene, opts: { seed: number; decor?: DecorEntry[] }): { platform: Platform; decor: Decor }` — constructs `Platform(seed)` + `Decor(platform, opts.decor ?? seed)`, adds their meshes to `scene`, returns them. Game wires `bullets.setObstacles(decor.obstacles)` from the result (unchanged behavior).

- [ ] **Step 1: Implement `buildWorld.ts`** — move the `new Platform(seed)` + `new Decor(...)` + scene-add lines out of `Game` into this function; `Game.buildWorld` becomes a thin call that keeps the existing post-build wiring (obstacles, etc.).
- [ ] **Step 2: Verify** — tsc clean; `corepack pnpm dev` → game world identical. Manual.
- [ ] **Step 3: Commit** — `git commit -am "refactor(map): extract buildWorld so game + editor share world construction"`

---

### Task 4: Server — password env + file persistence + handlers

**Files:**
- Modify: `server/src/env.ts` (add `MAP_EDITOR_PASSWORD`)
- Create: `server/src/map.ts` (file store + 3 handlers + independent validation)
- Test: `server/test/map.test.ts`
- Read first: `server/src/leaderboard.ts` (handler shape), `server/src/index.ts:50-65` (route registration), `server/src/static.ts` (where `server/public` is served).

**Interfaces:**
- Produces: `validateDef(x:unknown): {version:1; decor:Array<{id:string;asset:string;ix:number;iz:number}>} | null` (server-side copy of Task 1's rules — do NOT import client src), `readActiveMap(): Promise<MapDef|null>`, `writeActiveMap(def): Promise<void>` (writes `server/public/maps/active.json`, mkdir -p), `authHandler(req)`, `getMapHandler()`, `putMapHandler(req)`; password check `req.headers["x-editor-password"] === MAP_EDITOR_PASSWORD`.

- [ ] **Step 1: Write failing tests** — `server/test/map.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { validateDef } from "../src/map";
describe("server map validation", () => {
  it("accepts a valid def", () => {
    expect(validateDef({ version: 1, decor: [{ id: "a", asset: "tree1", ix: 1, iz: 1 }] })).not.toBeNull();
  });
  it("rejects bad asset / bounds / version / shape", () => {
    expect(validateDef({ version: 1, decor: [{ id:"a", asset: "dragon", ix:1, iz:1 }] })).toBeNull();
    expect(validateDef({ version: 1, decor: [{ id:"a", asset: "tree1", ix:-1, iz:1 }] })).toBeNull();
    expect(validateDef({ version: 9, decor: [] })).toBeNull();
    expect(validateDef("x")).toBeNull();
  });
});
```
- [ ] **Step 2: Run, verify FAIL** — `corepack pnpm -C server exec vitest run test/map.test.ts` (add a vitest config to `server/` if absent, mirroring root `vitest.config.ts`).
- [ ] **Step 3: Implement `server/src/map.ts`** — `validateDef` (same rules as Task 1, copied), `readActiveMap`/`writeActiveMap` against `path.join(__dirname,"../public/maps/active.json")` with `fs/promises` + `mkdir({recursive:true})`. Handlers return `Response`/JSON in the project's handler style (read `leaderboard.ts`): `authHandler` → 200 `{ok:true}` iff body.password === `MAP_EDITOR_PASSWORD` else 401; `getMapHandler` → 200 `{def: await readActiveMap()}`; `putMapHandler` → 401 if header password wrong, 400 if `validateDef` null, else write + 200 `{ok:true}` + refresh the in-memory cache used by rooms (Task 6).
- [ ] **Step 4: `server/src/env.ts`** — `export const MAP_EDITOR_PASSWORD = process.env.MAP_EDITOR_PASSWORD ?? "29981721";`
- [ ] **Step 5: Run tests, verify PASS** — `corepack pnpm -C server exec vitest run test/map.test.ts`.
- [ ] **Step 6: Commit** — `git commit -am "feat(server): map file store + password-checked auth/get/put handlers"`

---

### Task 5: Server — register routes

**Files:** Modify `server/src/index.ts` (register before the SPA catch-all).

- [ ] **Step 1: Register** `POST /api/editor/auth → authHandler`, `GET /api/map → getMapHandler`, `PUT /api/map → putMapHandler`, mirroring the existing `/api/leaderboard` + `/api/score` registration.
- [ ] **Step 2: Verify** — `corepack pnpm build:server` clean; run `corepack pnpm dev:server`; `curl -s localhost:3000/api/map` → `{"def":null}`; `curl -s -XPOST localhost:3000/api/editor/auth -H 'content-type: application/json' -d '{"password":"29981721"}'` → `{"ok":true}`; wrong password → 401.
- [ ] **Step 3: Commit** — `git commit -am "feat(server): register /api/editor/auth + /api/map routes"`

---

### Task 6: Live wiring — room sends decor on join; client builds it

**Files:**
- Modify: `server/src/ws/rooms.ts` (load active map's `decor`; include it where the seed is sent on the `welcome`/join event), `server/src/map.ts` (in-memory `activeMapCache`, refreshed on PUT + on boot).
- Modify (client): the `welcome`/join handler that today reads the seed (`src/game/net/Multiplayer.ts` / `Room.ts` + `Game.buildWorld(seed)` call) — read an optional `decor` array from the payload and pass it to `buildWorld({ seed, decor })`.

**Interfaces:**
- Consumes: `readActiveMap`/`activeMapCache` (Task 4), `buildWorld` (Task 3).
- Produces: `welcome` payload gains optional `decor: DecorEntry[]` alongside `seed`. Absent ⇒ client uses seed-only (scatter).

- [ ] **Step 1: Server** — on boot, `activeMapCache = await readActiveMap()`; `putMapHandler` updates it. In `rooms.ts`, include `decor: activeMapCache?.decor` in the join/welcome payload next to the seed.
- [ ] **Step 2: Client** — extend the welcome handler to read `decor` and thread it into world construction (`buildWorld({ seed, decor })`); validate with `validateMapDef` before use (ignore if invalid).
- [ ] **Step 3: Verify** — tsc (client + server) clean. Manual: with no `active.json`, online play unchanged (scatter). After Task 7 saves a map, a fresh client join shows the authored decor.
- [ ] **Step 4: Commit** — `git commit -am "feat(map): broadcast the active map's decor to clients on join"`

---

### Task 7: `/editor` route + page + overhead canvas (place/delete/save/load)

**Files:**
- Modify: `src/router.tsx` (add `/editor` before `*`)
- Create: `src/pages/Editor.tsx` (password gate + canvas mount + palette UI)
- Create: `src/game/editor/MapEditor.ts` (overhead Three.js editor engine)
- Read first: `src/pages/Index.tsx:147-180` (engine mount pattern, `ModelLibrary.preload`), `src/game/Game.ts:306-333` (renderer/scene/ortho camera), `src/game/InputManager.ts` (mouse NDC), `src/components/hud/primitives.tsx` (panel/button styling).

**Interfaces:**
- Consumes: `buildWorld` (Task 3), `ModelLibrary`, `validateMapDef`/`ENV_PROPS`/`makeDecorEntry` (Task 1), `Decor.placeAt/removeAt/serialize` (Task 2).
- Produces: a working editor; saves via `PUT /api/map` with `x-editor-password`.

- [ ] **Step 1: Route + gate** — add the route; `Editor.tsx` shows a password form → `POST /api/editor/auth`; on `{ok:true}` keep the password in component state (in memory) and mount the canvas; on 401 show an error. (Unlinked, like `/hudlab`.)
- [ ] **Step 2: `MapEditor` engine** — `ModelLibrary.preload()` then: renderer + scene + lights; `buildWorld(scene, { seed: FIXED_EDITOR_SEED, decor })` where `decor` came from `GET /api/map` (or empty); an **OrthographicCamera** fixed overhead framing the whole ±45 arena; **drag-pan** (pointer drag → shift camera target) + **scroll-zoom** (clamp). Add a `THREE.Raycaster`: on pointermove, raycast `platform.group` → world point → `Platform.cellAt` → hovered `(ix,iz)`; show a translucent **ghost** of the selected prop at that cell (or a delete highlight).
- [ ] **Step 3: Tools + actions** — palette (React, left panel) lists `ENV_PROPS` (icons/labels) + a **Delete** tool; selecting sets the active tool. Left-click: place tool → `decor.placeAt(asset, ix, iz)` (ignore if null); delete tool → `decor.removeAt(ix, iz)`. Maintain an in-session **undo stack** (push inverse op; Ctrl/Cmd-Z pops). **Save** button → `PUT /api/map` body `{ def: { version:1, decor: decor.serialize() } }`, header `x-editor-password`; toast on 200, error on 401/400.
- [ ] **Step 4: Verify (manual)** — `corepack pnpm dev`, open `/editor`: wrong password blocked; right password unlocks; place several trees (snap to grid), delete one, pan/zoom, Save → reload page → the saved layout loads (`GET /api/map`). Then open the game (multiplayer) in a second tab → the authored decor appears (Task 6 wiring). tsc + eslint clean.
- [ ] **Step 5: Commit** — `git commit -am "feat(editor): /editor overhead map editor — place/delete/save/load decor"`

---

### Task 8: Docs

**Files:**
- Create: `docs/systems/map-editor.md` (keywords + file-map + the `MapDefinition` shape + the auth/persistence flow + how the map reaches the live game + how to change the password)
- Modify: `docs/README.md` (index row)

- [ ] **Step 1: Write the doc** following the existing `docs/systems/*` style (keywords line, "Onde está o código" table, canonical facts: password env, `active.json` path, the `decor`-on-`welcome` wiring, v1 limitations = decor-only/single-map/no rotation).
- [ ] **Step 2: Index it** in `docs/README.md`.
- [ ] **Step 3: Commit** — `git commit -am "docs(map): map editor system doc + index"`

---

## Notes / risks
- **Three.js untestable in Vitest:** Tasks 2 & 7 lean on manual verification; only pure logic (Task 1, Task 4 validation, Task 2 bookkeeping) is unit-tested. Acceptable — matches the repo's existing test posture (netcode/logic only).
- **No-DB is fine:** file persistence needs no Postgres; `active.json` lives under `server/public/` (already deployed with the bundle). Edits made in prod persist on the running container's disk until redeploy — acceptable for a single curator "for now"; note in the doc.
- **Deploy:** `MAP_EDITOR_PASSWORD` must be added to `deploy.shardcloud` `CUSTOM_COMMAND` (prepend `MAP_EDITOR_PASSWORD='…'`) before prod, else it defaults to `29981721`.
- **Bounds:** placement reuses `Decor`'s existing cell gates, so authored props can't land on hills/edges/water — same constraints as the scatter.
