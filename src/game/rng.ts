/**
 * Shared deterministic RNG primitives.
 *
 * Single source of truth so terrain (Platform), decor (Decor) and the
 * LocalRoom name-derived seed all draw from the exact same PRNG implementation
 * — eliminating the dual-PRNG drift risk across clients.
 */

/** Seedable PRNG. Moved verbatim from Decor.ts. */
export function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic string -> uint32 hash (FNV-1a). Used by LocalRoom to derive a
 * stable world seed from the room name so two same-browser tabs build the
 * identical world.
 */
export function hashStringToUint32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  }
  return h >>> 0;
}
