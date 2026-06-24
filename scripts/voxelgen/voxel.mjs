// A tiny voxel grid with CSG-style fill primitives — the "clay" an author (you
// or an LLM) shapes a character from. Coordinates are integer grid cells:
//   x = left..right, y = down..up (feet at low y), z = back..front.
// Colors are hex strings ("#rrggbb"); empty cells are null.
//
// This is deliberately primitive-based (boxes / ellipsoids / mirror) rather than
// per-voxel ASCII layers: blocking a body, head, ears and legs out of a handful
// of rounded boxes is far easier to keep proportional — which is exactly the
// coherence constraint the Bero pack needs.

export class VoxelGrid {
  constructor(w, h, d) {
    this.w = w;
    this.h = h;
    this.d = d;
    this.cells = new Array(w * h * d).fill(null);
  }

  idx(x, y, z) {
    return x + this.w * (y + this.h * z);
  }

  inBounds(x, y, z) {
    return x >= 0 && x < this.w && y >= 0 && y < this.h && z >= 0 && z < this.d;
  }

  get(x, y, z) {
    if (!this.inBounds(x, y, z)) return null;
    return this.cells[this.idx(x, y, z)];
  }

  set(x, y, z, color) {
    if (this.inBounds(x, y, z)) this.cells[this.idx(x, y, z)] = color;
  }

  /** Inclusive axis-aligned box. */
  box(x0, x1, y0, y1, z0, z1, color) {
    for (let z = z0; z <= z1; z++)
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) this.set(x, y, z, color);
    return this;
  }

  /** Solid ellipsoid centered at (cx,cy,cz) with radii (rx,ry,rz). */
  ellipsoid(cx, cy, cz, rx, ry, rz, color) {
    const x0 = Math.floor(cx - rx), x1 = Math.ceil(cx + rx);
    const y0 = Math.floor(cy - ry), y1 = Math.ceil(cy + ry);
    const z0 = Math.floor(cz - rz), z1 = Math.ceil(cz + rz);
    for (let z = z0; z <= z1; z++)
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const dx = (x - cx) / rx, dy = (y - cy) / ry, dz = (z - cz) / rz;
          if (dx * dx + dy * dy + dz * dz <= 1.0001) this.set(x, y, z, color);
        }
    return this;
  }

  /** Solid sphere — ellipsoid with equal radii. */
  sphere(cx, cy, cz, r, color) {
    return this.ellipsoid(cx, cy, cz, r, r, r, color);
  }

  /** Mirror every solid cell across the plane x = (w-1)/2 (left↔right symmetry). */
  symmetrizeX() {
    const snapshot = this.cells.slice();
    for (let z = 0; z < this.d; z++)
      for (let y = 0; y < this.h; y++)
        for (let x = 0; x < this.w; x++) {
          const c = snapshot[this.idx(x, y, z)];
          if (c != null) this.set(this.w - 1 - x, y, z, c);
        }
    return this;
  }

  /** Distinct colors in first-seen order — becomes the palette column order. */
  colors() {
    const seen = [];
    const set = new Set();
    for (const c of this.cells) {
      if (c != null && !set.has(c)) {
        set.add(c);
        seen.push(c);
      }
    }
    return seen;
  }

  /** Tight occupied bounding box in grid cells. */
  bounds() {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let z = 0; z < this.d; z++)
      for (let y = 0; y < this.h; y++)
        for (let x = 0; x < this.w; x++)
          if (this.cells[this.idx(x, y, z)] != null) {
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
            if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
          }
    return { minX, minY, minZ, maxX, maxY, maxZ };
  }
}
