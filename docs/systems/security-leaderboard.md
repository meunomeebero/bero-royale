# Security — Leaderboard server-authoritative scoring

**Keywords:** leaderboard, score, poisoning, api, injection, server-authoritative, anti-cheat, submitScore, /api/score, finalizeRun, creditKill, sanitizeUsername

## File map

| File | Role |
|---|---|
| `server/src/leaderboard.ts` | `sanitizeUsername()`, `clamp()`, `getLeaderboardHandler()` — POST handler and `postScoreHandler` removed |
| `server/src/index.ts` | Route registry — `/api/score` POST route removed; `/api/turn` rate-limited (**global** token bucket) |
| `server/src/ws/rooms.ts` | `Player.kills`, `Player.lifeStart`, `creditKill()` (PvP), `finalizeRun()`, death branch in `damagePlayer()` + self-death finalize in `recordState()` |
| `server/src/ws/index.ts` | bot-kill paths do NOT credit (client-declared targets are unvalidated; see point 4) |
| `src/game/net/LeaderboardClient.ts` | `submitScore()` and `ScoreRun` deleted; only `fetchTop()` + `LeaderRow` remain |
| `src/game/Game.ts` | `submitScore()` call removed on player death; server now writes the run |
| `server/test/leaderboard-scoring.test.ts` | Vitest unit tests: creditKill, PvP finalize, sanitizeUsername |

## The incident

The public `POST /api/score` endpoint accepted any JSON body with arbitrary `username`, `kills`, and
`aliveSeconds` values. A client (or anyone with a browser) could forge any score — including
999 kills, injecting any username, or flooding the DB with garbage rows. This is a classic
**leaderboard DB-poisoning** vector. No authentication or geometric validation was required.

## The fix (shipped in `security/leaderboard-hardening`)

1. **`POST /api/score` removed entirely** (`postScoreHandler` + its route deleted from `index.ts`).
   Any caller gets a 404 — the endpoint no longer exists.

2. **Server writes runs on death** (`finalizeRun` in `rooms.ts`):
   - Damage deaths (PvP shot, super via `damagePlayerN`, bot→player) flow through `damagePlayer()`
     — the single choke point. On the lethal hit: `creditKill()` credits the killer (PvP only),
     then `finalizeRun()` persists the victim's run via `insertRun` (fire-and-forget).
   - Self/environmental deaths (fall, lava, self-registered shots) route through `recordState()`
     instead, which also calls `finalizeRun()` (guarded by `p.alive`, so a damage death already
     finalized never double-writes). `lifeStart` is reset on respawn for per-life `aliveSeconds`.
   - `kills` and `lifeStart` are server-owned on `Player`; the client's kill count is never
     trusted for leaderboard purposes.

3. **`creditKill` is a no-op for bots/dead/self/unknown killers** — only a live player in the
   `players` map gets +1.

4. **Only server-resolved PvP kills score** (player kills a live player). **Bot kills do NOT score.**
   `kamehit`/`hit` bot targets are *client-declared and unvalidated* — `killBot` drains a named bot
   in one frame with no real combat — so crediting them would let a script farm the board over WS
   (the same poisoning, moved off HTTP). The two former bot-kill `creditKill` calls were removed.
   A live-player victim cannot be conjured or farmed like respawning bots, so PvP-only bounds the
   residual to the documented hit-frame grind cheat (see Deferred). The client's live HUD kill
   counter still shows all kills (feel); the *persisted leaderboard* ranks PvP kills only.

5. **`sanitizeUsername`** (exported from `leaderboard.ts`): strips control chars (U+0000–U+001F,
   U+007F), trims, caps at 24 chars, falls back to `"Anon"`. Used in `finalizeRun`.

6. **`/api/turn` rate-limited** (GLOBAL token bucket in `index.ts`): 60-burst, 30/s sustained, 429
   on excess. Deliberately NOT per-IP: the only client-IP signal is `X-Forwarded-For`, which is
   spoofable (rotating it mints fresh per-IP buckets), so a global cap that can't be rotated around
   is the robust choice. The real relay-abuse defense is coturn-side per-allocation quotas (infra).

## Deferred security items (bounded risk, tracked in PENDENCIAS.md)

- **WS hit anti-cheat / lag-compensation rewind:** a forged `{t:"hit"}` frame still chips 1 HP
  off any live target the client names, with NO geometric/aim validation. This is a **bounded
  grind cheat** (incremental, not instant-kill, throttled to ~80 frames/s, and a PvP kill needs a
  real live victim) — not the anonymous DB-poisoning risk. Fix: server-side lag compensation with
  rewind + per-attack validation (range/cooldown/projectile). Once that exists, **bot kills can be
  re-enabled in the leaderboard score** (point 4). Deferred pending telemetry on actual abuse.

- **Account-based identity:** `username` comes from the player's meta (set by the client). A
  player can claim any name and poison another user's leaderboard row (best-run upsert). Fix:
  session auth + server-assigned canonical username. Deferred pending scope decision on accounts.
