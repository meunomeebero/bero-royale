# Multiplayer bot realism — design spec

**Date:** 2026-06-25 · **Area:** `server/src/ws/bots.ts` (`BotSim`) · **Domain doc to update:** `docs/systems/server-bots-ai.md`
**Status:** revised after a megabrain council review (2 × GLM 5.2 external + 4 Claude lenses + neutral judge). Verdict: *proceed-with-changes*. See "Council revisions" below.

## Context & goal
Bero Royale is early — few real users. The server bots exist to make a near-empty lobby look
**populated** and keep a lone early adopter playing. Today they read as *bots*: one shared
`ACCURACY=0.3` (clone army), frame-perfect omniscient retaliation, hard player-first targeting
(they drop a duel to chase you the instant you approach), kid-name list, and a fixed
fill-to-10/cap-5 population. This spec makes them read as a lobby of **distinct, imperfect humans**
who fight *each other* and treat you as just another player.

Server-authoritative architecture is **immovable**: bots sim server-side at 20 Hz (50 ms tick),
broadcast as pseudo-players; shooting is **hitscan + a travelling visual tracer** (no projectile
physics); damage is scheduled "on arrival" via the existing impact-tick queue. Flat 60×60 arena,
no cover/geometry. The owner-locked *population-average* feel constants (`ACCURACY=0.3`,
`SHOOT_CD_*`, `LEAD_FACTOR`, `SUPER_*`) stay centered — per-bot variance spreads *around* them.

## Council revisions (2026-06-25) — what the review changed
- **🔶 OWNER DECISION — "pure-equal" softened to "equal + a player-attention floor."** The judge
  *simulated* nearest-enemy targeting on the real arena: a lone **passive** player (not shooting) is
  targeted by **zero bots ~29% of the time**, invariant to bot count (29.1% @3 … 28.8% @6). That
  breaks the headline goal ("keep the lone player engaged"). Fix: a *bounded* `PLAYER_PULL` bias
  applied **only when a player currently has zero bots targeting it** — bots still brawl each other
  in the common case; a neglected human reliably draws aggression within one commit cycle. This is
  the one change that deviates from the literal "fully equal" you asked for; everything else is
  mechanical. (GLM's "raise the bot floor to [4,6]" was *rejected* — proven not to help.)
- **4 blockers fixed** (state-machine / netcode correctness, below): population re-roll trigger,
  the `reactT` seed being dead-on-arrival, the pacifism floor, and `commitT` ghost-chase/flinch.
- **Pulled in (cheap, required for the reaction change to land):** **yaw-slew** (`MAX_TURN_RATE`) so a
  reaction/retarget doesn't *snap* facing in one tick (which would read as net-lag, not reflex), and a
  **shorter defensive-dodge gate** so a flanked bot isn't inert for 300 ms.
- **Corrected numbers:** skill DPS spread is **3.1×** (not GLM's 3.9× — the clamp never fires);
  covariance lifts mean DPS **+2.3%** (the spec's "mean unchanged" claim was false for the *product*).
- **Acknowledged surviving tell:** shared movement kinematics (identical orbit/dash/jump across all
  bots) is now the *loudest* remaining tell. Per-bot `moveStyle` is **consciously deferred** (YAGNI for
  a 3–6 lobby a solo player watches a couple of bots in), not an oversight.

## Locked decisions
- **Targeting:** equal-by-distance (players and bots are identical "enemies"; no player-first, no
  cross-tier preempt) **+ a bounded player-attention floor** (`PLAYER_PULL`, see Change 3) so a lone
  passive player is never ignored. Retaliation stays (and now also fires on bot attackers). Commitment
  stops equidistant-target ping-pong.
- **Population:** roll a held random int in **[3,6]** when the room is created/activated; hold it for
  the **room lifetime**; flat regardless of real-player count; re-roll only on true room teardown.
- **Names:** procedural gamer-handle generator (≈50/50 BR-PT slang + anime/English, per-name leet),
  in-room unique, **~30–40 % plain handles** for real style variance. No blocklist for now.
- **Per-bot skill:** one persistent `skill∈[0,1]` (modest, center-biased spread) drives accuracy,
  cadence and aim-lead. Preserved across respawn (a person keeps their reputation).
- **Reaction latency:** **150–300 ms** skill-scaled startle before the first *offensive* reaction to
  new combat info; defensive juke un-gates within ~120 ms; facing slews, never snaps.
- **Texture (all server-only):** miss-by-a-direction, real kill feed, super hesitation.
- **Deferred (out of scope):** avatar tint, burst-fire, per-bot `moveStyle`, per-tick aim-noise, panic
  state, per-respawn skill jitter, live join/leave churn, arena cover.

## New per-bot state (`ServerBot`) + new constants
Add **all** of these to BOTH the `ServerBot` interface (212–259) AND the `spawnBot` object literal
(457–482) — `rosterMembers` (317) reads `kills`, so an uninitialised field ships `undefined` over the
wire.

| Field | Meaning | `respawn` |
|---|---|---|
| `skill: number` | persistent 0..1, rolled once `(rand()+rand())/2` (center-biased) | **preserve** |
| `accEff` / `cadenceMul` / `leadMul: number` | cached derived feel (from skill) | **preserve** |
| `reactT: number` | >0 = startle window | reset `0` |
| `pendingTargetId: string \| null` | attacker stashed during `reactT`, committed on expiry | reset `null` |
| `commitT: number` | >0 = fixated on current `targetId` | reset `0` |
| `superHesitateT: number` | >0 = deciding whether to open a super | reset `0` |
| `kills: number` | lifetime frags (cosmetic identity) | **preserve** |
| `streak: number` | current kill streak (feed) | reset `0` |

`name` is already preserved by `respawn`. Derived caches recomputed in a `deriveSkill(b)` helper from
`spawnBot`/`respawn`:
```
accEff     = ACCURACY * (0.7 + 0.6*skill)     // E≈0.300 at E[skill]=0.5; raw range [0.21,0.39]
cadenceMul = 1.25 - 0.5*skill                  // weak=1.25 (slower), sharp=0.75; E=1.0
leadMul    = 0.5 + skill                        // weak=0.5 (under-leads), sharp=1.5; E=1.0
```
> **DPS invariant.** `accEff` and `cadenceMul` both rise with skill → their *ratio* (which drives TTK)
> has +2.3 % positive covariance: `E[accEff/cadenceMul]=0.307` vs baseline `0.30`. Best/worst spread is
> **3.1×**. Compensate with `SHOOT_CD_MIN += ~0.012s` **or** accept + log the +2.3 % in `balance-log.md`
> (it's within the existing cadence RND). A unit assertion `mean(accEff over skill dist) ≈ ACCURACY`
> guards a future `ACCURACY` retune. The old `clamp(…,0.18,0.42)` never fires at `ACCURACY=0.3` — keep
> it only as a forward safety-rail (document that it's inert today) or drop it.

New constants (near the existing tune blocks):
```
MAX_TURN_RATE = 8          // rad/s yaw slew cap on facing changes (no one-tick snap)
REACT_MIN = 0.15, REACT_SPAN = 0.15        // reactT = REACT_MIN + (1-skill)*REACT_SPAN → 0.15..0.30s
DEFENSIVE_FLINCH = 0.12    // defensive dash/jump un-gate at min(reactT, DEFENSIVE_FLINCH)
COMMIT_MIN = 0.8, COMMIT_SPAN = 0.8        // commitT = COMMIT_MIN + (1-skill)*COMMIT_SPAN → 0.8..1.6s
MISS_SPREAD_RAD = 0.18 (≈10°)              // max cosmetic miss deflection (random sign + magnitude)
SUPER_HESITATE_MIN = 0.15, SUPER_HESITATE_SPAN = 0.35     // 0.15..0.50s
```

---

## Change 1 — Population: held random [3,6], flat, room-lifetime
**Code:** `tick()` population block (633–646); `clearRoom` (444–446); `MAX_BOTS`/`MIN_COMBATANTS`.
Add `private targetBotCount = 0` to `BotSim`. When `live>0` and `targetBotCount===0`, roll
`targetBotCount = 3 + Math.floor(rand()*4)` and hold it. While `live>0`, `desired = targetBotCount`,
independent of player count. Set `MAX_BOTS=6`, retire `MIN_COMBATANTS`. Keep the spawn/delete loops +
presence broadcast.
> **Blocker fix — re-roll trigger.** The reset must live in **`clearRoom`** (the room-teardown path
> that runs from `rooms.ts sweepExpired`), **not** in `tick()` observing `live===0`. The bot loop is
> presence-gated (`stopBotLoopIfIdle`, index.ts 361-371) — `tick()` does **not** run while `live===0`,
> so a `desired=0`-on-empty branch is dead code in the real disconnect/grace path. Reset
> `targetBotCount=0` inside `clearRoom(GAME_ROOM)`. "Session" = room lifetime: a **grace reconnect
> preserves** the held count (no mid-session re-roll); only a true teardown re-rolls. Keep a
> `live===0 → desired=0` branch in `tick` as belt-and-suspenders only.

## Change 2 — Procedural gamer-handle names
**Code:** replace `NAMES` (203–210) + the used/free pick in `spawnBot` (452–454). New pure
`genHandle(rand)` (duplicated into `bots.ts` — same as `BULLET_SPEED`; runs **at spawn only**, never
per-tick).
- **Vocab buckets:** `ptBrNoun` (destruidor, mlk, quebrada, mundos, lenda, monstro, treta, capeta,
  demonio, bicho, fera), `ptBrConnector` (de/do/da/das), `animeEng` (sasuke, goku, naruto, itachi,
  kakashi, zoro, luffy, void, ghost, shadow, reaper, slayer, dark, neo, kira), `proWord` (pro, god,
  king, master, op, gg, no1, real).
- **Join patterns (weighted):** `noun_conn_noun+bigNum`, `xX+anime_pro+Xx`, `noun_conn_noun+num2`,
  `(anime|noun)+num3`, `anime+proWord(+num2)`, **plus ~30–40 % PLAIN** handles (single word, no
  number / leet / wrap) so the lobby's *style variance* matches a real one.
- **Numbers:** `bigNum` = any 3–5 digits (not only round); `num2` = 00–99; `num3` meme set (420, 69,
  777, 666, 1337, 007). Mostly lowercase; xX-wrap keeps literal caps.
- **Leet:** randomized **per name** — sometimes `a→4/e→3/i→1/o→0/s→5`, sometimes none (not a uniform
  cipher across the lobby).
- **Uniqueness:** in `spawnBot`, a bounded loop (~8×) re-checks against all live bot names and
  regenerates **from a different pattern bucket** on collision (never a digit-bump — `void420→void421`
  reads as one player); require a distinct visible stem. `respawn` keeps the name. **Animal-dedupe is
  REQUIRED** (not optional) for a 3–6 lobby — no two identical untinted avatars. Keep `ANIMAL_NAMES`.

## Change 3 — Targeting: equal-by-distance + player floor + commitment + retaliate-on-bots
**Code:** rewrite the TARGET SELECTION block (774–820).
- Drop the players-only filter (795) and `crossTierPreempt` (787)+`curIsPlayer` tier logic → nearest
  enemy treats players and bots identically.
- Retaliation (814–820): drop the `isPlayerId(atk.id)` gate (816) so a bot also snaps to a **bot** that
  shot it.
- **🔶 Player-attention floor (the pure-equal softening) — REVISED by council during impl:** a
  single **post-pass** runs once per tick *after* the per-bot loop: any player with **zero** bots
  targeting it gets the **nearest strictly-free (`commitT<=0`) bot directly assigned** (commit
  re-seeded). A **steal-guard** skips a free bot that is the sole targeter of another player. This
  *guarantees* a neglected lone player draws one bot (matching the product promise "send the closest
  free bot toward them"), not a probabilistic nudge — the original `PLAYER_PULL≈5u` distance bias
  empirically left ~19–24 % ignored on the ±42 arena (a 5u bias rarely flips a 40–60u nearest choice)
  and is **removed**. Per-bot selection stays pure nearest-enemy (no bias, no per-bot allocation).
  Result: lone-player-untargeted ~29 % → **0.6 %**. Organic downtime still occurs when all bots are
  committed elsewhere.
- **Commitment (`commitT`)** — *blocker-hardened*: `commitT` is **bound to the current `targetId`** and
  re-seeded on every id **change** from **any** path (selection, retaliation, pending-commit), **never**
  on a same-id re-confirm (else it never decays and the hysteresis path is unreachable). While
  `commitT>0`, skip the nearest-repick **only if** `curTgt` is present this tick **and** within
  `SHOOT_RANGE+leash`; a **null `curTgt`** (died / disconnected / removed) **always force-breaks**
  `commitT` and repicks (no 1.6 s ghost-chase / frozen bot). Keep `TARGET_SWITCH_HYSTERESIS` as the
  same-distance tiebreak once `commitT` expires.

> **Engager-cap scope (corrected).** The engager-cap + per-player super-slot pre-pass (690–724, gate
> 831) is **player-keyed only** — a bot targeting another **bot is always an uncapped engager** with no
> super-slot. So bot-vs-bot stays **uncapped**. With 14–22 s super cooldowns in a 3–6 lobby, overlapping
> bot-on-bot supers are rare; revisit only if visual testing shows chaos. (The earlier spec claim that
> the cap "fairly caps bots piling on another bot" was false.)

## Change 4 — Per-bot skill scalar (keystone)
**Code:** seed `skill`+caches in `spawnBot` (457–482); `deriveSkill` recompute in `respawn` (485–520).
- `fire()` accuracy roll (1408): `rand() <= b.accEff`.
- `fire()` lead (1400) + `fireSuper()` lead (1248): `LEAD_FACTOR * b.leadMul`.
- cadence reset (959): `(SHOOT_CD_MIN + rand()*SHOOT_CD_RND) * b.cadenceMul * rapidMult`.
- Apply the +2.3 % DPS compensation + the `mean(accEff)≈ACCURACY` unit assertion (see DPS invariant).

## Change 5 — Reaction latency + facing slew (omniscience killer, no new lag-tell)
**Code:** seed/decay `reactT`, `pendingTargetId`; yaw slew. **All gates are GUARDS around the
`fire`(949)/`dash`(965)/`jump`(980) conditionals — NEVER an early `continue`.** The
steering→`zeroOnWall`→`fanout` tail (1058–1106) **must run every tick** so `snapshot.vx/vz` stays a
truthful dead-reckon vector (a `continue` strands velocity → client wall-clip/teleport).
- **Seed edge-only.** In `damageBot`, capture `const wasCalm = b.threat <= 0;` **at the top, BEFORE**
  line 334 sets `threat=THREAT_DECAY`; seed `reactT`/stash `pendingTargetId` only if `wasCalm`.
  (Otherwise the `threat<=0` guard always reads false and `reactT` is *never* seeded — the whole
  startle silently no-ops.) Never re-seed under sustained fire (edge-only prevents an indefinite stall).
- **Decay** `reactT` in the per-bot timer block (~734).
- **Commit with a liveness check.** When `reactT<=0`, commit `pendingTargetId → targetId` **only if**
  that id is still a live enemy within `SHOOT_RANGE+leash` this tick; else `pendingTargetId=null` and
  fall through to a normal repick. Clear `pendingTargetId` if `reactT` re-seeds for a *different*
  attacker. (Committing to a dead/absent id → catatonic bot, paired with the `commitT` force-break.)
- **Split the gate.** Gate **FIRE + retarget** by the full `reactT` (the offensive startle = the design
  intent: a flank lands for 150–300 ms). Gate the **defensive** dash/jump by `min(reactT,
  DEFENSIVE_FLINCH=0.12s)` so a flanked bot starts juking within ~120 ms and never reads as AFK.
- **Targetless reactT bot** (idle, shot from nowhere): allow **evasive steering away from the
  last-known attacker** (steering only, no fire) so it isn't a frozen statue.
- **Facing slews, never snaps.** On any facing change (reactT commit, retarget), **slew `yaw` toward
  the new heading at `MAX_TURN_RATE` (~8 rad/s) over 2–4 ticks** instead of the current one-tick hard
  set (909). A one-tick 90–180° whip reads as net-lag — i.e. it would trade an omniscience tell for a
  lag tell. This is the single highest-ROI realism add and is *required* for the reaction change to
  land cleanly.
- `reactT = REACT_MIN + (1-skill)*REACT_SPAN` (0.15–0.30 s; naturally quantized by the 20 Hz decay).

## Change 6 — Miss by a direction (texture, display-only)
**Code:** `fire()` (1400–1421). On a **miss** (`!hits`) only, rotate the cosmetic `dir` by
`aimErr = clamp((1-skill) * MISS_SPREAD_RAD * (0.5 + targetAngularSpeedTerm), 0, 1.5*MISS_SPREAD_RAD)`
with a **random sign and magnitude jitter**: `dir` rotated by `±aimErr*(0.3 + rand()*1.4)`. On a hit,
`dir` stays tight. Bot targets have `vx/vz=0` (fire treats bots as stationary) → their miss term is the
uniform floor (cosmetic, accepted). **Strictly post-`hits`/post-`targetId`** — never touches
`applyAt`/`enqueueHit`/`resolveShot` or the `hitsPlayer` anchoring (misses carry no `targetId`), so
netcode hit-sync is untouched, zero balance impact.

## Change 7 — Real kill feed (texture, display-only)
**Code:** `resolveShot` (1454–1464), `resolveSuper` (1308–1316), death paths (`damageBot` 346–350,
`killBot` 382–389), `rosterMembers` (317).
- On `res.died`: `resolveShot`/`resolveSuper` increment **killer** `b.kills`+`b.streak`.
- **Reset the victim bot's `streak` ONLY in the death branches** (`damageBot` `health<=0`, `killBot`) —
  never on a non-lethal hit (else a glancing hit wipes a wounded bot's streak). `killBot` resets the
  victim with **no** killer increment (a player killer is surfaced client-side).
- **Emit `min(streak, 2)` for bot kills** so bot-vs-bot farming (frequent under equal targeting) never
  trips the client's `streak>=3` **full-screen rampage banner** — a celebration spotlighting two AI
  handles is the opposite of blending in.
- `rosterMembers` meta `kills:0 → b.kills`. Streak is cosmetic only — never fed into difficulty.

## Change 8 — Super hesitation (texture, slot-safe)
**Code:** SUPER entry gate (996–1008); `abortSuper` (1162); `staggerBot` (361); `respawn`.
On the first tick all super conditions hold, set `superHesitateT = SUPER_HESITATE_MIN +
(1-skill)*SUPER_HESITATE_SPAN`; **gate the decrement behind `stunT<=0`**; when `<=0`, **flip
`kameCharging` unconditionally** (a hesitation is a one-shot delay, NOT a repeating commit-roll that
could hold the per-player super slot while telegraphing nothing → a pacifism tell). **Clear
`superHesitateT`** the instant any entry condition fails (`maySuper` lost / target switch / out of
range / not grounded / too hurt), in `abortSuper`, in `staggerBot` (even when not yet charging — a
saber stagger must interrupt a *hesitating* bot too), and in `respawn`. No change to
`SUPER_DAMAGE`/`SUPER_CHARGE`/the dodge gate.

---

## Non-goals (explicitly deferred — conscious risk, not oversight)
- **Per-bot `moveStyle`** (orbit-radius / dash / jump / strafe perturbation) — **the loudest surviving
  tell** after this spec (all bots share movement kinematics; a mirror-dance is visible when two bots
  duel). Deferred for a 3–6-bot early lobby a solo player mostly watches one or two bots in; revisit
  next iteration. Yaw-slew (Change 5) is the one movement fix pulled in now.
- Per-tick aim-noise on sustained-fire facing; panic-state during `reactT`; per-respawn `formNoise`
  (frozen per-session skill is an *accepted* tradeoff of the "reputation" design goal); avatar tint
  (client change); burst-fire cadence; live join/leave churn; arena cover; sub-tick reactT jitter.

## Testing & verification
- **Gates:** `corepack pnpm -C server exec tsc --noEmit` + `pnpm build:server` green.
- **By-the-wire (mega-brain lesson #4):** a synthetic WS client validates deterministically:
  population settles to the rolled [3,6] and **survives a grace reconnect** (no re-roll); names unique
  + match patterns + show plain/handle variance; a bot shot from behind does **not** return fire on the
  same tick **but** starts juking within ~120 ms and is **not** catatonic (reactT guards, not
  `continue`); facing **slews** (no one-tick 180° snap); two equidistant enemies don't cause
  per-`RETARGET_CD` ping-pong, and a removed target **force-breaks** `commitT` (no frozen bot); a lone
  **passive** player is targeted within a commit cycle (player floor); accuracy/cadence visibly differ
  across bots; kill-feed shows bot↔bot frags with real streaks **capped at 2**; a hesitating bot can be
  saber-interrupted. Verify **presence of each change by grep** (mega-brain lesson #2), not just tsc.
- **Feel:** a short headed-browser session against the running server.

## Docs to update (inegociável)
- `docs/systems/server-bots-ai.md` — per-bot identity model (skill/reaction/commit/yaw-slew),
  equal-by-distance + player floor, the [3,6] room-lifetime population, the name generator, texture
  items; refresh the constants/code-map tables; note the surviving movement-clone tell.
- `docs/balance-log.md` — log the population, accuracy-spread (3.1×, +2.3 % DPS, compensation choice),
  reaction-latency and super-hesitation tuning with rationale (create if absent).
- `docs/README.md` index line if keywords change.
