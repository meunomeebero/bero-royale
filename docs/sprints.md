# VoxelCube — Feature Build (looped sprints w/ quality gates)

> 🗂️ **SUPERSEDED HISTORICAL LOG.** Completed sprint log under the old project name "VoxelCube".
> ⚠️ **Stale on architecture:** this doc describes multiplayer via **Supabase Realtime** and a
> `net/supabaseClient.ts` — both **removed**. The live system is a **custom Node WebSocket server**
> (`server/src/ws/index.ts`, room `voxelcube-ffa`) + **Postgres leaderboard**, no Supabase. For the
> real architecture see [`ARCHITECTURE.md`](ARCHITECTURE.md).

Self-paced `/loop`: one sprint per iteration. Each sprint ends with the **quality gate**.
The loop stops (no ScheduleWakeup + PushNotification) when every sprint box is checked
and the final goal gate passes.

## GOAL (acceptance criteria)

- [x] Start **menu** with username input (persisted) + mode selection (Local / Multiplayer) → starts the game in the chosen mode.
- [x] **Local** mode = current behavior (infinite survival, kill mobs, maximize time).
- [x] **Dash**: `Shift` → forward impulse, 10s cooldown, big smoke burst at origin, exaggerated bouncy/rubber body distortion; cooldown shown in HUD.
- [x] **Multiplayer** = online free-for-all via Supabase Realtime (presence + broadcast): remote players rendered + can fight; **side leaderboard** ranked by alive-time (longest-alive on top). Degrades gracefully if Supabase env not set.
- [x] All quality gates green; final adversarial review passes.

## QUALITY GATE (run every sprint)

1. `corepack pnpm exec tsc -p tsconfig.app.json --noEmit` → no errors in src/game|pages|components.
2. `corepack pnpm exec eslint <changed files>` → clean.
3. `corepack pnpm build` → succeeds.
4. Visual: load in headed browser, screenshot, no console errors, feature visible/working.

## ARCHITECTURE NOTES

- Routing: `/` = Menu, `/play` = game (Index). Mode + username passed via react-router `state`.
- Multiplayer backend: **Supabase Realtime** channel `ffa-room` — presence tracks `{username, aliveSince, kills, alive}`; broadcast streams position/rot/health + shoot/hit events at ~12Hz. Leaderboard derives from presence (sort by aliveSince asc). Gated on `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`; if absent, Multiplayer shows a "configure Supabase" notice and offers Local.

## SPRINTS

- [x] **S1 — Menu & mode routing.** Menu page (username + mode cards + Jogar), route `/`→Menu, `/play`→game; Index reads `{mode,username}` from router state (redirect to menu if absent); `Game(container, {mode, username})`. QG ✓ (typecheck/lint/build clean; menu→Jogar→/play boots local game, no console errors).
- [x] **S2 — Dash mechanic.** Player: Shift → dash impulse along aim dir (decaying `dashVel`), 10s cooldown; 16-puff smoke explosion at origin + dust; elastic `cos`-damped rubber wobble on the body; `DashMeter` cooldown HUD (charge 0..1, CSS-smoothed). InputManager `consumeDash()`. QG ✓ (typecheck/lint/build clean; Shift triggers dash + smoke + cooldown bar, no console errors).
- [x] **S3 — Multiplayer foundation.** `net/supabaseClient.ts` + `net/Multiplayer.ts` (Realtime: connect, presence, broadcast self state, remote-state map, getLeaderboard), `RemotePlayer.ts` (avatar+label+shadow, interpolated), Player getAimYaw/getAnimal, Game (create mp in MP mode, bots disabled, broadcast 12Hz + reconcile remotes, status→GameStats), HUD connection badge, env.example+types. QG ✓ (typecheck/lint/build clean; MP offline path loads w/ "Offline" badge, INIMIGOS 00, no crash/errors). Live online path needs Supabase creds + 2nd client to verify.
- [x] **S4 — Multiplayer combat + leaderboard.** RemotePlayer implements BulletTarget (local shot → mp.sendHit, no self-damage); mp hit handler → local player.takeHit; death/respawn → presence alive/aliveSince; best-effort kill attribution; `Leaderboard` panel ranked by alive-time (highlights "você"), GameStats.leaderboard. QG ✓ (typecheck/lint/build clean; leaderboard renders w/ local player + live timer offline, no errors). Live combat needs creds + 2 clients to verify.
- [x] **S5 — Polish + final review.** Pause "Sair" button → back to menu (disposes game), mode-aware HUD confirmed. Ran adversarial review workflow (4 finders + triage). Findings: 1 real high bug FIXED (dash momentum dropped in falling state — escape-dash off edge), 1 cosmetic FIXED (leaderboard timer), 6 false positives dismissed with verification. Final QG ✓ (typecheck/lint/build clean; local mode bots=03 verified). GOAL GREEN.

## LOG

- (S0) Plan created. Supabase not configured (no env/client) — multiplayer will be Realtime-based + graceful degrade.
- (S1) DONE. Added `pages/Menu.tsx`, routes `/`→Menu + `/play`→Index, `Game` accepts `{mode, username}`. Verified menu→Jogar→local game. NEXT: S2 dash.
- (S2) DONE. Dash in Player.ts (dashVel impulse, rubber wobble, smoke+dust), InputManager.consumeDash (Shift), GameStats.dashCharge/dashReady, DashMeter HUD in Index. Verified Shift→dash+smoke+cooldown bar. NEXT: S3 multiplayer foundation (Supabase Realtime).
- (S2-fix) User: dash não impulsionava de verdade. Strengthened DASH_IMPULSE 14→36 + DASH_DECAY 8 (~4.5 units). Verified world shifts clearly after dash. (Was weak + masked by camera-follow.)
- (S3-wip) IN PROGRESS: wrote `net/supabaseClient.ts` (getSupabase, isMultiplayerConfigured) + `net/Multiplayer.ts` (presence + broadcast + remote states + getLeaderboard). REMAINING for S3: RemotePlayer.ts, Player getters (getAimYaw/getAnimal), Game integration (create mp in multiplayer mode, disable bots, broadcast + reconcile remote avatars, expose status), HUD connection badge, env.example, then QG.
- (S3) DONE. Added RemotePlayer.ts, Player getAimYaw/getAnimal, Game mp wiring (broadcast 12Hz + reconcileRemotes, bots off in MP, status→stats), HUD Offline/Online badge, .env.example + env types. Verified MP offline path (badge, INIMIGOS 00, no crash). NEXT: S4 combat + leaderboard panel.
- (S2-rework) User feedback: dash now goes in MOVEMENT direction (getMoveVector, fallback aim), horizontal motion-stretch along dash dir via Avatar.setDashStretch (faceYaw(dashYaw) + facing scale Z stretch / X slim, elastic), and 3 CHARGES (DASH_MAX_CHARGES=3, recharge 8s/charge); HUD DashMeter = 3 segments; GameStats dashCharges/dashMaxCharges. Verified: stretch visible, launches in move dir, 3-segment meter consumes a charge. NOTE for S4/leaderboard HUD: stats now use dashCharges/dashMaxCharges (not dashCharge/dashReady).
- (S4) DONE. RemotePlayer implements BulletTarget (sendHit relay), Game mp hit handler → player.takeHit, death/respawn presence sync, kill heuristic, Leaderboard.tsx panel (right side, by alive-time, highlights você), GameStats.leaderboard + LeaderboardEntry. Verified leaderboard renders offline (Bero (você) 00:09 live). NEXT: S5 polish + final review.
- (S5) DONE — GOAL COMPLETE. Pause "Sair" → menu. Adversarial review (workflow): fixed dash-fall momentum bug (falling branch now applies+decays dashVel) + leaderboard timer; dismissed 6 false positives. Final QG green. All 5 sprints + goal ✓. Loop stopped.
