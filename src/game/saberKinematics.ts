/**
 * Saber swing kinematics — the SINGLE source of truth for the baseball-bat blade
 * motion, shared by the local {@link Player} and the networked {@link RemotePlayer}
 * so a remote's saber sweeps the IDENTICAL 180° arc its owner sees locally.
 *
 * This is the netcode "fidelity golden rule" applied to the saber: what the
 * attacker sees (the wind-up, the strike sweep, the blade mount push-out) must
 * render the same on every opponent's screen. Keeping the math here — not copied
 * into two files — guarantees they never drift apart.
 *
 * See docs/systems/netcode-fidelity-golden-rule.md and
 * docs/systems/weapons-melee-saber.md.
 */

/** Full swing duration (wind-up + 180° strike + held follow-through). */
export const MELEE_SWING_DUR = 0.4;

// Baseball-bat swing on the pivot's local Y. Rest = blade perpendicular (out to
// the side, ~90° to forward). Wind-up pulls 45° counter-clockwise, then the strike
// sweeps 180° clockwise; the remainder HOLDS at the follow-through (the gentle
// settle back to rest is done by the caller, not by sampleSaberYaw).
export const SABER_REST_YAW = -Math.PI / 2; // perpendicular rest pose
const SABER_WINDUP_YAW = SABER_REST_YAW - Math.PI / 4; // 45° CCW wind-up peak
const SABER_STRIKE_YAW = SABER_WINDUP_YAW + Math.PI; // full 180° CW strike
/** Wind-up fraction of the swing; the strike owns the rest. Also used by the local
 *  player to tag the hit phase ("windup" deals no damage). */
export const SWING_WINDUP_END_T = 0.18;

// Floating-saber mount: rest distance in front of the body, the clearance radius
// the swept blade must keep from the body center (body half-width 0.25 + margin for
// the voxel avatar overhang), and the hard cap on the push-out. During the backward
// part of the arc the mount is pushed out to CLEAR_R/|sin(yaw)| so the blade never
// touches the cube.
export const BASE_SABER_MOUNT = 0.5;
const SABER_CLEAR_R = 0.55; // internal to saberMountX
const SABER_MAX_MOUNT = 1.1; // internal to saberMountX

function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - x, 3);
}
function easeInOutCubic(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/**
 * Pivot yaw over a normalized swing t∈[0,1]: a snappy 45° wind-up (rest→windup,
 * easeOut), then a powered 180° strike (windup→strike end, easeInOut) that HOLDS at
 * the follow-through. The return to rest is the caller's post-swing settle, not here.
 */
export function sampleSaberYaw(t: number): number {
  if (t < SWING_WINDUP_END_T) {
    const u = easeOutCubic(t / SWING_WINDUP_END_T);
    return SABER_REST_YAW + (SABER_WINDUP_YAW - SABER_REST_YAW) * u; // rest → wind-up
  }
  const u = easeInOutCubic((t - SWING_WINDUP_END_T) / (1 - SWING_WINDUP_END_T));
  return SABER_WINDUP_YAW + (SABER_STRIKE_YAW - SABER_WINDUP_YAW) * u;
}

/**
 * Dynamic forward mount distance for a given pivot yaw: during the backward part of
 * the arc (cos<0) push the blade out so the swept blade never touches the cube,
 * clamped to SABER_MAX_MOUNT. At rest / forward poses it stays at BASE_SABER_MOUNT.
 */
export function saberMountX(yaw: number): number {
  const cosY = Math.cos(yaw);
  let mountX = BASE_SABER_MOUNT;
  if (cosY < 0) {
    const sinY = Math.abs(Math.sin(yaw)) || 1;
    mountX = Math.min(SABER_MAX_MOUNT, Math.max(mountX, SABER_CLEAR_R / sinY));
  }
  return mountX;
}
