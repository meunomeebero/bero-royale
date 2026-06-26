# Security — Leaderboard server-authoritative scoring

**Keywords:** leaderboard, score, poisoning, api, injection, server-authoritative, anti-cheat, submitScore, /api/score, finalizeRun, creditKill, sanitizeUsername

## File map

| File | Role |
|---|---|
| `server/src/leaderboard.ts` | `sanitizeUsername()`, `clamp()`, `getLeaderboardHandler()` — POST handler and `postScoreHandler` removed |
| `server/src/index.ts` | Route registry — `/api/score` POST route removed; `/api/turn` rate-limited (per-IP token bucket) |
| `server/src/ws/rooms.ts` | `Player.kills`, `Player.lifeStart`, `creditKill()`, `finalizeRun()`, death branch in `damagePlayer()` |
| `server/src/ws/index.ts` | `creditKill()` calls added on bot kills (player `"hit"` and `"kamehit"` paths) |
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
   - Every player death flows through `damagePlayer()` (the single choke point for PvP shots,
     super/kamehameha via `damagePlayerN`, and bot→player hits).
   - On the lethal hit: `creditKill()` is called first (credits the killer), then `finalizeRun()`
     persists the victim's run via `insertRun` (fire-and-forget, DB errors swallowed).
   - `kills` and `lifeStart` are server-owned fields on `Player`; the client's kill count is
     never trusted for leaderboard purposes.

3. **`creditKill` is a no-op for bots/dead/self/unknown killers** — only a live player in the
   `players` map gets +1. This closes the WS-layer vector (a client claiming a bot kill to inflate
   its kill count): it only matters who the SERVER decides is the killer.

4. **Player→bot kills are credited at the WS layer** (`index.ts`): when a player's `"hit"` or
   `"kamehit"` results in a bot death (`result?.died` / `res?.died`), `creditKill(ws.room, ws.id,
   target)` is called so bot kills count toward the server tally.

5. **`sanitizeUsername`** (exported from `leaderboard.ts`): strips control chars (U+0000–U+001F,
   U+007F), trims, caps at 24 chars, falls back to `"Anon"`. Used in `finalizeRun` to sanitize
   the player's meta name before writing to the DB.

6. **`/api/turn` rate-limited** (per-IP token bucket in `index.ts`): 20-burst, +1/s sustained,
   429 on excess. Bounds relay/cost abuse (TURN credentials are billed per minute of allocation).

## Deferred security items (bounded risk, tracked in PENDENCIAS.md)

- **WS hit anti-cheat / lag-compensation rewind:** a forged `{t:"hit"}` frame still chips 1 HP
  off any live target the client names, with NO geometric/aim validation. This is a **bounded
  grind cheat** (incremental, not instant-kill), not the DB-poisoning risk. Fix: server-side lag
  compensation with rewind. Deferred pending telemetry on actual abuse.

- **Account-based identity:** `username` comes from the player's meta (set by the client). A
  player can claim any name and poison another user's leaderboard row (best-run upsert). Fix:
  session auth + server-assigned canonical username. Deferred pending scope decision on accounts.
