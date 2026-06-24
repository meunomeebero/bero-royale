import { writeFileSync } from "node:fs";
import { encodePNG } from "./png.mjs";

// Offline preview: rasterize a VoxelGrid to an isometric PNG so the shape can be
// eyeballed without a browser or the game. Painter's algorithm, 3 lit faces per
// cube (top brightest, front mid, right darkest). Not shipped — a design aid.

const BG = [24, 26, 30];

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
const shade = ([r, g, b], k) => [Math.round(r * k), Math.round(g * k), Math.round(b * k)];

// Isometric projection of a grid corner -> screen (pre-offset/scale) units.
const proj = (x, y, z) => [x - z, (x + z) * 0.5 - y];

function fillPoly(canvas, W, H, pts, rgb) {
  let minY = Infinity, maxY = -Infinity;
  for (const [, py] of pts) { minY = Math.min(minY, py); maxY = Math.max(maxY, py); }
  minY = Math.max(0, Math.floor(minY)); maxY = Math.min(H - 1, Math.ceil(maxY));
  for (let y = minY; y <= maxY; y++) {
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k])), xb = Math.min(W - 1, Math.floor(xs[k + 1]));
      for (let px = xa; px <= xb; px++) {
        const o = (y * W + px) * 3;
        canvas[o] = rgb[0]; canvas[o + 1] = rgb[1]; canvas[o + 2] = rgb[2];
      }
    }
  }
}

export function renderIso(grid, outPath, scale = 12) {
  // collect solid voxels + projected bounds
  const vox = [];
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (let z = 0; z < grid.d; z++)
    for (let y = 0; y < grid.h; y++)
      for (let x = 0; x < grid.w; x++) {
        const c = grid.get(x, y, z);
        if (c == null) continue;
        vox.push([x, y, z, c]);
        for (const [dx, dy, dz] of [[0, 0, 0], [1, 1, 1]]) {
          const [u, v] = proj(x + dx, y + dy, z + dz);
          minU = Math.min(minU, u); maxU = Math.max(maxU, u);
          minV = Math.min(minV, v); maxV = Math.max(maxV, v);
        }
      }

  const pad = 8;
  const W = Math.ceil((maxU - minU) * scale) + pad * 2;
  const H = Math.ceil((maxV - minV) * scale) + pad * 2;
  const canvas = new Uint8Array(W * H * 3);
  for (let i = 0; i < W * H; i++) { canvas[i * 3] = BG[0]; canvas[i * 3 + 1] = BG[1]; canvas[i * 3 + 2] = BG[2]; }

  const sx = (u) => pad + (u - minU) * scale;
  const sy = (v) => H - pad - (v - minV) * scale; // flip: world-up -> screen-up

  // painter's: far (small x+y+z) first
  vox.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));

  for (const [x, y, z, hex] of vox) {
    const base = hexToRgb(hex);
    const P = (cx, cy, cz) => { const [u, v] = proj(cx, cy, cz); return [sx(u), sy(v)]; };
    // top (+Y), brightest
    fillPoly(canvas, W, H, [P(x, y + 1, z), P(x + 1, y + 1, z), P(x + 1, y + 1, z + 1), P(x, y + 1, z + 1)], shade(base, 1.0));
    // front (+Z), mid
    fillPoly(canvas, W, H, [P(x, y, z + 1), P(x + 1, y, z + 1), P(x + 1, y + 1, z + 1), P(x, y + 1, z + 1)], shade(base, 0.82));
    // right (+X), darkest
    fillPoly(canvas, W, H, [P(x + 1, y, z), P(x + 1, y, z + 1), P(x + 1, y + 1, z + 1), P(x + 1, y + 1, z)], shade(base, 0.64));
  }

  writeFileSync(outPath, encodePNG(W, H, canvas));
  return { W, H };
}
