import * as THREE from "three";
import type { Platform } from "./Platform";
import { ModelLibrary } from "./ModelLibrary";
import { BlobShadow } from "./Shadow";
import { mulberry32 } from "./rng";

export interface DecorObstacle {
  x: number;
  z: number;
  radius: number;
  topY: number;
  baseY: number;
}

type Anim = "sway" | "treesway" | "float" | null;

interface PropSpec {
  cat: "env" | "collectibles";
  name: string;
  height: number;
  /** Bullet-collision radius; 0 = no collision. */
  radius: number;
  /** Contact-shadow radius; 0 = no shadow. */
  shadow: number;
  anim: Anim;
}

const TREE1: PropSpec = { cat: "env", name: "tree1", height: 1.3, radius: 0.26, shadow: 0.52, anim: "treesway" };
const TREE2: PropSpec = { cat: "env", name: "tree2", height: 1.45, radius: 0.28, shadow: 0.56, anim: "treesway" };
const MUSHROOM: PropSpec = { cat: "env", name: "grassmushroom", height: 0.55, radius: 0, shadow: 0.3, anim: "sway" };
const FLOWER1: PropSpec = { cat: "env", name: "grassflower1", height: 0.5, radius: 0, shadow: 0.24, anim: "sway" };
const FLOWER2: PropSpec = { cat: "env", name: "grassflower2", height: 0.5, radius: 0, shadow: 0.24, anim: "sway" };
const GRASS1: PropSpec = { cat: "env", name: "grass1", height: 0.42, radius: 0, shadow: 0.2, anim: "sway" };
const GRASS2: PropSpec = { cat: "env", name: "grass2", height: 0.46, radius: 0, shadow: 0.2, anim: "sway" };
const GRASS3: PropSpec = { cat: "env", name: "grass3", height: 0.46, radius: 0, shadow: 0.2, anim: "sway" };

// On lush grass-field cells: grass/flowers/mushrooms dominate.
const FIELD_PALETTE: Array<{ weight: number; spec: PropSpec }> = [
  { weight: 16, spec: GRASS1 }, { weight: 16, spec: GRASS2 }, { weight: 16, spec: GRASS3 },
  { weight: 9, spec: FLOWER1 }, { weight: 9, spec: FLOWER2 },
  { weight: 7, spec: MUSHROOM },
];

// Everywhere else: occasional trees over a grassy meadow (no crates/clutter).
const MIXED_PALETTE: Array<{ weight: number; spec: PropSpec }> = [
  { weight: 9, spec: TREE1 }, { weight: 9, spec: TREE2 },
  { weight: 7, spec: MUSHROOM },
  { weight: 7, spec: FLOWER1 }, { weight: 7, spec: FLOWER2 },
  { weight: 9, spec: GRASS1 }, { weight: 9, spec: GRASS2 }, { weight: 9, spec: GRASS3 },
];

const FIELD_TOTAL = FIELD_PALETTE.reduce((s, p) => s + p.weight, 0);
const MIXED_TOTAL = MIXED_PALETTE.reduce((s, p) => s + p.weight, 0);

interface AnimEntry {
  obj: THREE.Object3D;
  anim: Anim;
  phase: number;
  amp: number;
  speed: number;
  baseY: number;
  spin: number;
}

/**
 * Scatters voxel props from the asset pack across the map and gives them life:
 * grass/flowers sway in the breeze, food collectibles bob and spin, and every
 * prop casts a soft contact shadow. Solid props (trees, crates) register bullet
 * collision.
 */
export class Decor {
  readonly group: THREE.Group;
  readonly obstacles: DecorObstacle[] = [];
  private anims: AnimEntry[] = [];
  private shadows: BlobShadow[] = [];
  private t = 0;

  constructor(platform: Platform, seed = 12345) {
    this.group = new THREE.Group();
    const bounds = platform.getBounds();
    // Decor sub-stream: keep decor and terrain PRNGs disjoint so neither
    // shifts the other's draw sequence.
    const rand = mulberry32((seed ^ 0x85ebca6b) >>> 0);

    const TOTAL = 240;
    let placed = 0;
    let attempts = 0;
    while (placed < TOTAL && attempts < TOTAL * 8) {
      attempts++;
      const x = bounds.minX + rand() * (bounds.maxX - bounds.minX);
      const z = bounds.minZ + rand() * (bounds.maxZ - bounds.minZ);
      if (!platform.isOnGrass(x, z)) continue;
      if (platform.isHill(x, z)) continue;
      if (
        x < bounds.minX + 0.6 ||
        x > bounds.maxX - 0.6 ||
        z < bounds.minZ + 0.6 ||
        z > bounds.maxZ - 0.6
      ) {
        continue;
      }

      const onField = platform.isGrassField(x, z);
      const spec = pickSpec(rand, onField);
      const name = spec.name;
      const height = spec.height * (0.85 + rand() * 0.3);
      const { object } = ModelLibrary.create(spec.cat, name, height);

      const baseY = platform.surfaceY(x, z);
      object.position.set(x, baseY, z);
      object.rotation.y = rand() * Math.PI * 2;
      this.group.add(object);

      // Square voxel contact shadow under the prop.
      if (spec.shadow > 0) {
        const shadow = new BlobShadow(spec.shadow * (0.9 + rand() * 0.3), 0.14);
        shadow.placeStatic(x, baseY + 0.02, z);
        this.group.add(shadow.mesh);
        this.shadows.push(shadow);
      }

      // Register collision + animation.
      if (spec.radius > 0) {
        this.obstacles.push({ x, z, radius: spec.radius, baseY, topY: baseY + height });
      }
      if (spec.anim) {
        this.anims.push(animEntryFor(spec.anim, object, baseY, rand));
      }
      placed++;
    }
  }

  /** Breeze sway, bobbing food, spinning collectibles. */
  update(dt: number) {
    this.t += dt;
    const t = this.t;
    for (const a of this.anims) {
      if (a.anim === "sway" || a.anim === "treesway") {
        a.obj.rotation.z = Math.sin(t * a.speed + a.phase) * a.amp;
      } else if (a.anim === "float") {
        a.obj.position.y = a.baseY + 0.12 + Math.sin(t * 2 + a.phase) * 0.07;
        a.obj.rotation.y += dt * a.spin;
      }
    }
  }

  dispose() {
    for (const s of this.shadows) s.dispose();
  }
}

function animEntryFor(
  anim: Anim,
  obj: THREE.Object3D,
  baseY: number,
  rand: () => number,
): AnimEntry {
  const phase = rand() * Math.PI * 2;
  if (anim === "treesway") {
    return { obj, anim, phase, amp: 0.04, speed: 0.9 + rand() * 0.3, baseY, spin: 0 };
  }
  if (anim === "float") {
    return { obj, anim, phase, amp: 0, speed: 2, baseY, spin: 0.8 + rand() * 0.9 };
  }
  // sway (grass / flowers / mushrooms)
  return { obj, anim, phase, amp: 0.1 + rand() * 0.06, speed: 1.4 + rand() * 0.8, baseY, spin: 0 };
}

function pickSpec(rand: () => number, onField: boolean): PropSpec {
  const palette = onField ? FIELD_PALETTE : MIXED_PALETTE;
  const total = onField ? FIELD_TOTAL : MIXED_TOTAL;
  let roll = rand() * total;
  for (const entry of palette) {
    roll -= entry.weight;
    if (roll <= 0) return entry.spec;
  }
  return palette[0].spec;
}
