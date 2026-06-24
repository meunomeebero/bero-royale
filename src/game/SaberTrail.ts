import * as THREE from "three";

/**
 * A motion-blur "light trail" ribbon for the energy saber swing — the blue arc
 * the blade leaves as it sweeps (the "rastro de luz").
 *
 * Each frame of a swing the Player feeds the LIVE blade segment (base → tip, world
 * space) via {@link push}. We keep the last few ribs and rebuild a triangle strip
 * connecting them, so the surface fills the swept area. Additive blue, and each rib
 * dims with age (older = darker = fades out under additive blending), giving a
 * glowing arc that trails the blade and dissolves a fraction of a second later.
 *
 * Self-contained: owns one Mesh (add `.mesh` to the scene). Local-player only for
 * now; remote saber trails would need per-frame remote blade reconstruction.
 */

const MAX_RIBS = 18; // ribs kept in the strip (≈ the last MAX_RIBS frames of a swing)
const RIB_LIFE = 0.16; // seconds a rib stays before it has fully faded
const COLOR = new THREE.Color("#49d6ff"); // saber blue

interface Rib {
  base: THREE.Vector3;
  tip: THREE.Vector3;
  age: number;
}

export class SaberTrail {
  readonly mesh: THREE.Mesh;
  private ribs: Rib[] = [];
  private geom: THREE.BufferGeometry;
  private posAttr: THREE.BufferAttribute;
  private colAttr: THREE.BufferAttribute;

  constructor() {
    this.geom = new THREE.BufferGeometry();
    // Preallocate for MAX_RIBS cross-sections (2 verts each).
    const verts = MAX_RIBS * 2;
    this.posAttr = new THREE.BufferAttribute(new Float32Array(verts * 3), 3);
    this.colAttr = new THREE.BufferAttribute(new Float32Array(verts * 3), 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    this.geom.setAttribute("position", this.posAttr);
    this.geom.setAttribute("color", this.colAttr);
    // Index: connect consecutive ribs (i, i+1) as two triangles.
    const idx: number[] = [];
    for (let i = 0; i < MAX_RIBS - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geom.setIndex(idx);
    this.geom.setDrawRange(0, 0);

    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geom, mat);
    this.mesh.frustumCulled = false; // the ribs move far from the mesh origin
    this.mesh.renderOrder = 5;
  }

  /** Feed the current blade segment (world space). Call once per swing frame. */
  push(base: THREE.Vector3, tip: THREE.Vector3) {
    this.ribs.push({ base: base.clone(), tip: tip.clone(), age: 0 });
    if (this.ribs.length > MAX_RIBS) this.ribs.shift();
  }

  /** Drop all ribs (call on swing START so a new arc never welds to the old one). */
  clear() {
    this.ribs.length = 0;
    this.geom.setDrawRange(0, 0);
  }

  /** Age the ribs every frame (whether or not swinging) and rebuild the strip. */
  update(dt: number) {
    if (this.ribs.length === 0) {
      if (this.geom.drawRange.count !== 0) this.geom.setDrawRange(0, 0);
      return;
    }
    for (let i = this.ribs.length - 1; i >= 0; i--) {
      this.ribs[i].age += dt;
      if (this.ribs[i].age >= RIB_LIFE) this.ribs.splice(i, 1);
    }
    const n = this.ribs.length;
    if (n < 2) {
      this.geom.setDrawRange(0, 0);
      return;
    }
    const pos = this.posAttr.array as Float32Array;
    const col = this.colAttr.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const r = this.ribs[i];
      const fade = Math.max(0, 1 - r.age / RIB_LIFE); // 1 fresh → 0 gone
      const o = i * 6;
      pos[o] = r.base.x; pos[o + 1] = r.base.y; pos[o + 2] = r.base.z;
      pos[o + 3] = r.tip.x; pos[o + 4] = r.tip.y; pos[o + 5] = r.tip.z;
      // Dim with age (additive → dimmer == fainter); the tip end a touch brighter.
      const cb = fade * 0.75;
      const ct = fade;
      col[o] = COLOR.r * cb; col[o + 1] = COLOR.g * cb; col[o + 2] = COLOR.b * cb;
      col[o + 3] = COLOR.r * ct; col[o + 4] = COLOR.g * ct; col[o + 5] = COLOR.b * ct;
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.geom.setDrawRange(0, (n - 1) * 6); // (n-1) quads × 6 indices
    // No computeBoundingSphere: frustumCulled is off, so the sphere is never used.
  }

  dispose() {
    this.geom.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
