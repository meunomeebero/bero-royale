/**
 * Shared combat constants for the SERVER (bots.ts, rooms.ts, index.ts). One source
 * of truth inside the server package so the bot path and the PvP path schedule
 * damage with identical numbers — the harness-drift the netcode-testing checklist
 * warns about. See docs/systems/netcode-hit-sync-plan.md + docs/systems/netcode-testing.md.
 *
 * NOTE: these are STILL duplicated vs the client (src/game/Bullets.ts BULLET_SPEED,
 * the gate's LETHAL_TRACER_SPEED) because the server (tsup) and client (vite) builds
 * don't share a source module today. Keep the two in sync by hand; a real
 * cross-package shared module is a deferred follow-up.
 */

/** Visible-bullet travel speed (world units / sec). **MUST match `BULLET_SPEED`
 *  in `src/game/Bullets.ts`** — damage is scheduled to land `dist/BULLET_SPEED`
 *  after the shot so it coincides with the tracer the client renders at that speed. */
export const BULLET_SPEED = 22;

/** Floor on a scheduled hit's travel time so point-blank shots (dist→0) still show
 *  a brief visible tracer before the damage lands — no close-range instant-death. */
export const MIN_TRAVEL_MS = 90;

/** Fixed reveal delay for a super's damage. A kame beam is near-instant VISUALLY
 *  (a beam, not a point projectile), so its damage lands a short fixed time after
 *  the beam FX appears — NOT dist/BULLET_SPEED. */
export const SUPER_REVEAL_MS = 120;

/** Super damage points (shield-first). Shared by the bot super and the player
 *  super (a "kamehit" on a player). ~4 unshielded hits to kill. */
export const SUPER_DAMAGE = 3;
