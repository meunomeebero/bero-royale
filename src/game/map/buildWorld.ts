import type * as THREE from "three";
import { Platform } from "../Platform";
import { Decor } from "../Decor";
import type { DecorEntry } from "./MapDefinition";

/**
 * Build the seed-dependent world — terrain (`Platform`) + props (`Decor`) — and
 * add their meshes to `scene`, returning both so the caller can wire whatever it
 * needs (bullet obstacles, refs, ambient systems sized to the platform, …).
 *
 * Shared by the game and the map editor so both construct the world IDENTICALLY
 * from the same inputs. `Decor` is built from `opts.decor` when present (the
 * authored/data-driven list) or from `opts.seed` otherwise (the legacy seeded
 * scatter) — exactly the two `Decor` constructor paths.
 */
export function buildWorld(
  scene: THREE.Scene,
  opts: { seed: number; decor?: DecorEntry[] },
): { platform: Platform; decor: Decor } {
  const platform = new Platform(opts.seed);
  scene.add(platform.group);

  const decor = new Decor(platform, opts.decor ?? opts.seed);
  scene.add(decor.group);

  return { platform, decor };
}
