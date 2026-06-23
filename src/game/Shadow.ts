import * as THREE from "three";

/**
 * Square voxel contact shadow. A flat, ground-hugging quad with a soft-edged
 * SQUARE falloff so it matches the cube footprint of everything in the world
 * (round blobs read wrong in a voxel scene). For jumping entities the square
 * shrinks and fades as the feet rise; under props it's a fixed, clearly-visible
 * dark square that grounds the object.
 */

let SHARED_TEX: THREE.Texture | null = null;

function shadowTexture(): THREE.Texture {
  if (SHARED_TEX) return SHARED_TEX;
  const s = 64;
  const cnv = document.createElement("canvas");
  cnv.width = cnv.height = s;
  const ctx = cnv.getContext("2d")!;
  const img = ctx.createImageData(s, s);
  const c = (s - 1) / 2;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      // Chebyshev distance -> a SQUARE falloff (opaque core, soft edge).
      const d = Math.max(Math.abs(x - c), Math.abs(y - c)) / c;
      const a = 1 - smoothstep(0.74, 1.0, d);
      const i = (y * s + x) * 4;
      img.data[i] = 54;
      img.data[i + 1] = 34;
      img.data[i + 2] = 28;
      img.data[i + 3] = Math.round(255 * a);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cnv);
  tex.colorSpace = THREE.SRGBColorSpace;
  SHARED_TEX = tex;
  return tex;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export class BlobShadow {
  readonly mesh: THREE.Mesh;
  private mat: THREE.MeshBasicMaterial;
  private baseDiameter: number;
  private baseOpacity: number;

  constructor(radius = 0.42, opacity = 0.5) {
    this.baseDiameter = radius * 2;
    this.baseOpacity = opacity;
    const geo = new THREE.PlaneGeometry(1, 1);
    this.mat = new THREE.MeshBasicMaterial({
      map: shadowTexture(),
      transparent: true,
      depthWrite: false,
      opacity,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.rotation.x = -Math.PI / 2; // lay flat (square aligned to X/Z, like the cubes)
    this.mesh.renderOrder = 1;
    this.apply(0, 0);
  }

  /**
   * @param heightAboveGround feet height above the ground (>= 0). Larger ⇒ the
   *   square is smaller and fainter.
   * @param localY ground Y in this mesh's parent space, so it stays on the floor.
   */
  apply(heightAboveGround: number, localY: number) {
    const h = Math.max(0, heightAboveGround);
    const shrink = 1 / (1 + h * 1.5);
    const d = this.baseDiameter * shrink;
    this.mesh.scale.set(d, d, 1);
    this.mat.opacity = this.baseOpacity * shrink;
    this.mesh.position.y = localY;
  }

  /** Place a static prop shadow at a fixed world position (decor group space). */
  placeStatic(x: number, y: number, z: number) {
    this.mesh.position.set(x, y, z);
    this.mesh.scale.set(this.baseDiameter, this.baseDiameter, 1);
    this.mat.opacity = this.baseOpacity;
  }

  setVisible(v: boolean) {
    this.mesh.visible = v;
  }

  dispose() {
    this.mat.dispose();
    (this.mesh.geometry as THREE.BufferGeometry).dispose();
  }
}
