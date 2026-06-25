# Multiplayer bot realism — design spec

**Date:** 2026-06-25 · **Area:** `server/src/ws/bots.ts` (`BotSim`) · **Domain doc to update:** `docs/systems/server-bots-ai.md`

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
`SHOOT_CD_*`, `LEAD_FACTOR`, `SUPER_*`) stay centered — per-bot variance spreads *around* them, it
does not shift the mean.

## Locked decisions
- **Targeting:** pure-equal. Nearest enemy, players and bots identical. No player-first, no
  cross-tier preempt. Retaliation stays (and now applies to bot attackers too). + commitment so
  a bot doesn't ping-pong between equidistant enemies.
- **Population:** roll a held random int in **[3,6]** on the empty→active edge; hold it for the
  session; flat regardless of real-player count; re-roll only after the room empties.
- **Names:** procedural gamer-handle generator (≈50/50 BR-PT slang + anime/English, ~30% leet),
  in-room unique. No blocklist for now (shared with friends/family/followers).
- **Per-bot skill:** one persistent `skill∈[0,1]` (modest, center-biased spread) drives accuracy,
  fire cadence and aim-lead. Preserved across respawn (a person keeps their reputation).
- **Reaction latency:** **150–300 ms** skill-scaled startle before reacting to *new* combat info
  only (council 120–300 ∩ GLM 5.2 150–350). First reaction only — never sustained fire.
- **Texture (all server-only, ship all three):** miss-by-a-direction, real kill feed, super
  hesitation.
- **Deferred (out of scope):** avatar color tint (needs a client change), burst-fire cadence,
  movement micro-jitter, live join/leave churn.

## New per-bot state (`ServerBot`) + new constants
Fields added to `ServerBot` (seed in `spawnBot`; `respawn` **preserves `skill`/derived caches +
`name`**, resets the rest):

| Field | Meaning |
|---|---|
| `skill: number` | persistent 0..1, rolled once (`(rand()+rand())/2`, center-biased) |
| `accEff: number` | cached effective accuracy (derived from skill) |
| `cadenceMul: number` | cached fire-cadence multiplier (derived) |
| `leadMul: number` | cached aim-lead multiplier (derived) |
| `reactT: number` | >0 = startle window; suppresses first reaction to new info |
| `pendingTargetId: string \| null` | target chosen but not yet committed (waiting out `reactT`) |
| `commitT: number` | >0 = fixated on current target; skip nearest-repick |
| `superHesitateT: number` | >0 = winding up to *decide* to start a super telegraph |
| `kills: number`, `streak: number` | cosmetic kill-feed counters |

Derived caches (recomputed in a tiny `deriveSkill(b)` helper, called from `spawnBot`/`respawn`):
```
accEff     = clamp(ACCURACY * (0.7 + 0.6*skill), 0.18, 0.42)   // mean ≈0.30 at skill 0.5
cadenceMul = 1.25 - 0.5*skill                                  // weak=1.25 (slower), sharp=0.75
leadMul    = 0.5 + skill                                       // weak=0.5 (under-leads), mean 1.0
```

New constants (grouped near the existing tune blocks):
```
REACT_MIN = 0.15, REACT_SPAN = 0.15      // reactT = REACT_MIN + (1-skill)*REACT_SPAN  → 0.15..0.30s
COMMIT_MIN = 0.8, COMMIT_SPAN = 0.8      // commitT = COMMIT_MIN + (1-skill)*COMMIT_SPAN → 0.8..1.6s
MISS_SPREAD_RAD = ~0.18 (≈10°)           // max cosmetic miss deflection (scaled by 1-skill + target ang. speed)
SUPER_HESITATE_MIN = 0.15, SUPER_HESITATE_SPAN = 0.35   // 0.15..0.50s
SUPER_COMMIT_CHANCE = 0.7                 // per eligible tick after hesitation
```

---

## Change 1 — Population: held random [3,6], flat
**Code:** `tick()` population block (lines 633–646); `MAX_BOTS`/`MIN_COMBATANTS` consts.
Add `private targetBotCount = 0` to `BotSim`. On the empty→active edge (`live` goes 0→≥1, detect via
`targetBotCount===0 && live>0`) roll `targetBotCount = 3 + Math.floor(rand()*4)` and hold it. While
`live>0`, `desired = targetBotCount`, independent of player count. When `live===0`, `desired = 0`
and clear `targetBotCount` (next activation re-rolls). Set `MAX_BOTS=6`, retire the
`MIN_COMBATANTS` arithmetic. Keep the existing spawn/delete while-loops + presence broadcast.

## Change 2 — Procedural gamer-handle names
**Code:** replace `NAMES` array (203–210) + the used/free pick in `spawnBot` (452–454).
New pure `genHandle(rand)` (duplicated into `bots.ts` — server tsup & client vite don't share a
module, same pattern as `BULLET_SPEED`). Structure:
- **Vocab buckets:** `ptBrNoun` (destruidor, mlk, quebrada, mundos, lenda, monstro, treta, capeta,
  demonio, bicho, fera), `ptBrConnector` (de/do/da/das), `animeEng` (sasuke, goku, naruto, itachi,
  kakashi, zoro, luffy, void, ghost, shadow, reaper, slayer, dark, neo, kira), `proWord` (pro, god,
  king, master, op, gg, no1, real), leet map (a→4,e→3,i→1,o→0,s→5; applied to ~30% of handles).
- **Join patterns (weighted):** `noun_conn_noun+bigNum` (destruidor_de_mundos50000),
  `xX+anime_pro+Xx` (xXsasuke_proXx), `noun_conn_noun+num2` (mlk_da_quebrada99),
  `(anime|noun)+num3` (void420), `anime+proWord(+num2)` (shadowgod, neoking7).
- **Numbers:** bigNum biased round (50000, 9999, 1000); num2 = 00–99; num3 meme (420, 69, 777, 666,
  1337, 007); ~70% of handles end in a number. Mostly lowercase; xX-wrap keeps literal caps.
- **Uniqueness:** in `spawnBot`, regenerate up to ~8× on collision with a live bot name; final
  fallback appends/bumps a num2 so two LIVE bots never share a handle (bounded). `respawn` keeps name.
- Keep `ANIMAL_NAMES`; optional **animal-dedupe** in `spawnBot` (free, server-only) so a 3–6 lobby
  doesn't show two identical untinted foxes.

## Change 3 — Targeting: pure-equal + commitment + retaliation-any
**Code:** rewrite the TARGET SELECTION block (774–820).
- Drop the players-only filter (795) and `crossTierPreempt` (787) + `curIsPlayer` tier logic →
  pick nearest enemy treating players and bots identically.
- Retaliation (814–820): drop the `isPlayerId(atk.id)` gate (816) so a bot also snaps to a **bot**
  that just shot it.
- Add `commitT`: seed on a fresh pick; while `commitT>0` skip the nearest-repick **entirely** (not
  just the 1.5u hysteresis) unless the current target died or left `SHOOT_RANGE+leash`. Keep
  `TARGET_SWITCH_HYSTERESIS` as the same-distance tiebreak once `commitT` expires. Retaliation
  remains an override (a bot still turns on a player flanking it → never reads as ignoring you).

> The engager-cap / per-player super-slot anti-dogpile (lines 682–724, 824–833) stays. Under
> pure-equal it now also fairly caps how many bots pile on *another bot*, which is correct.

## Change 4 — Per-bot skill scalar (keystone)
**Code:** seed `skill` + caches in `spawnBot` (457–482), preserve in `respawn` (485–520).
- `fire()` accuracy roll (1408): `rand() <= b.accEff` (was `<= ACCURACY`).
- `fire()` lead (1400) + `fireSuper()` lead (1248): `LEAD_FACTOR * b.leadMul`.
- cadence reset (959): `(SHOOT_CD_MIN + rand()*SHOOT_CD_RND) * b.cadenceMul * rapidMult`.

## Change 5 — Reaction latency (omniscience killer)
**Code:** seed/decay `reactT`; gate the first *reaction*, not navigation.
The intent: a startle beat between *new combat info* and the bot's first aggressive response — so a
flank/ambush lands for 150–300 ms. It gates **outputs**, not steering: a bot still orbits/closes on
a target it already held during the window; it just doesn't instantly shoot back, juke, or whip
around to a new attacker.
- **Seed on rising edge only** (two triggers): in `damageBot` (334) seed `reactT` *only when
  `b.threat<=0`* (a fresh threat, not refreshing an ongoing one); and when the retaliation snap
  would point the bot at a **new** attacker (818) — stash that as `pendingTargetId` instead of
  setting `targetId` now. (Routine nearest-repick is already governed by `commitT`, so no separate
  delay there.)
- **Decay** `reactT` in the per-bot timer block (~734); when it hits 0, commit
  `pendingTargetId → targetId` (the bot turns to face its attacker).
- **Gate first outputs** behind `reactT<=0`: the fire block (949), the threat-driven dash dodge
  (969) and jump dodge (982). Do **not** gate sustained fire/steering on an already-held target.
- `reactT = REACT_MIN + (1-skill)*REACT_SPAN` (0.15–0.30s). Quantized naturally by the 20Hz decay.

## Change 6 — Miss by a direction (texture, display-only)
**Code:** `fire()` (1400–1421). On a **miss** (`!hits`) only, rotate the cosmetic `dir` by
`aimErr = (1-skill) * MISS_SPREAD_RAD * (0.5 + targetAngularSpeedTerm)` before the `"shot"` fanout,
so the tracer visibly goes wide. On a hit, `dir` stays tight. **Do not touch** the
`applyAt`/`enqueueHit`/`resolveShot` path or the `hitsPlayer` targetId anchoring (misses never carry
`targetId`) → netcode hit-sync untouched, zero balance impact.

## Change 7 — Real kill feed (texture, display-only)
**Code:** `resolveShot` (1454–1464) and `resolveSuper` (1308–1316).
On `res.died`: increment killer `b.kills`/`b.streak`, emit the **real** `streak` (was hardcoded `0`
at 1462/1314); reset the victim bot's `streak` in the death paths (`damageBot` 346–350, `killBot`
382–389). Bot-vs-bot kills already flow through `resolveShot`'s bot-victim branch → the feed shows a
believable web of who-kills-whom. `rosterMembers` meta `kills:0 → b.kills`. Streak is **cosmetic
only** — never fed back into difficulty.

## Change 8 — Super hesitation (texture)
**Code:** SUPER entry gate (996–1008). On the first tick all conditions hold, set
`superHesitateT = SUPER_HESITATE_MIN + (1-skill)*SUPER_HESITATE_SPAN` instead of charging; decrement
while conditions stay true; when `<=0` **and** `rand() < SUPER_COMMIT_CHANCE`, flip `kameCharging`.
Keep it short + commit-chance high so the per-player super slot isn't wasted against a lone player.
No change to `SUPER_DAMAGE`/`SUPER_CHARGE`/the dodge gate.

---

## Non-goals (explicitly deferred)
Avatar color tint (client-side `ModelLibrary` change), burst-fire cadence (effective-feel change to
owner-locked `SHOOT_CD`), movement micro-jitter, live join/leave churn, opportunistic
"finish-the-weakest" targeting (would need a player-health hub accessor `playerTargets` lacks).

## Testing & verification
- **Gates:** `corepack pnpm -C server exec tsc --noEmit` + `pnpm build:server` green.
- **By-the-wire (per mega-brain lesson #4):** a synthetic WS client validates, deterministically:
  population settles to the rolled [3,6] and holds; names are unique + match the patterns; a bot
  shot from behind does *not* return fire on the same tick (reactT honored); two equidistant enemies
  don't cause per-`RETARGET_CD` ping-pong (commitT); accuracy/cadence visibly differ across bots;
  kill-feed lines show bot↔bot frags with real streaks. Verify **presence of each change** by grep,
  not just tsc (mega-brain lesson #2).
- **Feel:** a short headed-browser session against the running server.

## Docs to update (inegociável)
- `docs/systems/server-bots-ai.md` — new per-bot identity model (skill/reaction/commit), pure-equal
  targeting, the [3,6] population rule, the name generator, the texture items; refresh the
  constants/code-map tables.
- `docs/balance-log.md` — log the population, accuracy-spread, reaction-latency and super-hesitation
  tuning with rationale (create if absent).
- `docs/README.md` index line if any keywords change.
