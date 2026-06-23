/**
 * Shared gameplay + net constants — single source of truth.
 *
 * Player + RemotePlayer + AudioEngine + Game all import these so multiplayer
 * math is byte-identical to single-player math by construction (kills the
 * No.1 drift risk). Values mirror the current Player.ts tuning exactly; when
 * Player later imports them (T3) its behavior is unchanged.
 */

// ── Movement / physics (current Player.ts values) ──────────────────────────
export const MOVE_SPEED = 6.5;
export const JUMP_VELOCITY = 6.0;
export const GRAVITY = 18.0;
export const FALL_DURATION = 0.7;
export const DASH_STRETCH_DURATION = 0.5;

// ── Squash / stretch / lean coefficients (from Player.update) ──────────────
/** Body scale lerp factor toward targetScale (Player.ts:841). */
export const SQUASH_LERP = 0.22;
/** Grounded speed-stretch coefficient (Player.ts:800). */
export const SQUASH_STRETCH = 0.18;
/** Grounded speed-squish coefficient (Player.ts:801). */
export const SQUASH_SQUISH = 0.1;
/** Lean magnitude applied to body rotation (Player.ts:816-817). */
export const LEAN_AMOUNT = 0.35;
/** Grounded targetScale lerp factor toward the speed-shape (Player.ts:802-805). */
export const GROUND_SQUASH_LERP = 0.18;
/** Airborne targetScale lerp factor back toward 1 (Player.ts:810). */
export const AIRBORNE_SQUASH_LERP = 0.06;

// ── Persisted settings keys (shared by the menu Settings screen + engines) ──
/** "1" => all procedural game SFX silenced (footsteps, shots, jumps, death). */
export const SFX_MUTED_KEY = "cozykiller:settings:sfxMuted";
/** "1" => incoming proximity voice silenced (you stop HEARING teammates). */
export const VOICE_MUTED_KEY = "cozykiller:settings:voiceMuted";
/** "modo desenho" (PostFX) flag — absent or "1" => ON, "0" => OFF. Defaults ON. */
export const PIXEL_FILTER_KEY = "cozykiller:settings:pixelFilter";

// ── "Modo desenho" post-processing tuning (PostFX.ts) ───────────────────────
// Softened in two ~20% steps from the first pass (4 / 0.4 / 0.4 / 6 / 1.15).
/** Pixel block size for RenderPixelatedPass (device px) — bigger = chunkier. */
export const PIXEL_SIZE = 2.4;
/** Ink-outline strength from surface-normal discontinuities. */
export const PIXEL_NORMAL_EDGE = 0.26;
/** Ink-outline strength from depth discontinuities. */
export const PIXEL_DEPTH_EDGE = 0.26;
/** Cartoon color banding: flat levels per channel (more = subtler banding). */
export const POSTERIZE_LEVELS = 9;
/** Saturation punch applied before banding (1 = unchanged). */
export const POSTERIZE_SATURATION = 1.1;

// ── Net / audio constants ──────────────────────────────────────────────────
/** Spatial audio falloff + voice-ring radius (world units). */
export const HEARING_RADIUS = 5;
/**
 * Snapshot broadcast rate (Hz). Raised 20→30 to halve worst-case tick-quantize
 * latency (~25ms→~17ms avg) on the remote-position channel. One-shot events
 * (shot/dash/jump/died) already bypass this tick. The broadcast cadence in
 * Game.ts derives from this (1 / NET_TICK_HZ), so changing it here truly changes
 * the wire rate. Diminishing returns above 30Hz.
 */
export const NET_TICK_HZ = 30;
/** Render-time interpolation delay (ms) for remote players. */
export const INTERP_DELAY_MS = 80;
/** Max dead-reckoning extrapolation window (ms). */
export const EXTRAP_MAX_MS = 180;
