import * as THREE from "three";
import type { Platform } from "./Platform";

export interface DecorObstacle {
  /** Center XZ. */
  x: number;
  z: number;
  /** Collision radius (bullets stop when within this distance, ignoring Y). */
  radius: number;
  /** Top Y (above ground) -- bullets above this height pass over (jumping over a stump). */
  topY: number;
  /** Bottom Y -- bullets below ignore (purely cosmetic small props). */
  baseY: number;
}

/**
 * Forest props scattered around the map: pine trees, oak trees, stumps and
 * small bushes / rocks. Visuals + collision data for bullets.
 */
export class Decor {
  readonly group: THREE.Group;
  readonly obstacles: DecorObstacle[] = [];

  constructor(platform: Platform, seed = 12345) {
    this.group = new THREE.Group();
    const bounds = platform.getBounds();
    const rand = mulberry32(seed);

    const TOTAL = 130;
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
      if (
        platform.isLavaAt(x + 0.5, z) ||
        platform.isLavaAt(x - 0.5, z) ||
        platform.isLavaAt(x, z + 0.5) ||
        platform.isLavaAt(x, z - 0.5)
      ) {
        continue;
      }
      const baseY = platform.surfaceY(x, z);
      const pick = rand();
      let prop: THREE.Object3D;
      let radius = 0;
      let height = 0;
      if (pick < 0.45) {
        prop = makePineTree(rand);
        radius = 0.22;
        height = 1.6;
      } else if (pick < 0.7) {
        prop = makeOakTree(rand);
        radius = 0.28;
        height = 1.4;
      } else if (pick < 0.85) {
        prop = makeBush(rand);
        radius = 0.18;
        height = 0.45;
      } else if (pick < 0.95) {
        prop = makeRock(rand);
        radius = 0.18;
        height = 0.35;
      } else {
        prop = makeStump(rand);
        radius = 0.17;
        height = 0.3;
      }
      prop.position.set(x, baseY, z);
      prop.rotation.y = rand() * Math.PI * 2;
      this.group.add(prop);
      this.obstacles.push({
        x,
        z,
        radius,
        baseY,
        topY: baseY + height,
      });
      placed++;
    }
  }
}

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Materials (night-forest palette: dark wood + bluish-teal foliage) ----

const TRUNK_MAT = new THREE.MeshLambertMaterial({
  color: new THREE.Color("#2a1a10"),
});
const TRUNK_DARK_MAT = new THREE.MeshLambertMaterial({
  color: new THREE.Color("#1a0e08"),
});

const FOLIAGE_MATS = [
  new THREE.MeshLambertMaterial({ color: new THREE.Color("#1e3e3a") }),
  new THREE.MeshLambertMaterial({ color: new THREE.Color("#264a4a") }),
  new THREE.MeshLambertMaterial({ color: new THREE.Color("#15302e") }),
  new THREE.MeshLambertMaterial({ color: new THREE.Color("#2a5a52") }),
];

const ROCK_MATS = [
  new THREE.MeshLambertMaterial({ color: new THREE.Color("#3a3a44") }),
  new THREE.MeshLambertMaterial({ color: new THREE.Color("#26262e") }),
];

// --- Prop builders -------------------------------------------------------

function makePineTree(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  // Trunk: 2-3 stacked thin cubes
  const trunkH = 0.4 + rand() * 0.25;
  const trunkW = 0.12;
  const trunk = new THREE.Mesh(
    new THREE.BoxGeometry(trunkW, trunkH, trunkW),
    TRUNK_MAT,
  );
  trunk.position.y = trunkH / 2;
  g.add(trunk);
  // Foliage: 3-4 stacked diminishing voxel slabs
  const layers = 3 + Math.floor(rand() * 2);
  const baseSize = 0.55 + rand() * 0.15;
  const layerH = 0.22;
  for (let i = 0; i < layers; i++) {
    const s = baseSize * (1 - i * 0.18);
    const mat = FOLIAGE_MATS[Math.floor(rand() * FOLIAGE_MATS.length)];
    const leaves = new THREE.Mesh(
      new THREE.BoxGeometry(s, layerH, s),
      mat,
    );
    leaves.position.y = trunkH + layerH / 2 + i * layerH * 0.9;
    g.add(leaves);
  }
  return g;
}

function makeOakTree(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const trunkH = 0.45 + rand() * 0.2;
  const trunk = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, trunkH, 0.16),
    TRUNK_MAT,
  );
  trunk.position.y = trunkH / 2;
  g.add(trunk);
  // Wide leafy crown: 1 big cube + 4 smaller cubes around it
  const cw = 0.7;
  const mat = FOLIAGE_MATS[Math.floor(rand() * FOLIAGE_MATS.length)];
  const crown = new THREE.Mesh(
    new THREE.BoxGeometry(cw, 0.45, cw),
    mat,
  );
  crown.position.y = trunkH + 0.22;
  g.add(crown);
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * Math.PI * 2;
    const m = FOLIAGE_MATS[Math.floor(rand() * FOLIAGE_MATS.length)];
    const lump = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.28, 0.32), m);
    lump.position.set(
      Math.cos(ang) * 0.3,
      trunkH + 0.18 + (rand() - 0.5) * 0.1,
      Math.sin(ang) * 0.3,
    );
    g.add(lump);
  }
  return g;
}

function makeBush(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const s = 0.24 + rand() * 0.16;
  const main = new THREE.Mesh(
    new THREE.BoxGeometry(s, s, s),
    FOLIAGE_MATS[Math.floor(rand() * FOLIAGE_MATS.length)],
  );
  main.position.y = s / 2;
  g.add(main);
  // Couple of smaller leafy lumps
  for (let i = 0; i < 2; i++) {
    const ss = 0.12 + rand() * 0.1;
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(ss, ss, ss),
      FOLIAGE_MATS[Math.floor(rand() * FOLIAGE_MATS.length)],
    );
    m.position.set(
      (rand() - 0.5) * s * 0.7,
      ss / 2 + (rand() - 0.5) * 0.05,
      (rand() - 0.5) * s * 0.7,
    );
    g.add(m);
  }
  return g;
}

function makeRock(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const s = 0.18 + rand() * 0.18;
  const mat = ROCK_MATS[Math.floor(rand() * ROCK_MATS.length)];
  const main = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.7, s), mat);
  main.position.y = (s * 0.7) / 2;
  g.add(main);
  if (rand() < 0.6) {
    const m2 = ROCK_MATS[Math.floor(rand() * ROCK_MATS.length)];
    const pebble = new THREE.Mesh(
      new THREE.BoxGeometry(s * 0.5, s * 0.4, s * 0.5),
      m2,
    );
    pebble.position.set(s * 0.45, (s * 0.4) / 2, (rand() - 0.5) * s);
    g.add(pebble);
  }
  g.rotation.y = rand() * Math.PI * 2;
  return g;
}

function makeStump(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const stump = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 0.2, 0.28),
    TRUNK_MAT,
  );
  stump.position.y = 0.1;
  g.add(stump);
  // Dark "rings" on top
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.04, 0.3),
    TRUNK_DARK_MAT,
  );
  top.position.y = 0.22;
  g.add(top);
  if (rand() < 0.4) {
    // moss / leaves on top
    const moss = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.06, 0.14),
      FOLIAGE_MATS[Math.floor(rand() * FOLIAGE_MATS.length)],
    );
    moss.position.set(0, 0.27, 0);
    g.add(moss);
  }
  return g;
}
