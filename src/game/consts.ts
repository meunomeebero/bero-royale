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
/**
 * Cursor/aim sensitivity — a center-anchored gain on the pointer position that
 * scales how far the aim deflects per unit of cursor offset from screen center
 * (1 = unchanged, like a 1:1 cursor). Persisted; read by InputManager.
 */
export const AIM_SENSITIVITY_KEY = "cozykiller:settings:aimSensitivity";
export const AIM_SENSITIVITY_MIN = 0.4;
export const AIM_SENSITIVITY_MAX = 2.0;
export const AIM_SENSITIVITY_DEFAULT = 1;
/**
 * "Modo desenho" / VHS retro-filter intensity (0 = subtle .. 1 = full as shipped).
 * Only matters while PIXEL_FILTER_KEY is ON. Persisted; read by PostFX via Game.
 */
export const VHS_LEVEL_KEY = "cozykiller:settings:vhsLevel";
export const VHS_LEVEL_DEFAULT = 0.15;
/**
 * Cel-shading outline (the black cartoon contour) intensity 0..1 — drives the
 * inverted-hull shell thickness (see Outline.ts), INDEPENDENT of the camera /
 * pixelation. Unlike the VHS filter it does NOT need "Modo desenho" on; it's
 * geometry, not post-processing. Persisted; read by Game → setOutlineThickness.
 */
export const OUTLINE_LEVEL_KEY = "cozykiller:settings:celOutline";
export const OUTLINE_LEVEL_DEFAULT = 0.2;
/** Outline thickness at level 1, in WORLD units (orthographic ≈ constant px). */
export const OUTLINE_THICKNESS_MAX = 0.04;

// ── "Modo desenho" post-processing tuning (PostFX.ts) ───────────────────────
// Softened in two ~20% steps from the first pass (4 / 0.4 / 0.4 / 6 / 1.15).
/** Pixel block size for RenderPixelatedPass (device px) — bigger = chunkier. */
export const PIXEL_SIZE = 2.4;
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
/**
 * Render-time interpolation delay (ms) for remote players — now an ADAPTIVE
 * cushion per remote, not a fixed value (was a flat 80ms, the biggest reducible
 * source of perceived opponent lag). Each remote derives its own cushion from
 * measured snapshot-arrival jitter:
 *   cushion = clamp(INTERP_BASE_MS + INTERP_JITTER_K * jitterEMA, INTERP_MIN_MS, INTERP_MAX_MS)
 * On a clean link (jitter ~1ms) this lands ~44ms (≈ one 33ms tick + margin →
 * still safely INTERPOLATING between the two newest snapshots, not extrapolating),
 * i.e. ~36ms less perceived lag than the old fixed 80ms. On a jittery mobile link
 * it widens toward INTERP_MAX_MS to absorb reorder instead of stuttering.
 * INTERP_DELAY_MS is kept as the conservative INITIAL cushion before any jitter
 * is measured.
 */
export const INTERP_DELAY_MS = 80;
/** Base cushion: ~one 33ms tick at 30Hz + ~8ms margin. */
export const INTERP_BASE_MS = 41;
/** Jitter slope: cushion grows this-many ms per ms of measured arrival jitter. */
export const INTERP_JITTER_K = 3;
/** Floor: never below ~one tick, so we keep ≥2 snapshots buffered (no window collapse → no stutter). */
export const INTERP_MIN_MS = 40;
/** Ceiling: worst-case cushion ≈ the old fixed behaviour (absorbs bad links). */
export const INTERP_MAX_MS = 90;
/**
 * Max dead-reckoning extrapolation window (ms). Tightened 180→60: extrapolation
 * is now a STARVATION FALLBACK only (the adaptive cushion keeps us interpolating
 * in the common case), and the velocity is decayed toward zero across this window
 * (EXTRAP_TAU_S) so a remote that stopped/reversed COASTS to a halt instead of
 * sling-shotting forward and snapping back — the dominant rubber-band artifact.
 */
export const EXTRAP_MAX_MS = 60;
/**
 * Time constant (s) for the extrapolation velocity decay. Total extrapolated
 * displacement is hard-bounded to |v|·EXTRAP_TAU_S (~one body-width at run speed),
 * so an unconfirmed guess can never overshoot far no matter how late the next
 * packet is.
 */
export const EXTRAP_TAU_S = 0.06;
