# Multiplayer Bot Realism Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 3–6 server backfill bots read as distinct, imperfect humans who fight each other and treat a lone player as just another enemy — without leaving that player with nothing to do.

**Architecture:** All work is in `server/src/ws/bots.ts` (`BotSim`) — one coherent state machine, so tasks are **sequential**, each reading fresh file state. `bots.ts` has only type-only imports, so it runs standalone under `tsx`; tests are harness scripts in `server/test/` that build a `BotSim` with a fake hub, drive `tick()`, and assert on a new read-only `inspect()` accessor + captured `fanout` messages. No server process needed.

**Tech Stack:** TypeScript (server, ESM, `tsup` build, `tsc --noEmit` check), `tsx` (run TS harnesses directly), `corepack pnpm`. No unit-test framework exists — follow the existing `server/test/hit-sync-harness.mjs` idiom (plain assert + `process.exit`).

## Global Constraints
- Server-authoritative, **20 Hz** tick (`BOT_TICK_SECONDS`). No projectile sim — shooting is hitscan + a travelling visual tracer; damage is scheduled on-arrival via `hub.enqueueHit`.
- **Never** strand `vx/vz`: the steering→`zeroOnWall`→`fanout("s")` tail must run every tick for every alive bot (client dead-reckons snapshot `vx/vz`). New gates are **guards around conditionals, never an early `continue`**.
- No hot-path allocation in `tick()`/`fire()`. `genHandle` runs at **spawn only**.
- Owner-locked feel = the **population-average** of `ACCURACY=0.3`, `SHOOT_CD_*`, `LEAD_FACTOR`, `SUPER_*` stays centered; per-bot variance spreads around it. Do not shift the means.
- Only room is `GAME_ROOM = "voxelcube-ffa"`.
- Source of truth for behavior + constants: `docs/superpowers/specs/2026-06-25-multiplayer-bot-realism-design.md`. Every change must end with the docs update (Task 10) per the project's "documentar toda mudança" rule.
- Verify by **grep for each intended change**, not only `tsc` (a partial edit can still compile).

**Build/verify gates (run from repo root):**
- `corepack pnpm -C server exec tsc --noEmit`
- `corepack pnpm -C server exec tsx test/<harness>.ts` (per task)
- Final: `corepack pnpm build:server`

---

### Task 1: Test harness + per-bot skill scalar (keystone)

Adds the persistent `skill` identity and the `inspect()` test accessor + a shared fake-hub harness. No targeting change yet — only per-bot accuracy/cadence/aim-lead variance.

**Files:**
- Modify: `server/src/ws/bots.ts` (`ServerBot` interface ~212–259; `spawnBot` 457–482; `respawn` 485–520; `fire` 1400/1408; `fireSuper` 1248; cadence reset 959; add `deriveSkill` + `inspect`)
- Create: `server/test/_bot-harness.ts` (shared fake hub)
- Create: `server/test/skill.test.ts`

**Interfaces:**
- Produces: `BotSim.inspect(room: string): BotView[]` where `BotView = { id, name, animal, x, z, yaw, health, alive, skill, accEff, cadenceMul, leadMul, targetId, pendingTargetId, commitT, reactT, superHesitateT, kameCharging, kills, streak }`.
- Produces: `deriveSkill(b: ServerBot): void` (private) setting `accEff/cadenceMul/leadMul` from `b.skill`.
- Produces: `server/test/_bot-harness.ts` → `makeHarness(opts?) => { sim, setPlayers, fanned, drainHits, inspect }`.

- [ ] **Step 1: Write the shared fake-hub harness**

Create `server/test/_bot-harness.ts`:

```ts
import { BotSim } from "../src/ws/bots.ts";

export const ROOM = "voxelcube-ffa";
export interface FakePlayer { id: string; x: number; z: number; grounded?: boolean; }
export interface Captured { event: string; payload: any; from: string; }

export function makeHarness(opts: { players?: FakePlayer[] } = {}) {
  let players: FakePlayer[] = opts.players ?? [];
  const fanned: Captured[] = [];
  const pending: { applyAt: number; resolve: () => void }[] = [];
  const hub: any = {
    playerTargets: () => players.map((p) => ({ id: p.id, x: p.x, z: p.z, grounded: p.grounded ?? true })),
    liveSizeOf: () => players.length,
    isPlayer: (_r: string, id: string) => players.some((p) => p.id === id),
    fanout: (_r: string, msg: any) => fanned.push({ event: msg.event, payload: msg.payload, from: msg.from }),
    damagePlayer: (_r: string, targetId: string) => {
      const p = players.find((x) => x.id === targetId);
      return p ? { died: false, x: p.x, z: p.z, byId: "", victimName: targetId } : null;
    },
    enqueueHit: (_r: string, hit: any) => pending.push(hit),
    broadcastPresence: () => {},
    powerupSim: { botItemTargets: () => [] },
  };
  const sim = new BotSim(hub);
  return {
    sim,
    setPlayers: (ps: FakePlayer[]) => { players = ps; },
    fanned,
    drainHits: () => { const now = Date.now(); for (let i = pending.length - 1; i >= 0; i--) { if (pending[i].applyAt <= now) { pending[i].resolve(); pending.splice(i, 1); } } },
    inspect: () => sim.inspect(ROOM),
  };
}

export function assert(cond: any, msg: string): void {
  if (!cond) { console.error("FAIL:", msg); process.exit(1); }
}
export function done(): void { console.log("PASS"); process.exit(0); }
```

- [ ] **Step 2: Add `skill` + derived fields to `ServerBot` and a `deriveSkill` helper**

In `bots.ts`, add to the `ServerBot` interface (with the other per-bot fields):

```ts
  // ── Per-bot identity (persistent skill → accuracy/cadence/aim-lead) ──
  skill: number;      // 0..1, rolled once, PRESERVED across respawn (a person keeps their rep)
  accEff: number;     // cached effective accuracy (derived from skill)
  cadenceMul: number; // cached fire-cadence multiplier (derived)
  leadMul: number;    // cached aim-lead multiplier (derived)
```

Add the helper (near the other private methods):

```ts
  /** Recompute the cached feel values from b.skill. Variance spreads AROUND the
   *  owner-locked means: E[accEff]=ACCURACY, E[cadenceMul]=E[leadMul]=1 at E[skill]=0.5.
   *  No clamp — raw accEff range [0.21,0.39] is already valid at ACCURACY=0.3. */
  private deriveSkill(b: ServerBot): void {
    b.accEff = ACCURACY * (0.7 + 0.6 * b.skill);
    b.cadenceMul = 1.25 - 0.5 * b.skill;
    b.leadMul = 0.5 + b.skill;
  }
```

- [ ] **Step 3: Seed `skill` in `spawnBot`, preserve in `respawn`, add `inspect`**

In `spawnBot`, inside the `this.bots.set(id, { ... })` literal add `skill: 0, accEff: 0, cadenceMul: 0, leadMul: 0,` then immediately after the `set`, derive:

```ts
    const b = this.bots.get(id)!;
    b.skill = (rand() + rand()) / 2; // center-biased: most mid, few sharp, few free
    this.deriveSkill(b);
```

In `respawn`, do **not** reset `skill`; after the field resets add `this.deriveSkill(b);` (re-derive caches; preserves the bot's reputation).

Add the read-only accessor (test-only; pure read, never called in the hot path):

```ts
  /** TEST-ONLY read of internal bot state (no allocation in tick path). */
  inspect(room: string): Record<string, unknown>[] {
    if (room !== GAME_ROOM) return [];
    return [...this.bots.values()].map((b) => ({
      id: b.id, name: b.name, animal: b.animal, x: b.x, z: b.z, yaw: b.yaw,
      health: b.health, alive: b.alive, skill: b.skill, accEff: b.accEff,
      cadenceMul: b.cadenceMul, leadMul: b.leadMul, targetId: b.targetId,
      pendingTargetId: (b as any).pendingTargetId ?? null, commitT: (b as any).commitT ?? 0,
      reactT: (b as any).reactT ?? 0, superHesitateT: (b as any).superHesitateT ?? 0,
      kameCharging: b.kameCharging, kills: (b as any).kills ?? 0, streak: (b as any).streak ?? 0,
    }));
  }
```

(The `(b as any)` fallbacks let `inspect` compile before later tasks add those fields; tighten the casts as fields land.)

- [ ] **Step 4: Wire skill into fire/cadence/lead**

- `fire()` accuracy roll (1408): `const hits = rand() <= b.accEff;`
- `fire()` lead (1400–1401): `const aimX = tgt.x + tgt.vx * LEAD_FACTOR * b.leadMul;` and same for `aimZ`.
- `fireSuper()` lead (1248–1249): `const aimX = tpos.x + (est?.vx ?? 0) * LEAD_FACTOR * b.leadMul;` and same for `aimZ`.
- cadence reset (959): `b.shootCd = (SHOOT_CD_MIN + rand() * SHOOT_CD_RND) * b.cadenceMul * rapidMult;`

- [ ] **Step 5: Write the failing test**

Create `server/test/skill.test.ts`:

```ts
import { makeHarness, assert, done } from "./_bot-harness.ts";

const h = makeHarness({ players: [{ id: "P", x: 0, z: 0 }] });
for (let i = 0; i < 5; i++) h.sim.tick("voxelcube-ffa", 0.05); // spawn + settle

const bots = h.inspect();
assert(bots.length >= 3, `expected >=3 bots, got ${bots.length}`);

// (a) skill spread is real: not all identical
const skills = bots.map((b) => b.skill as number);
assert(new Set(skills.map((s) => s.toFixed(3))).size > 1, "all bots share one skill (no spread)");

// (b) derived caches match the formulas exactly
for (const b of bots) {
  const s = b.skill as number;
  assert(Math.abs((b.accEff as number) - 0.3 * (0.7 + 0.6 * s)) < 1e-9, "accEff formula wrong");
  assert(Math.abs((b.cadenceMul as number) - (1.25 - 0.5 * s)) < 1e-9, "cadenceMul formula wrong");
  assert(Math.abs((b.leadMul as number) - (0.5 + s)) < 1e-9, "leadMul formula wrong");
}

// (c) population-mean accuracy invariant: E[accEff] ≈ ACCURACY (0.30) over many rolls
let sum = 0, n = 50000;
for (let i = 0; i < n; i++) { const sk = (Math.random() + Math.random()) / 2; sum += 0.3 * (0.7 + 0.6 * sk); }
assert(Math.abs(sum / n - 0.3) < 0.005, `mean accEff drifted: ${(sum / n).toFixed(4)}`);

done();
```

- [ ] **Step 6: Run test — verify it fails then passes**

Run: `corepack pnpm -C server exec tsx test/skill.test.ts`
Expected before Steps 2–4: FAIL (no `inspect`/`skill`). After: `PASS`.
Also run: `corepack pnpm -C server exec tsc --noEmit` → no new errors.

- [ ] **Step 7: Commit**

```bash
git add server/src/ws/bots.ts server/test/_bot-harness.ts server/test/skill.test.ts
git commit -m "feat(bots): per-bot skill scalar (accuracy/cadence/aim-lead) + test harness"
```

---

### Task 2: Procedural gamer-handle names

**Files:**
- Modify: `server/src/ws/bots.ts` (remove `NAMES` 203–210; add `genHandle`; rewrite the name pick + add animal-dedupe in `spawnBot` 452–455)
- Create: `server/test/names.test.ts`

**Interfaces:**
- Produces: `genHandle(taken: Set<string>): string` (module-level pure fn; uses `rand`). Returns a unique-vs-`taken`, in-room-distinct handle.

- [ ] **Step 1: Write `genHandle` (replace the `NAMES` array)**

Remove `const NAMES = [...]`. Add at module scope:

```ts
const PT_NOUN = ["destruidor", "mlk", "quebrada", "mundos", "lenda", "monstro", "treta", "capeta", "demonio", "bicho", "fera"];
const PT_CONN = ["de", "do", "da", "das"];
const ANIME = ["sasuke", "goku", "naruto", "itachi", "kakashi", "zoro", "luffy", "void", "ghost", "shadow", "reaper", "slayer", "dark", "neo", "kira"];
const PRO = ["pro", "god", "king", "master", "op", "gg", "no1", "real"];
const NUM3 = [420, 69, 777, 666, 1337, 7, 99, 13];
const pick = <T,>(a: T[]): T => a[Math.floor(rand() * a.length)];
const bigNum = () => Math.floor(rand() * 90000) + 100;      // 3–5 digits, NOT only round
const num2 = () => String(Math.floor(rand() * 100)).padStart(2, "0");
const maybeLeet = (s: string) =>
  rand() < 0.3 ? s.replace(/[aeios]/g, (c) => (rand() < 0.6 ? ({ a: "4", e: "3", i: "1", o: "0", s: "5" } as Record<string, string>)[c] : c)) : s;

/** A procedural gamer handle, distinct from every name in `taken`. Spawn-only. */
function genHandle(taken: Set<string>): string {
  for (let attempt = 0; attempt < 10; attempt++) {
    const r = rand();
    let name: string;
    if (r < 0.35) name = pick(ANIME) + (rand() < 0.5 ? num2() : ""); // ~30–40% plain handles
    else if (r < 0.5) name = `${pick(PT_NOUN)}_${pick(PT_CONN)}_${pick(PT_NOUN)}${bigNum()}`;
    else if (r < 0.65) name = `xX${pick(ANIME)}_${pick(PRO)}Xx`;
    else if (r < 0.8) name = `${pick(PT_NOUN)}_${pick(PT_CONN)}_${pick(PT_NOUN)}${num2()}`;
    else if (r < 0.92) name = `${pick(ANIME)}${pick(NUM3)}`;
    else name = `${pick(ANIME)}${pick(PRO)}${rand() < 0.5 ? num2() : ""}`;
    name = maybeLeet(name);
    const stem = name.replace(/[0-9]/g, "");
    // Reject if the full name OR its digit-stripped stem already exists (no near-dupes).
    if (!taken.has(name) && ![...taken].some((t) => t.replace(/[0-9]/g, "") === stem)) return name;
  }
  return `player_${Math.floor(rand() * 1e6)}`; // bounded final fallback (distinct by construction)
}
```

- [ ] **Step 2: Use it in `spawnBot` with animal-dedupe**

Replace the `used`/`free`/`name` block (452–454) with:

```ts
    const taken = new Set([...this.bots.values()].map((b) => b.name));
    const name = genHandle(taken);
    const usedAnimals = new Set([...this.bots.values()].map((b) => b.animal));
    const freeAnimals = ANIMAL_NAMES.filter((a) => !usedAnimals.has(a));
    const animal = pick(freeAnimals.length ? freeAnimals : ANIMAL_NAMES); // dedupe avatars in a 3–6 lobby
```

- [ ] **Step 3: Write the test**

Create `server/test/names.test.ts`:

```ts
import { makeHarness, assert, done } from "./_bot-harness.ts";

const h = makeHarness({ players: [{ id: "P", x: 0, z: 0 }] });
for (let i = 0; i < 30; i++) h.sim.tick("voxelcube-ffa", 0.05);
const bots = h.inspect();

// (a) in-room uniqueness of names AND digit-stripped stems (no void420/void421 pair)
const names = bots.map((b) => b.name as string);
assert(new Set(names).size === names.length, "duplicate names in room");
const stems = names.map((n) => n.replace(/[0-9]/g, ""));
assert(new Set(stems).size === stems.length, `near-duplicate stems: ${names.join(",")}`);

// (b) animals deduped while count <= ANIMAL_NAMES length
const animals = bots.map((b) => b.animal as string);
assert(new Set(animals).size === animals.length, "duplicate animals in small lobby");

// (c) style variance over a big sample: some plain (no digit), some with numbers
let plain = 0, total = 5000;
const seen = new Set<string>();
// drive variety by repeated independent generation via fresh harnesses
for (let i = 0; i < total; i++) {
  const g = makeHarness({ players: [{ id: "P", x: 0, z: 0 }] });
  g.sim.tick("voxelcube-ffa", 0.05);
  const nm = (g.inspect()[0]?.name as string) ?? "";
  seen.add(nm);
  if (!/[0-9]/.test(nm)) plain++;
}
assert(plain / total > 0.15 && plain / total < 0.6, `plain-handle ratio off: ${(plain / total).toFixed(2)}`);
assert(seen.size > 100, `generator not varied: only ${seen.size} distinct first-bot names`);

done();
```

- [ ] **Step 4: Run + commit**

Run: `corepack pnpm -C server exec tsx test/names.test.ts` → `PASS`; `tsc --noEmit` clean.
```bash
git add server/src/ws/bots.ts server/test/names.test.ts
git commit -m "feat(bots): procedural gamer-handle names + animal dedupe"
```

---

### Task 3: Population — held random [3,6], room-lifetime

**Files:**
- Modify: `server/src/ws/bots.ts` (`MAX_BOTS` 180 → 6; remove `MIN_COMBATANTS` 178; add `private targetBotCount = 0`; population block 633–646; `clearRoom` 444–446)
- Create: `server/test/population.test.ts`

**Interfaces:**
- Produces: `BotSim` holds a rolled `[3,6]` count for the room lifetime; `clearRoom(GAME_ROOM)` resets it (re-roll on next activation).

- [ ] **Step 1: Edit constants + add the field**

Set `const MAX_BOTS = 6;`. Delete `const MIN_COMBATANTS = 10;`. Add to the class fields: `private targetBotCount = 0;`.

- [ ] **Step 2: Rewrite the population block (633–646)**

Replace the `const live = ...; const desired = ...;` lines with:

```ts
    const live = this.hub.liveSizeOf(room);
    if (live > 0 && this.targetBotCount === 0) {
      this.targetBotCount = 3 + Math.floor(rand() * 4); // held [3,6] for the room lifetime
    }
    const desired = live > 0 ? Math.min(MAX_BOTS, this.targetBotCount) : 0;
```

(Keep the existing spawn/delete while-loops + `broadcastPresence`. The `live>0?:0` stays as a belt-and-suspenders drain.)

- [ ] **Step 3: Reset on teardown in `clearRoom`**

```ts
  clearRoom(room: string) {
    if (room === GAME_ROOM) { this.bots.clear(); this.targetBotCount = 0; }
  }
```

- [ ] **Step 4: Write the test**

Create `server/test/population.test.ts`:

```ts
import { makeHarness, assert, done } from "./_bot-harness.ts";

const h = makeHarness({ players: [{ id: "P", x: 0, z: 0 }] });
for (let i = 0; i < 10; i++) h.sim.tick("voxelcube-ffa", 0.05);
const n1 = h.inspect().length;
assert(n1 >= 3 && n1 <= 6, `bot count out of [3,6]: ${n1}`);

// held across ticks (no churn): count stays put
for (let i = 0; i < 40; i++) h.sim.tick("voxelcube-ffa", 0.05);
assert(h.inspect().length === n1, "bot count drifted within a session");

// flat regardless of more players joining
h.setPlayers([{ id: "P", x: 0, z: 0 }, { id: "Q", x: 5, z: 5 }, { id: "R", x: -5, z: 5 }]);
for (let i = 0; i < 10; i++) h.sim.tick("voxelcube-ffa", 0.05);
assert(h.inspect().length === n1, "bot count changed when players joined (should be flat)");

// teardown re-rolls; a fresh activation can differ; grace (no clearRoom) would keep it
h.sim.clearRoom("voxelcube-ffa");
assert(h.inspect().length === 0, "clearRoom did not drop bots");
for (let i = 0; i < 10; i++) h.sim.tick("voxelcube-ffa", 0.05);
const n2 = h.inspect().length;
assert(n2 >= 3 && n2 <= 6, `re-roll out of [3,6]: ${n2}`);

done();
```

- [ ] **Step 5: Run + commit**

Run: `corepack pnpm -C server exec tsx test/population.test.ts` → `PASS`; `tsc --noEmit` clean. Grep: `grep -n "targetBotCount\|MAX_BOTS = 6" server/src/ws/bots.ts` and confirm `MIN_COMBATANTS` is gone (`grep -c MIN_COMBATANTS server/src/ws/bots.ts` → `0`).
```bash
git add server/src/ws/bots.ts server/test/population.test.ts
git commit -m "feat(bots): held random [3,6] population, reset on room teardown"
```

---

### Task 4: Targeting — equal-by-distance + retaliate-on-bots + commitment + player floor

Rewrites the target-selection block (774–820) as one coherent change with three behaviors. Adds a pre-pass that designates one "pull" bot per neglected player.

**Files:**
- Modify: `server/src/ws/bots.ts` (`ServerBot`: add `commitT`; new consts `PLAYER_PULL`, `COMMIT_MIN`, `COMMIT_SPAN`; pre-pass near 690; selection block 774–820; `spawnBot`/`respawn` init `commitT`)
- Create: `server/test/targeting.test.ts`

**Interfaces:**
- Consumes: `inspect()[].targetId`, `.commitT`.
- Produces: a bot's `targetId` follows nearest-enemy (players == bots) with a `PLAYER_PULL` bias only for a neglected player; `commitT` bound to the current `targetId`.

- [ ] **Step 1: Add field + constants**

`ServerBot`: add `commitT: number;`. Init `commitT: 0` in the `spawnBot` literal and `b.commitT = 0` in `respawn`. Add consts:

```ts
const PLAYER_PULL = 5;     // effective-distance bias toward a lone UNTARGETED player (< ENGAGE_LEASH=12)
const COMMIT_MIN = 0.8, COMMIT_SPAN = 0.8; // commitT = COMMIT_MIN + (1-skill)*COMMIT_SPAN → 0.8..1.6s
```

- [ ] **Step 2: Add the player-pull pre-pass (next to the engager pre-pass ~690–724)**

After `engagersByPlayer`/`superHolder` are built, add:

```ts
    // ── PLAYER-ATTENTION FLOOR (anti-pacifism) ──────────────────────────────────
    // Pure-equal targeting can leave a lone PASSIVE player with zero bots aimed at
    // them ~29% of the time (a geometric property of nearest-neighbor). For each
    // player currently targeted by NO bot, designate the single nearest non-committed
    // alive bot to receive a PLAYER_PULL distance bias toward that player this tick.
    const pullBotByPlayer = new Map<string, string>(); // playerId → the one bot id pulled toward it
    if (players.length > 0) {
      const targeters = new Map<string, number>();
      for (const o of this.bots.values()) {
        if (o.alive && o.targetId && players.some((p) => p.id === o.targetId)) {
          targeters.set(o.targetId, (targeters.get(o.targetId) ?? 0) + 1);
        }
      }
      for (const p of players) {
        if ((targeters.get(p.id) ?? 0) > 0) continue; // already has attention
        let bestId: string | null = null, bestD2 = Infinity;
        for (const o of this.bots.values()) {
          if (!o.alive || o.commitT > 0) continue; // don't yank a committed bot
          const d2 = (o.x - p.x) ** 2 + (o.z - p.z) ** 2;
          if (d2 < bestD2) { bestD2 = d2; bestId = o.id; }
        }
        if (bestId) pullBotByPlayer.set(p.id, bestId);
      }
    }
```

- [ ] **Step 3: Rewrite the target-selection block (774–820)**

Replace the whole block with equal-by-distance + commitment + the pull bias + retaliate-on-bots:

```ts
      // ── TARGET SELECTION (equal-by-distance, committed, player-attention floor) ──
      // Players and bots are identical "enemies"; nearest wins. commitT keeps a bot
      // on its current fight (no equidistant ping-pong); a vanished target force-breaks
      // it. A neglected player gets a bounded PLAYER_PULL on one nearby bot.
      b.retargetCd -= dt;
      if (b.commitT > 0) b.commitT = Math.max(0, b.commitT - dt);
      const curTgt = b.targetId ? enemies.find((e) => e.id === b.targetId) ?? null : null;
      const curInRange = !!curTgt &&
        (curTgt.x - b.x) ** 2 + (curTgt.z - b.z) ** 2 <= (SHOOT_RANGE + ENGAGE_LEASH) ** 2;
      const holdCommit = b.commitT > 0 && !!curTgt && curInRange; // null/out-of-range curTgt force-breaks
      const pulledPlayerId = [...pullBotByPlayer.entries()].find(([, id]) => id === b.id)?.[0] ?? null;

      if (!holdCommit && (b.retargetCd <= 0 || !curTgt)) {
        b.retargetCd = RETARGET_CD;
        let best: Target | null = null, bestEff = Infinity;
        for (const e of enemies) {
          let d = Math.hypot(e.x - b.x, e.z - b.z);
          if (pulledPlayerId === e.id) d -= PLAYER_PULL; // bias toward a neglected player
          if (d < bestEff) { bestEff = d; best = e; }
        }
        const prev = b.targetId;
        if (best && curTgt && best.id !== curTgt.id) {
          // same-distance tiebreak: only switch if clearly closer (anti-flicker)
          const curD = Math.hypot(curTgt.x - b.x, curTgt.z - b.z);
          b.targetId = bestEff < curD - TARGET_SWITCH_HYSTERESIS ? best.id : curTgt.id;
        } else {
          b.targetId = best ? best.id : null;
        }
        if (b.targetId && b.targetId !== prev) {
          b.commitT = COMMIT_MIN + (1 - b.skill) * COMMIT_SPAN; // re-seed on a genuine id CHANGE only
        }
      }

      // RETALIATION: being shot re-aims at the shooter (player OR bot), overriding commit.
      if (b.threat > 0 && b.lastAttacker && b.lastAttacker !== b.targetId) {
        const atk = enemies.find((e) => e.id === b.lastAttacker);
        if (atk) {
          const ad2 = (atk.x - b.x) ** 2 + (atk.z - b.z) ** 2;
          if (ad2 <= (SHOOT_RANGE + 2) * (SHOOT_RANGE + 2)) {
            b.targetId = atk.id;
            b.commitT = COMMIT_MIN + (1 - b.skill) * COMMIT_SPAN; // bind commit to the new id
          }
        }
      }

      const tgt = enemies.find((e) => e.id === b.targetId) ?? null;
```

(Delete the old `isPlayerId`, `crossTierPreempt`, `curIsPlayer`, PASS1/PASS2 player-first logic — they're replaced above. `anyPlayerAlive` may now be unused; remove it if so.)

- [ ] **Step 4: Fix the engager-cap blockquote claim in code comments**

At the `isEngager`/bot-vs-bot comment (828–829), ensure the comment says bot-vs-bot is **uncapped** (no behavior change — the gate already does `!tgtIsPlayer || ...`). Just correct any stale comment.

- [ ] **Step 5: Write the test**

Create `server/test/targeting.test.ts`:

```ts
import { makeHarness, assert, done } from "./_bot-harness.ts";
const ROOM = "voxelcube-ffa";

// (a) equal-by-distance: a bot does NOT always pick the player when a bot is nearer.
{
  const h = makeHarness({ players: [{ id: "P", x: 40, z: 40 }] }); // player far in a corner
  for (let i = 0; i < 20; i++) h.sim.tick(ROOM, 0.05);
  const bots = h.inspect();
  const targetingPlayer = bots.filter((b) => b.targetId === "P").length;
  assert(targetingPlayer < bots.length, "every bot still targets the far player (not equal-by-distance)");
  assert(bots.some((b) => b.targetId && b.targetId !== "P"), "no bot is fighting another bot");
}

// (b) player-attention floor: a lone PASSIVE player is targeted within a commit cycle.
{
  let untargeted = 0, trials = 200;
  for (let t = 0; t < trials; t++) {
    const h = makeHarness({ players: [{ id: "P", x: (Math.random()*2-1)*40, z: (Math.random()*2-1)*40 }] });
    for (let i = 0; i < 40; i++) h.sim.tick(ROOM, 0.05); // ~2s, > max commitT
    if (!h.inspect().some((b) => b.targetId === "P")) untargeted++;
  }
  assert(untargeted / trials < 0.08, `lone player ignored ${(100*untargeted/trials).toFixed(1)}% (want <8%)`);
}

// (c) commitment: no per-RETARGET_CD ping-pong between two equidistant enemies.
{
  const h = makeHarness({ players: [{ id: "P", x: 0, z: 0 }] });
  for (let i = 0; i < 60; i++) h.sim.tick(ROOM, 0.05);
  // sample one bot's targetId across consecutive retarget windows; it must not flip every window
  const id = h.inspect()[0].id;
  let flips = 0; let prev = h.inspect().find((b) => b.id === id)!.targetId;
  for (let i = 0; i < 40; i++) {
    h.sim.tick(ROOM, 0.05);
    const cur = h.inspect().find((b) => b.id === id)?.targetId;
    if (cur && cur !== prev) flips++;
    prev = cur;
  }
  assert(flips < 12, `target flipped ${flips} times in 2s (ping-pong; commit not holding)`);
}

done();
```

- [ ] **Step 6: Run + commit**

Run: `corepack pnpm -C server exec tsx test/targeting.test.ts` → `PASS`; `tsc --noEmit` clean. Grep `grep -n "PLAYER_PULL\|holdCommit\|pullBotByPlayer" server/src/ws/bots.ts`.
```bash
git add server/src/ws/bots.ts server/test/targeting.test.ts
git commit -m "feat(bots): equal-by-distance targeting + commitment + player-attention floor"
```

---

### Task 5: Reaction latency (startle before the first reaction)

**Files:**
- Modify: `server/src/ws/bots.ts` (`ServerBot`: add `reactT`, `pendingTargetId`; consts `REACT_MIN/REACT_SPAN/DEFENSIVE_FLINCH`; `damageBot` 329–352 wasCalm seed; decay block ~734; commit + gates in the per-bot loop; `spawnBot`/`respawn` init)
- Create: `server/test/reaction.test.ts`

**Interfaces:**
- Consumes: `inspect()[].reactT`, `.pendingTargetId`.
- Produces: a bot shot while calm delays its first offensive reaction by `reactT` (0.15–0.30s); defensive juke un-gates at `min(reactT, 0.12s)`; `vx/vz` keep integrating.

- [ ] **Step 1: Add fields + constants**

`ServerBot`: add `reactT: number;` and `pendingTargetId: string | null;`. Init `reactT: 0, pendingTargetId: null` in `spawnBot` literal; `b.reactT = 0; b.pendingTargetId = null;` in `respawn`. Consts:

```ts
const REACT_MIN = 0.15, REACT_SPAN = 0.15; // reactT = REACT_MIN + (1-skill)*REACT_SPAN → 0.15..0.30s
const DEFENSIVE_FLINCH = 0.12;             // defensive dash/jump un-gate at min(reactT, this)
```

- [ ] **Step 2: Edge-seed in `damageBot` (capture `wasCalm` BEFORE threat is set)**

At the very top of `damageBot`, before `b.threat = THREAT_DECAY`:

```ts
    const wasCalm = b.threat <= 0; // a fresh threat, not a refresh of ongoing fire
```

After `b.lastAttacker = byId;`, add:

```ts
    if (wasCalm) {
      b.reactT = REACT_MIN + (1 - b.skill) * REACT_SPAN; // startle window (first reaction only)
      b.pendingTargetId = byId;                          // commit to the attacker after the window
    }
```

- [ ] **Step 3: Decay `reactT` in the per-bot timer block (~734)**

Add alongside the other decays: `if (b.reactT > 0) b.reactT = Math.max(0, b.reactT - dt);`

- [ ] **Step 4: Commit `pendingTargetId` with a liveness check (place right after `tgt` is resolved in the selection block)**

```ts
      // Reaction commit: once the startle elapses, turn to the attacker IF still valid.
      if (b.reactT <= 0 && b.pendingTargetId) {
        const pend = enemies.find((e) => e.id === b.pendingTargetId);
        const inRange = pend && (pend.x - b.x) ** 2 + (pend.z - b.z) ** 2 <= (SHOOT_RANGE + ENGAGE_LEASH) ** 2;
        if (inRange) { b.targetId = b.pendingTargetId; b.commitT = COMMIT_MIN + (1 - b.skill) * COMMIT_SPAN; }
        b.pendingTargetId = null;
      }
```

- [ ] **Step 5: Gate the outputs (GUARDS, not `continue`)**

- Fire block (949): add `b.reactT <= 0 &&` to the existing `if (isEngager && b.shootCd <= 0 && ...)`.
- Dash dodge (965) and jump dodge (980): change their guards to use the short flinch — wrap the threat-driven dodge in `b.reactT <= DEFENSIVE_FLINCH` (a flanked bot juke within ~120ms). Concretely, in the dash block change `if (b.dashCd <= 0 && b.grounded && b.stunT <= 0)` body's threat branch to also require `b.reactT <= DEFENSIVE_FLINCH`; same for the jump `urgent` branch.

> Do NOT add any `continue`. The steering→integrate→`fanout("s")` tail at 1058–1106 must still run so `vx/vz` stays truthful.

- [ ] **Step 6: Write the test**

Create `server/test/reaction.test.ts`:

```ts
import { makeHarness, assert, done } from "./_bot-harness.ts";
const ROOM = "voxelcube-ffa";

const h = makeHarness({ players: [{ id: "P", x: 0, z: 0 }] });
for (let i = 0; i < 20; i++) h.sim.tick(ROOM, 0.05);
// pick a calm bot far from its target and shoot it from the player
const b0 = h.inspect().find((b) => (b as any).reactT === 0)!;
const before = h.fanned.length;
h.sim.damageBot(ROOM, b0.id as string, "P"); // player shoots the bot
const after = h.inspect().find((b) => b.id === b0.id)!;
assert((after.reactT as number) > 0, "reactT not seeded on a fresh hit (wasCalm seed dead)");
assert(after.pendingTargetId === "P", "pendingTargetId not stashed to attacker");

// during the startle the bot must NOT fire at the player on the very next tick
h.fanned.length = 0;
h.sim.tick(ROOM, 0.05);
const firedAtP = h.fanned.some((m) => m.event === "shot" && m.from === b0.id && m.payload?.targetId === "P");
assert(!firedAtP, "bot fired at attacker during startle window (no reaction delay)");

// after the window elapses it does turn & engage
for (let i = 0; i < 8; i++) h.sim.tick(ROOM, 0.05); // > 0.30s
const committed = h.inspect().find((b) => b.id === b0.id)!;
assert(committed.targetId === "P", "bot never turned to its attacker after the startle");

// vx/vz are always present in the snapshot (never stranded by a continue)
const lastSnap = [...h.fanned].reverse().find((m) => m.event === "s" && m.from === b0.id);
assert(lastSnap && typeof lastSnap.payload.vx === "number" && typeof lastSnap.payload.vz === "number", "snapshot missing vx/vz (stranded)");

done();
```

- [ ] **Step 7: Run + commit**

Run: `corepack pnpm -C server exec tsx test/reaction.test.ts` → `PASS`; `tsc --noEmit` clean. Grep `grep -n "wasCalm\|reactT\|pendingTargetId\|DEFENSIVE_FLINCH" server/src/ws/bots.ts`. Manually confirm **no new `continue`** was added in the per-bot loop.
```bash
git add server/src/ws/bots.ts server/test/reaction.test.ts
git commit -m "feat(bots): skill-scaled reaction latency before first reaction (edge-seeded, guarded)"
```

---

### Task 6: Facing slew (no one-tick yaw snap)

**Files:**
- Modify: `server/src/ws/bots.ts` (const `MAX_TURN_RATE`; a `faceToward(b, dx, dz, dt)` helper; replace the hard `b.yaw = Math.atan2(...)` sets in the combat/seek branches with slewed turns)
- Create: `server/test/facing.test.ts`

**Interfaces:**
- Produces: `faceToward(b: ServerBot, dx: number, dz: number, dt: number): void` — rotates `b.yaw` toward `atan2(dz,dx)` capped at `MAX_TURN_RATE*dt`.

- [ ] **Step 1: Add const + helper**

```ts
const MAX_TURN_RATE = 8; // rad/s yaw slew cap — a one-tick 180° snap reads as net-lag, not reflex

  /** Rotate b.yaw toward the heading (dx,dz), capped at MAX_TURN_RATE this tick. */
  private faceToward(b: ServerBot, dx: number, dz: number, dt: number): void {
    const want = Math.atan2(dz, dx);
    let d = want - b.yaw;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    const max = MAX_TURN_RATE * dt;
    b.yaw += Math.max(-max, Math.min(max, d));
  }
```

- [ ] **Step 2: Slew instead of snap in the combat + seek branches**

Replace `b.yaw = Math.atan2(dz, dx);` in the ENGAGE branch (909) and the SEEK_ITEM branch (891) with `this.faceToward(b, dx, dz, dt);`. Leave the charging hard-face (`integrateCharging` 1177) and dash-face (`startDash` 620) as instant — those are intentional commitments.

- [ ] **Step 3: Write the test**

Create `server/test/facing.test.ts`:

```ts
import { makeHarness, assert, done } from "./_bot-harness.ts";
const ROOM = "voxelcube-ffa";
const MAX_TURN_RATE = 8, dt = 0.05;

const h = makeHarness({ players: [{ id: "P", x: 0, z: 0 }] });
for (let i = 0; i < 20; i++) h.sim.tick(ROOM, dt);
// track per-tick yaw delta of every bot; none may exceed the cap (+ tiny epsilon)
let prev = new Map(h.inspect().map((b) => [b.id as string, b.yaw as number]));
let maxStep = 0;
for (let i = 0; i < 40; i++) {
  h.sim.tick(ROOM, dt);
  for (const b of h.inspect()) {
    const p = prev.get(b.id as string);
    if (p != null && b.alive) {
      let d = Math.abs((b.yaw as number) - p);
      if (d > Math.PI) d = 2 * Math.PI - d;
      maxStep = Math.max(maxStep, d);
    }
    prev.set(b.id as string, b.yaw as number);
  }
}
assert(maxStep <= MAX_TURN_RATE * dt + 1e-6, `yaw snapped ${maxStep.toFixed(3)} rad in one tick (> cap ${(MAX_TURN_RATE*dt).toFixed(3)})`);
done();
```

- [ ] **Step 4: Run + commit**

Run: `corepack pnpm -C server exec tsx test/facing.test.ts` → `PASS`; `tsc --noEmit` clean.
```bash
git add server/src/ws/bots.ts server/test/facing.test.ts
git commit -m "feat(bots): slew facing at MAX_TURN_RATE instead of one-tick yaw snap"
```

---

### Task 7: Miss by a direction (cosmetic, display-only)

**Files:**
- Modify: `server/src/ws/bots.ts` (`fire` 1396–1421; const `MISS_SPREAD_RAD`)
- Create: `server/test/miss.test.ts`

- [ ] **Step 1: Add const + deflect the tracer on a miss**

`const MISS_SPREAD_RAD = 0.18; // ≈10° max cosmetic miss deflection (random sign + magnitude)`

In `fire()`, after `const hits = rand() <= b.accEff;` and BEFORE building the `"shot"` payload's `dir`, deflect only on a miss. Compute the base `dir` as today, then:

```ts
    if (!hits) {
      // target lateral angular speed estimate (0 for bot targets → uniform floor)
      const angSpeed = Math.min(1, Math.hypot(tgt.vx, tgt.vz) / 8);
      let aimErr = (1 - b.skill) * MISS_SPREAD_RAD * (0.5 + angSpeed);
      aimErr = Math.min(aimErr, 1.5 * MISS_SPREAD_RAD);          // clamp absurd deflection
      const a = (rand() < 0.5 ? -1 : 1) * aimErr * (0.3 + rand() * 1.4); // random sign + magnitude
      const ca = Math.cos(a), sa = Math.sin(a);
      const rx = dir.x * ca - dir.z * sa, rz = dir.x * sa + dir.z * ca;
      dir.x = rx; dir.z = rz;
    }
```

(Keep this strictly after `hits` is decided and BEFORE the `fanout("shot", …)`; misses never carry `targetId`, so the netcode anchoring + `enqueueHit` path is untouched.)

- [ ] **Step 2: Write the test**

Create `server/test/miss.test.ts`:

```ts
import { makeHarness, assert, done } from "./_bot-harness.ts";
const ROOM = "voxelcube-ffa";

// Drive many shots at a strafing player; collect "shot" dir angles and whether targetId is set.
const h = makeHarness({ players: [{ id: "P", x: 6, z: 0, grounded: true }] });
for (let i = 0; i < 200; i++) {
  h.setPlayers([{ id: "P", x: 6, z: (i % 2 ? 3 : -3) }]); // jitter so vx/vz estimate is nonzero
  h.sim.tick(ROOM, 0.05);
}
const shots = h.fanned.filter((m) => m.event === "shot");
assert(shots.length > 20, `too few shots: ${shots.length}`);
// hits carry targetId and point ~straight; misses carry none and vary in sign
const misses = shots.filter((m) => m.payload.targetId == null);
const signs = new Set(misses.map((m) => Math.sign(Math.atan2(m.payload.dir.z, m.payload.dir.x))));
assert(misses.length > 5, "no misses observed");
assert(signs.size >= 2 || misses.length < 8, "miss deflection has only one sign (formulaic)");
assert(shots.every((m) => typeof m.payload.dir.x === "number"), "shot dir malformed");
done();
```

- [ ] **Step 3: Run + commit**

Run: `corepack pnpm -C server exec tsx test/miss.test.ts` → `PASS`; `tsc --noEmit` clean.
```bash
git add server/src/ws/bots.ts server/test/miss.test.ts
git commit -m "feat(bots): miss tracers deflect by a random direction (display-only)"
```

---

### Task 8: Real kill feed (bot↔bot frags + streaks)

**Files:**
- Modify: `server/src/ws/bots.ts` (`ServerBot`: add `kills`, `streak`; `spawnBot`/`respawn` init — preserve `kills`, reset `streak`; `resolveShot` 1454–1464; `resolveSuper` 1308–1316; death paths `damageBot` 346–350 + `killBot` 382–389; `rosterMembers` 317)
- Create: `server/test/killfeed.test.ts`

- [ ] **Step 1: Add fields + init/reset semantics**

`ServerBot`: add `kills: number;` and `streak: number;`. In `spawnBot` literal: `kills: 0, streak: 0,`. In `respawn`: `b.streak = 0;` (do **not** reset `kills` — lifetime frags survive). `rosterMembers` meta: change `kills: 0` to `kills: b.kills`.

- [ ] **Step 2: Increment killer + reset victim, emit capped streak**

In `resolveShot` (and the same in `resolveSuper`), on `res.died`, before the `kill` fanout:

```ts
      b.kills += 1;
      b.streak += 1;
```

and change the `kill` payload `streak: 0` to `streak: Math.min(b.streak, 2)` (so bot farming never trips the client `>=3` rampage banner).

In `damageBot`, in the death branch (`b.health <= 0`), reset the **victim** streak: `b.streak = 0;`. In `killBot`, before returning the died result: `b.streak = 0;` (victim only — a player killer is surfaced client-side, no killer increment here).

- [ ] **Step 3: Write the test**

Create `server/test/killfeed.test.ts`:

```ts
import { makeHarness, assert, done } from "./_bot-harness.ts";
const ROOM = "voxelcube-ffa";

const h = makeHarness({ players: [{ id: "P", x: 0, z: 0 }] });
for (let i = 0; i < 5; i++) h.sim.tick(ROOM, 0.05);
const ids = h.inspect().map((b) => b.id as string);
const [killer, victim] = ids;

// drive the victim to death by repeated bot→bot damage from `killer`
let killEvt: any = null;
for (let i = 0; i < 12 && !killEvt; i++) {
  const before = h.fanned.length;
  h.sim.damageBot(ROOM, victim, killer);
  killEvt = h.fanned.slice(before).find((m) => m.event === "kill");
}
assert(killEvt, "no kill feed line emitted for a bot→bot frag");
assert(killEvt.payload.streak <= 2, `streak not capped at 2: ${killEvt.payload.streak}`);
const k = h.inspect().find((b) => b.id === killer);
assert((k!.kills as number) >= 1, "killer kills not incremented");
const v = h.inspect().find((b) => b.id === victim);
assert((v!.streak as number) === 0, "victim streak not reset on death");
done();
```

- [ ] **Step 4: Run + commit**

Run: `corepack pnpm -C server exec tsx test/killfeed.test.ts` → `PASS`; `tsc --noEmit` clean.
```bash
git add server/src/ws/bots.ts server/test/killfeed.test.ts
git commit -m "feat(bots): real kill feed — bot frags + streaks (rampage-capped)"
```

---

### Task 9: Super hesitation (slot-safe)

**Files:**
- Modify: `server/src/ws/bots.ts` (`ServerBot`: add `superHesitateT`; consts `SUPER_HESITATE_MIN/SPAN`; super entry gate 996–1008; `abortSuper` 1162; `staggerBot` 361–379; decrement near 734 gated by `stunT`; `spawnBot`/`respawn` init)
- Create: `server/test/super-hesitate.test.ts`

- [ ] **Step 1: Add field + constants**

`ServerBot`: add `superHesitateT: number;`. Init `superHesitateT: 0` in `spawnBot`; `b.superHesitateT = 0` in `respawn`. Consts:

```ts
const SUPER_HESITATE_MIN = 0.15, SUPER_HESITATE_SPAN = 0.35; // 0.15..0.50s, skill-scaled
```

- [ ] **Step 2: Hesitate then commit unconditionally at the super entry gate (996–1008)**

Replace the immediate `b.kameCharging = true; ...` with a two-step hesitation. When all entry conditions hold:

```ts
        if (b.superHesitateT <= 0 && !b._superArmed) {
          b.superHesitateT = SUPER_HESITATE_MIN + (1 - b.skill) * SUPER_HESITATE_SPAN;
          b._superArmed = true; // hesitation started (one-shot)
        } else if (b.superHesitateT <= 0 && b._superArmed) {
          b.kameCharging = true; b.kameChargeT = 0; b.superTargetId = tgt.id; b._superArmed = false;
        }
```

Add `_superArmed: boolean;` to `ServerBot` (init false). Decrement in the timer block (gated by stun): `if (b.stunT <= 0 && b.superHesitateT > 0) b.superHesitateT = Math.max(0, b.superHesitateT - dt);`

> A failed/maybe condition is simply that the gate stops being entered → clear (next step). Never a repeating commit-roll that holds the slot.

- [ ] **Step 3: Clear hesitation when no longer eligible / on abort / on stagger / on respawn**

Add a `clearHesitate(b)` inline: set `b.superHesitateT = 0; b._superArmed = false;`. Call it:
- at the top of the super-gate's `else` (when `maySuper`/range/grounded/HP/target conditions are NOT met),
- inside `abortSuper`,
- inside `staggerBot` (even when not yet charging — a saber stagger interrupts a hesitating bot),
- in `respawn`.

- [ ] **Step 4: Write the test**

Create `server/test/super-hesitate.test.ts`:

```ts
import { makeHarness, assert, done } from "./_bot-harness.ts";
const ROOM = "voxelcube-ffa";

// A player parked in close range should eventually draw a super telegraph ("kame"),
// proving the hesitation commits and never permanently holds the slot.
const h = makeHarness({ players: [{ id: "P", x: 3, z: 0 }] });
let sawHesitate = false, sawKame = false;
for (let i = 0; i < 800; i++) { // long enough for superCd to elapse
  h.sim.tick(ROOM, 0.05);
  if (h.inspect().some((b) => (b.superHesitateT as number) > 0)) sawHesitate = true;
  if (h.fanned.some((m) => m.event === "kame")) { sawKame = true; break; }
}
assert(sawHesitate, "no bot ever entered super hesitation");
assert(sawKame, "hesitation never resolved into a fired super (slot held forever)");
done();
```

- [ ] **Step 5: Run + commit**

Run: `corepack pnpm -C server exec tsx test/super-hesitate.test.ts` → `PASS`; `tsc --noEmit` clean.
```bash
git add server/src/ws/bots.ts server/test/super-hesitate.test.ts
git commit -m "feat(bots): super hesitation (skill-scaled, slot-safe, stagger-interruptible)"
```

---

### Task 10: Docs + final verification (inegociável)

**Files:**
- Modify: `docs/systems/server-bots-ai.md`
- Create/Modify: `docs/balance-log.md`
- Modify: `docs/README.md` (only if keywords change)

- [ ] **Step 1: Update the domain doc**

In `docs/systems/server-bots-ai.md`: update the code-map + constants tables for the new per-bot identity model (`skill`/`accEff`/`cadenceMul`/`leadMul`/`reactT`/`pendingTargetId`/`commitT`/`superHesitateT`/`kills`/`streak`), equal-by-distance targeting + the `PLAYER_PULL` floor, the `[3,6]` room-lifetime population (reset in `clearRoom`), `genHandle` names, the three texture items, `MAX_TURN_RATE` facing slew. Add a "Known surviving tell" note: shared movement kinematics (per-bot `moveStyle` deferred).

- [ ] **Step 2: Append to the balance log**

In `docs/balance-log.md` (create with a header if absent), log: population `[3,6]` flat; per-bot accuracy spread (3.1×, **+2.3% mean DPS** drift accepted, not compensated — within cadence RND); reaction latency 150–300ms; super hesitation 0.15–0.50s; rationale = realism via the megabrain council (cite the spec).

- [ ] **Step 3: Full gate + by-the-wire smoke**

```bash
corepack pnpm -C server exec tsc --noEmit
corepack pnpm build:server
for t in skill names population targeting reaction facing miss killfeed super-hesitate; do \
  corepack pnpm -C server exec tsx test/$t.test.ts || break; done
```
Expected: tsc clean, build OK, every harness prints `PASS`.

Optional live smoke (needs a running dev server): `pnpm dev:server` then `RUN_MS=30000 node server/test/hit-sync-harness.mjs` — confirm hit-sync deltas unchanged (this work must not regress Phase 1/2/4).

- [ ] **Step 4: Commit**

```bash
git add docs/systems/server-bots-ai.md docs/balance-log.md docs/README.md
git commit -m "docs(bots): document realism model (skill/reaction/targeting/population/names) + balance log"
```

---

## Self-Review (done while writing — notes for the implementer)
- **Spec coverage:** all 8 spec changes + the 4 council blockers map to tasks — skill (T1), names (T2), population+clearRoom (T3), equal-targeting+commit+PLAYER_PULL (T4), reaction+wasCalm+guards+split-dodge (T5), yaw-slew (T6), miss (T7), kill feed (T8), super hesitation slot-safety (T9), docs (T10).
- **Type consistency:** field names are identical across tasks and `inspect()` (`reactT`, `pendingTargetId`, `commitT`, `superHesitateT`, `kills`, `streak`, `skill`, `accEff`, `cadenceMul`, `leadMul`). The harness factory `makeHarness` and `inspect()` shape are fixed in T1 and reused unchanged.
- **No `continue` added** in the per-bot loop (T5) — gates are conditional guards so `vx/vz` always integrate.
- **DPS decision:** accept + log the +2.3% (do NOT touch owner-locked `SHOOT_CD_MIN`); the dead `[0.18,0.42]` clamp is dropped in `deriveSkill` (T1).
- **Deferred (not in any task, by design):** per-bot `moveStyle`, per-tick aim-noise, panic state, per-respawn skill jitter, avatar tint, burst-fire, live churn, arena cover.
