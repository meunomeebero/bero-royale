import * as THREE from "three";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";

/**
 * Loads the MagicaVoxel asset pack (OBJ + MTL + 256x1 palette PNG) and serves
 * normalized, ready-to-use copies to the game.
 *
 * Every source model is authored Y-up with its feet at y=0 and roughly centered
 * in X/Z. On load we:
 *   - convert each material to a flat MeshLambertMaterial with a crisp
 *     (NearestFilter) palette texture so the voxel colors stay sharp,
 *   - bake a "unit template": feet at y=0, centered in X/Z, total height = 1.
 *
 * Consumers then either clone+rescale a template (entities, decor props) or
 * bake a single tile geometry for InstancedMesh ground rendering.
 */

const BASE = `${import.meta.env.BASE_URL}models`;

// Compact, balanced-build animals only. The bulky/low-and-wide models
// (elephant, cow, monkey, penguin, parrot, turtle, mole, axolotl, unicorn)
// blow up oversized when normalized and are unfair as multiplayer avatars.
export const ANIMAL_NAMES = [
  "bear", "bunny", "cat", "chicken", "crocodile", "dog", "fox", "frog",
  "mouse", "owl", "panda", "piglet", "rabbi",
] as const;

// Secret roster: the owl + rabbi (rabino) are hidden everywhere — off the picker,
// the random bot/showcase pool, and the MP fallback — until the username unlocks
// them (see `unlocksSecretAnimals`). They still load so an unlocked picker can use
// them and remotes can render an unlocked player's pick.
export const SECRET_ANIMALS = ["owl", "rabbi"] as const;

// The publicly selectable / randomly-spawnable roster (everything but the secrets).
export const PUBLIC_ANIMALS = ANIMAL_NAMES.filter(
  (n) => !(SECRET_ANIMALS as readonly string[]).includes(n),
);

/**
 * Easter-egg gate for the secret animals: the username (trimmed, case-insensitive)
 * is exactly "bero" OR ends with "_jew" (e.g. "john_jew"). Pure string rule, no
 * Three.js dependency — shared by the picker reveal.
 */
export function unlocksSecretAnimals(name: string): boolean {
  const n = name.trim().toLowerCase();
  return n === "bero" || n.endsWith("_jew");
}

export const COLLECTIBLE_NAMES = [
  "apple", "bamboo", "banana", "candy", "carrot", "cheese", "corn", "fish",
  "honey", "melon", "worm",
] as const;

export const ENV_NAMES = [
  "box1", "box2", "grass1", "grass2", "grass3", "grassflower1", "grassflower2",
  "grassmushroom", "nograss", "tree1", "tree2", "walktile",
] as const;

export type Category = "animals" | "collectibles" | "env";

export interface ModelInstance {
  /** Root object: feet at y=0, centered in X/Z, total height = `targetHeight`. */
  object: THREE.Object3D;
  /** Every material on the instance (cloned, safe to tint/fade per entity). */
  materials: THREE.MeshLambertMaterial[];
}

export interface TileGeometry {
  /** Geometry baked so footprint (max of X/Z) = 1, base at y=0, centered X/Z. */
  geometry: THREE.BufferGeometry;
  material: THREE.MeshLambertMaterial;
}

class ModelLibraryImpl {
  /** key = `${category}/${name}` -> normalized unit template (height 1). */
  private templates = new Map<string, THREE.Object3D>();
  private loaded = false;
  private loadingPromise: Promise<void> | null = null;

  isLoaded() {
    return this.loaded;
  }

  preload(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    if (!this.loadingPromise) this.loadingPromise = this.loadAll();
    return this.loadingPromise;
  }

  private async loadAll() {
    const jobs: Promise<void>[] = [];
    for (const n of ANIMAL_NAMES) jobs.push(this.loadOne("animals", n));
    for (const n of COLLECTIBLE_NAMES) jobs.push(this.loadOne("collectibles", n));
    for (const n of ENV_NAMES) jobs.push(this.loadOne("env", n));
    await Promise.all(jobs);
    this.loaded = true;
  }

  private async loadOne(category: Category, name: string) {
    const dir = `${BASE}/${category}/${name}/`;
    const stem = `${name}.vox`;

    const mtl = await new MTLLoader().setPath(dir).loadAsync(`${stem}.mtl`);
    mtl.preload();
    const obj = await new OBJLoader()
      .setMaterials(mtl)
      .setPath(dir)
      .loadAsync(`${stem}.obj`);

    this.templates.set(`${category}/${name}`, this.makeTemplate(obj));
  }

  /** Convert materials + bake a unit template (height 1, feet at 0, centered XZ). */
  private makeTemplate(obj: THREE.Object3D): THREE.Object3D {
    obj.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const src = mesh.material;
      mesh.material = Array.isArray(src)
        ? src.map((m) => toFlatMaterial(m))
        : toFlatMaterial(src);
    });

    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const height = size.y || 1;
    const s = 1 / height;

    // Wrap so we can compose scale + offset cleanly: world = pos + s * local.
    const outer = new THREE.Group();
    obj.scale.setScalar(s);
    obj.position.set(-s * center.x, -s * box.min.y, -s * center.z);
    outer.add(obj);
    return outer;
  }

  /** Clone a template, rescale to `targetHeight`, and clone its materials. */
  create(category: Category, name: string, targetHeight: number): ModelInstance {
    const tmpl = this.templates.get(`${category}/${name}`);
    if (!tmpl) throw new Error(`ModelLibrary: missing ${category}/${name}`);
    const object = tmpl.clone(true);
    const materials: THREE.MeshLambertMaterial[] = [];
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const src = mesh.material;
      if (Array.isArray(src)) {
        const cloned = src.map((m) => m.clone() as THREE.MeshLambertMaterial);
        mesh.material = cloned;
        materials.push(...cloned);
      } else {
        const cloned = src.clone() as THREE.MeshLambertMaterial;
        mesh.material = cloned;
        materials.push(cloned);
      }
    });
    object.scale.multiplyScalar(targetHeight); // template height = 1
    return { object, materials };
  }

  /** Random PUBLIC animal — never a secret (owl/rabbi) so they stay hidden on
   *  bots, the MP fallback, and the menu showcase until the easter egg unlocks. */
  randomAnimalName(rng: () => number = Math.random): string {
    return PUBLIC_ANIMALS[Math.floor(rng() * PUBLIC_ANIMALS.length)];
  }

  randomCollectibleName(rng: () => number = Math.random): string {
    return COLLECTIBLE_NAMES[Math.floor(rng() * COLLECTIBLE_NAMES.length)];
  }

  /**
   * Bake a single env model into instancing-ready geometry: footprint (max of
   * X/Z extent) normalized to 1, base at y=0, centered in X/Z. Callers scale
   * instances by the desired block footprint.
   */
  bakeTile(name: string): TileGeometry {
    const tmpl = this.templates.get(`env/${name}`);
    if (!tmpl) throw new Error(`ModelLibrary: missing env/${name}`);
    tmpl.updateMatrixWorld(true);

    let mesh: THREE.Mesh | null = null;
    tmpl.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.isMesh && !mesh) mesh = m;
    });
    if (!mesh) throw new Error(`ModelLibrary: env/${name} has no mesh`);
    const tileMesh = mesh as THREE.Mesh;

    const geometry = tileMesh.geometry.clone();
    geometry.applyMatrix4(tileMesh.matrixWorld);

    geometry.computeBoundingBox();
    let bb = geometry.boundingBox!;
    const foot = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) || 1;
    geometry.scale(1 / foot, 1 / foot, 1 / foot);

    geometry.computeBoundingBox();
    bb = geometry.boundingBox!;
    geometry.translate(
      -(bb.max.x + bb.min.x) / 2,
      -bb.min.y,
      -(bb.max.z + bb.min.z) / 2,
    );

    const material = Array.isArray(tileMesh.material)
      ? (tileMesh.material[0].clone() as THREE.MeshLambertMaterial)
      : (tileMesh.material.clone() as THREE.MeshLambertMaterial);

    return { geometry, material };
  }
}

function toFlatMaterial(src: THREE.Material): THREE.MeshLambertMaterial {
  const anySrc = src as unknown as { map?: THREE.Texture };
  const map = anySrc.map;
  if (map) {
    map.magFilter = THREE.NearestFilter;
    map.minFilter = THREE.NearestFilter;
    map.generateMipmaps = false;
    map.colorSpace = THREE.SRGBColorSpace;
    map.needsUpdate = true;
  }
  return new THREE.MeshLambertMaterial({
    map: map ?? null,
    color: 0xffffff,
    transparent: true,
  });
}

/** Shared singleton — preload once, reuse everywhere. */
export const ModelLibrary = new ModelLibraryImpl();
