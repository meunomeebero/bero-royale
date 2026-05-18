import * as THREE from "three";
import type { Platform } from "./Platform";

/**
 * Voxel street props scattered around the map: trash cans, garbage bags,
 * wooden crates and small debris. Pure decoration (no collision).
 */
export class Decor {
  readonly group: THREE.Group;

  constructor(platform: Platform, seed = 12345) {
    this.group = new THREE.Group();
    const bounds = platform.getBounds();
    const baseY = platform.topY;
    const rand = mulberry32(seed);

    const TOTAL = 90;
    for (let i = 0; i < TOTAL; i++) {
      const x = bounds.minX + rand() * (bounds.maxX - bounds.minX);
      const z = bounds.minZ + rand() * (bounds.maxZ - bounds.minZ);
      const pick = rand();
      let prop: THREE.Object3D;
      if (pick < 0.35) {
        prop = makeTrashCan(rand);
      } else if (pick < 0.6) {
        prop = makeGarbageBag(rand);
      } else if (pick < 0.85) {
        prop = makeCrate(rand);
      } else {
        prop = makeDebris(rand);
      }
      prop.position.set(x, baseY, z);
      prop.rotation.y = rand() * Math.PI * 2;
      this.group.add(prop);
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

// --- Prop builders -------------------------------------------------------

const CAN_BODY_MAT = new THREE.MeshLambertMaterial({
  color: new THREE.Color("#3a3a40"),
});
const CAN_TOP_MAT = new THREE.MeshLambertMaterial({
  color: new THREE.Color("#23232a"),
});
const CAN_RUST_MAT = new THREE.MeshLambertMaterial({
  color: new THREE.Color("#5a3a25"),
});

function makeTrashCan(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const rusty = rand() < 0.4;
  const bodyMat = rusty ? CAN_RUST_MAT : CAN_BODY_MAT;
  // Body: 3 stacked thin slabs to give that voxel "barrel" feel
  const w = 0.32;
  const segH = 0.18;
  for (let i = 0; i < 3; i++) {
    const seg = new THREE.Mesh(
      new THREE.BoxGeometry(w, segH, w),
      bodyMat,
    );
    seg.position.y = segH / 2 + i * segH;
    g.add(seg);
  }
  // Lid
  const lid = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.04, 0.05, w + 0.04),
    CAN_TOP_MAT,
  );
  lid.position.y = segH * 3 + 0.025;
  // Sometimes tilt the lid like it's loose
  if (rand() < 0.5) lid.rotation.z = (rand() - 0.5) * 0.6;
  g.add(lid);
  return g;
}

const BAG_MATS = [
  new THREE.MeshLambertMaterial({ color: new THREE.Color("#181820") }),
  new THREE.MeshLambertMaterial({ color: new THREE.Color("#1f1f28") }),
  new THREE.MeshLambertMaterial({ color: new THREE.Color("#2a221a") }),
];

function makeGarbageBag(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const mat = BAG_MATS[Math.floor(rand() * BAG_MATS.length)];
  const w = 0.32 + rand() * 0.18;
  const h = 0.25 + rand() * 0.15;
  // Lumpy bag = 1 main blob + a couple smaller blobs glued on
  const main = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * 0.9), mat);
  main.position.y = h / 2;
  g.add(main);
  for (let i = 0; i < 2; i++) {
    const s = 0.12 + rand() * 0.1;
    const lump = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), mat);
    lump.position.set(
      (rand() - 0.5) * w * 0.6,
      h * 0.6 + (rand() - 0.5) * 0.1,
      (rand() - 0.5) * w * 0.6,
    );
    lump.rotation.set(rand() * 0.4, rand() * 0.8, rand() * 0.4);
    g.add(lump);
  }
  return g;
}

const CRATE_MAT = new THREE.MeshLambertMaterial({
  color: new THREE.Color("#6a3f1f"),
});
const CRATE_DARK_MAT = new THREE.MeshLambertMaterial({
  color: new THREE.Color("#3e2511"),
});

function makeCrate(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const s = 0.32 + rand() * 0.1;
  const body = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), CRATE_MAT);
  body.position.y = s / 2;
  g.add(body);
  // Plank highlights on top edges (just thin dark slats)
  const slat = new THREE.Mesh(
    new THREE.BoxGeometry(s + 0.02, 0.04, 0.04),
    CRATE_DARK_MAT,
  );
  slat.position.y = s - 0.03;
  g.add(slat);
  const slat2 = slat.clone();
  slat2.rotation.y = Math.PI / 2;
  g.add(slat2);
  // Random tilt for abandoned look
  g.rotation.z = (rand() - 0.5) * 0.25;
  return g;
}

const DEBRIS_MATS = [
  new THREE.MeshLambertMaterial({ color: new THREE.Color("#5a5a60") }),
  new THREE.MeshLambertMaterial({ color: new THREE.Color("#3a4a3a") }),
  new THREE.MeshLambertMaterial({ color: new THREE.Color("#7a3a30") }),
];

function makeDebris(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  // A small pile of 3-5 tiny voxels (rubble / cans / cardboard)
  const count = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < count; i++) {
    const s = 0.06 + rand() * 0.1;
    const mat = DEBRIS_MATS[Math.floor(rand() * DEBRIS_MATS.length)];
    const cube = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), mat);
    cube.position.set(
      (rand() - 0.5) * 0.3,
      s / 2,
      (rand() - 0.5) * 0.3,
    );
    cube.rotation.y = rand() * Math.PI;
    g.add(cube);
  }
  return g;
}
