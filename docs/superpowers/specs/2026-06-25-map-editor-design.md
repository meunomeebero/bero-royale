# Spec — Map Editor (super-user route) for Bero Royale

**Status:** design approved (2026-06-25), pre-implementation.
**Goal:** a password-gated `/editor` route — a Minecraft-style overhead map editor — where the
super-user places/deletes trees & decor (and optionally paints terrain) from the 3D asset pack to
author a **single official map** that replaces the current messy procedural scatter for everyone.

## 0. v1 = EASIEST-FIRST (this build) — chosen 2026-06-25
Ship the smallest thing that solves the pain (decor disposal), then iterate. v1 simplifications:
- **Decor only.** Terrain stays exactly as today (seeded `Platform`, **unchanged** — no overrides, no
  terrain paint). Only `Decor` becomes data-driven. → `MapDefinition` for v1 is just
  `{ version:1, decor: [{id, asset, ix, iz}] }` (drop `terrainSeed`/`terrainOverrides` until Phase 2).
- **File persistence**, not Postgres: the active map is a JSON file `server/public/maps/active.json`
  (no DB table, no migration). Swap to Postgres later if multi-map is wanted.
- **Snap-to-grid**, no per-prop rotation in v1 (yaw defaults 0).
- Live wiring: the room reads `active.json` and includes the `decor[]` in the `welcome` payload
  alongside the existing seed (seed still drives terrain). Empty/missing ⇒ today's scatter fallback.
Everything below is the fuller design; the v1 cut implements only the decor + file + route + auth slice.

---

## 1. Problem & the core constraint

The world is **fully procedural with no data layer**:
- `src/game/Platform.ts` builds the 90×90 world (grid `180²`, `BLOCK_SIZE 0.5`, bounds ±45) from a
  `seed` via `mulberry32` PRNGs (hills + grass fields). Cell = `{ix, iz, height:0|1, field:0..3}`.
  `cells` is private; **no `toJSON`/`fromJSON`, no map object.**
- `src/game/Decor.ts` scatters **240 props** from another seed into 4 position-synced parallel
  arrays (`group.children`, `obstacles`, `anims`, `shadows`). **No IDs, no `getDecorAt`/`deleteAt`.**
- The server hands clients a **seed** via the `welcome` event (`server/src/ws/rooms.ts`).

→ A map editor requires first introducing a **serializable `MapDefinition`** and making `Platform` +
`Decor` build from it (with the current seeded generation as the no-data fallback). That data-layer
refactor is the real work; routing/palette/server are low-friction (precedents: `/hudlab`,
`/api/score`, `server/src/db.ts`).

## 2. Scope

**In scope (v1):**
- `MapDefinition` schema + data-driven `Decor` (load authored props instead of scattering).
- `/editor` overhead canvas: place/delete decor props, snap-to-grid; pan/zoom; save.
- Asset palette from `ModelLibrary` env props: `tree1, tree2, box1, box2, grassflower1,
  grassflower2, grassmushroom`.
- Server: password-checked `auth` + `PUT/GET /api/map`; persist the single active map.
- Live wiring: the server loads the active map and sends it on join → everyone plays the authored map.

**In scope (v1.5 / secondary mode, same schema):**
- Terrain paint: per-cell grass `field` variant + `height` (hill on/off) overrides.

**Out of scope (deferred):** multiple named maps + picker, animals/collectibles/powerup-spawn/spawn-point
authoring, new heights/hazards, changing arena bounds, undo-history beyond a simple in-session stack,
real user accounts (one shared password "for now").

## 3. Data model — `MapDefinition`

Shared TS type (new `src/game/map/MapDefinition.ts`, imported by client + server):

```ts
export interface MapDefinition {
  version: 1;
  /** Base terrain generation (hills/grass fields) — keeps the organic look. */
  terrainSeed: number;
  /** Sparse terrain paint: only cells that DIFFER from the seeded base (v1.5). */
  terrainOverrides: { ix: number; iz: number; height: 0 | 1; field: 0 | 1 | 2 | 3 }[];
  /** Authored decor props. Snap-to-grid → placed at the center of cell (ix,iz). */
  decor: { id: string; asset: EnvProp; ix: number; iz: number; yaw?: number }[];
}
export type EnvProp =
  | "tree1" | "tree2" | "box1" | "box2"
  | "grassflower1" | "grassflower2" | "grassmushroom";
```

- `id`: stable per-prop id (e.g. `mulberry`-free counter or `crypto`-ish short id) for O(1)
  delete/update.
- Bounds: `ix,iz ∈ [0,180)`; placement clamped to grass, non-edge cells (same gates the scatter used).
- Backward-compat: a missing/empty `MapDefinition` ⇒ pure seeded generation (current behavior).

## 4. Engine refactor (data-driven world)

**Extract world-building** so the game and the editor build identically from one `MapDefinition`:
- New `src/game/map/buildWorld.ts` (or `Game.buildWorld` reworked): `buildWorld(scene, def) → { platform, decor }`.
- `Platform`: accept `(terrainSeed, terrainOverrides?)`. Generate base from seed, then apply sparse
  overrides before meshing. No override list ⇒ identical to today.
- `Decor`: accept `(platform, def.decor)`. If `decor` is provided, instantiate exactly those props
  (no scatter); else fall back to seeded scatter. Add an **addressable model**: `Map<id, DecorItem>`
  with `add(item)`, `removeById(id)`, `itemAt(worldX,worldZ)` (cell-keyed) — replacing the 4
  position-synced arrays with one record that owns `{object, obstacle, anim, shadow}` per id. Rebuild
  `obstacles[]` (for `bullets.setObstacles`) from the live set.

This refactor is the highest-risk piece — it touches collision (`bullets.setObstacles`), so it ships
with a guard: **default/empty MapDefinition reproduces today's world byte-for-feel** (seeded), verified
before any editor work.

## 5. `/editor` route + canvas

- Route: add `{ path: "/editor", element: <Editor/> }` to `src/router.tsx` **before** the `*`
  catch-all (SPA fallback already serves `/editor`; no server route needed). Unlinked like `/hudlab`.
- `src/pages/Editor.tsx`: gates behind a password prompt (POST `/api/editor/auth`); on success mounts
  the editor canvas.
- `src/game/editor/MapEditor.ts` (NOT the full `Game` — no player/bots/bullets): renderer + scene +
  `buildWorld(def)` + lights + an **editor OrthographicCamera** (fixed overhead, covers the whole
  arena; drag-pan, scroll-zoom) + a `THREE.Raycaster` (the game has none — aim is yaw math).
- Interactions:
  - **Palette** (left panel, React): the 7 env props + a "terrain paint" toggle (grass variant /
    hill). Selected tool drives clicks.
  - **Place:** raycast ground → snap to cell `(ix,iz)` → instantiate selected `ModelLibrary.create("env", asset)` at the cell center → push to `MapDefinition.decor`. Ghost-preview at the hovered cell.
  - **Delete:** hover highlights the decor at the cell; click removes it (`removeById`) + from the def.
  - **Terrain paint (v1.5):** click paints the hovered cell's `field`/`height` override + re-meshes.
  - **Save:** `PUT /api/map` with the current `MapDefinition` + the password header.
  - **Load:** on mount, `GET /api/map` → if an active map exists, edit it; else seed a fresh one.
  - In-session **undo stack** (array of inverse ops) — simple, not persisted.
- Perf: reuse `ModelLibrary` instancing; the editor is not a 60fps combat scene, but keep place/delete
  O(1) via the id map.

## 6. Server — auth + persistence + live wiring

- **Password (server-side):** add `MAP_EDITOR_PASSWORD` to `server/src/env.ts` (default `29981721`
  for now; prod injects via `deploy.shardcloud` `CUSTOM_COMMAND`). **Real enforcement is server-side.**
- **Endpoints** (register in `server/src/index.ts` before the SPA catch-all; new `server/src/map.ts`):
  - `POST /api/editor/auth` `{password}` → `{ok:true}` iff it matches (UX gate only).
  - `PUT /api/map` (header `x-editor-password`, re-checked server-side) `{def}` → validates + persists
    the single active map. Rejects 401 on bad password, 400 on malformed/oversized def.
  - `GET /api/map` (public) → the active `MapDefinition` or `null`.
- **Persistence:** `server/src/db.ts` — add `CREATE TABLE maps (id text primary key, def jsonb, updated_at timestamptz)`
  to `migrate()`; the active map is the single row `id='active'` (upsert). **File fallback** when no
  `DATABASE_URL`: `server/public/maps/active.json`.
- **Live wiring:** `server/src/ws/rooms.ts` — on a client join, load the active `MapDefinition` (cached
  in memory, refreshed on `PUT`) and send it on the `welcome` event **in place of** the raw seed
  (carry `terrainSeed` for the fallback). The client's `buildWorld` consumes it. No active map ⇒ send a
  seed as today. Arena bounds stay ±45 (`ARENA_HALF` unchanged) so server bot sim is unaffected.

## 7. Approaches considered (pivotal decisions)

- **Persistence:** Postgres single active row (chosen — durable, matches `db.ts` upsert precedent,
  trivial multi-map later) vs single JSON file (file fallback, used only when no DB).
- **How the map reaches the game:** server broadcasts the full `MapDefinition` on `welcome` (chosen —
  simplest, self-contained, ≤ a few KB) vs broadcast a map-id + client GET (extra round-trip) vs bake
  into the build (stale, needs redeploy per edit).
- **Placement:** snap-to-grid (chosen — clean, Minecraft-like, trivial collision/serialization) vs
  freeform float + manual rotation.

## 8. Error handling & edge cases

- No DB and no file ⇒ editor still works in-memory; `GET` returns `null`; live game uses the seed.
- Malformed/oversized `def` on `PUT` ⇒ 400 (cap props, validate enums/bounds).
- Wrong password ⇒ 401; the client never trusts its own gate (server enforces every write).
- Decor on an invalid cell (hill/edge) ⇒ editor refuses placement (same gates as scatter).
- Empty map saved ⇒ a bare arena (allowed; the user is authoring).
- Mid-match map change ⇒ applies to **new joins**; we do NOT hot-swap a running match's terrain.

## 9. Testing

- **Unit (vitest, deterministic):** `MapDefinition` round-trip (serialize/parse); `Decor` builds the
  exact authored set + rebuilds `obstacles`; an empty def reproduces the seeded fallback; server
  `map.ts` auth (401 on bad pw) + validation (400) + upsert.
- **Manual:** `/editor` place/delete/save; reload reflects saved map; a second client joining a room
  sees the authored decor (live wiring); `/editor` blocked on wrong password.

## 10. File map (what changes)

| Area | Files |
|---|---|
| Schema | `src/game/map/MapDefinition.ts` (new, shared) |
| World build | `src/game/map/buildWorld.ts` (new) + `Game.ts` (use it) |
| Data-driven | `src/game/Platform.ts` (overrides), `src/game/Decor.ts` (load + addressable id-map) |
| Route/page | `src/router.tsx`, `src/pages/Editor.tsx` (new) |
| Editor engine | `src/game/editor/MapEditor.ts` (new), palette UI components |
| Server | `server/src/env.ts`, `server/src/index.ts`, `server/src/map.ts` (new), `server/src/db.ts`, `server/src/ws/rooms.ts` |
| Docs | `docs/systems/map-editor.md` (new) + index; `docs/balance-log.md` n/a |

## 11. Staging

- **Phase 1 (core):** schema + data-driven Decor (+ seeded fallback, verified) + `/editor` decor
  place/delete/save/load + server auth/persistence + live wiring. **Solves the stated pain.**
- **Phase 2:** terrain paint (field/height overrides).
- **Phase 3 (deferred):** multiple named maps + picker.
