import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { encodePNG } from "./png.mjs";

// Turn a VoxelGrid into the exact 3-file shape the Bero pack uses:
//   <name>.vox.obj   surface mesh (culled voxel faces, triangulated, shared verts)
//   <name>.vox.mtl   single flat "palette" material -> the png
//   <name>.vox.png   256x1 palette strip; each color lives in its own column
//
// Conventions matched to MagicaVoxel's export (and to ModelLibrary's loader):
//   - 1 voxel = 0.1 world units
//   - feet at y=0, model centered in X and Z
//   - UV per face = (colorColumn + 0.5)/256 on a 1px-tall strip, v=0.5
//   - faces wound CCW outward (MeshLambertMaterial is single-sided)

const VOXEL = 0.1;

// 6 face directions as (axis a, sign s). normal = s along axis a.
// For each we pick the two in-plane axes (u, v) used by the greedy mesher.
const DIRS = [
  { a: 0, s: +1, u: 2, v: 1 }, // +X
  { a: 0, s: -1, u: 2, v: 1 }, // -X
  { a: 1, s: +1, u: 0, v: 2 }, // +Y
  { a: 1, s: -1, u: 0, v: 2 }, // -Y
  { a: 2, s: +1, u: 0, v: 1 }, // +Z
  { a: 2, s: -1, u: 0, v: 1 }, // -Z
];

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Greedy voxel meshing: per face-direction, per slice, merge coplanar same-color
 * exposed faces into the largest possible rectangles. Cuts triangle count ~10x
 * vs one-quad-per-voxel, bringing generated models in line with the hand-made
 * pack. Returns quads: { corners:[[x,y,z]×4 grid units], normal, color }.
 */
function greedyQuads(grid) {
  const dim = [grid.w, grid.h, grid.d];
  const quads = [];

  for (const { a, s, u, v } of DIRS) {
    const normal = [0, 0, 0];
    normal[a] = s;
    const A = dim[a], U = dim[u], V = dim[v];

    for (let la = 0; la < A; la++) {
      // exposed-face mask on this slice: color or null
      const mask = new Array(U * V).fill(null);
      for (let iv = 0; iv < V; iv++)
        for (let iu = 0; iu < U; iu++) {
          const c = [0, 0, 0];
          c[a] = la; c[u] = iu; c[v] = iv;
          const col = grid.get(c[0], c[1], c[2]);
          if (col == null) continue;
          const n = [c[0], c[1], c[2]];
          n[a] = la + s;
          if (grid.get(n[0], n[1], n[2]) != null) continue; // hidden
          mask[iu + iv * U] = col;
        }

      // merge rectangles
      for (let jv = 0; jv < V; jv++)
        for (let ju = 0; ju < U; ) {
          const col = mask[ju + jv * U];
          if (col == null) { ju++; continue; }
          // width
          let w = 1;
          while (ju + w < U && mask[ju + w + jv * U] === col) w++;
          // height
          let h = 1;
          grow: while (jv + h < V) {
            for (let k = 0; k < w; k++) if (mask[ju + k + (jv + h) * U] !== col) break grow;
            h++;
          }
          for (let dy = 0; dy < h; dy++)
            for (let dx = 0; dx < w; dx++) mask[ju + dx + (jv + dy) * U] = null;

          const p = la + (s > 0 ? 1 : 0); // face plane along axis a
          const mk = (uu, vv) => { const c = [0, 0, 0]; c[a] = p; c[u] = uu; c[v] = vv; return c; };
          let corners = [mk(ju, jv), mk(ju + w, jv), mk(ju + w, jv + h), mk(ju, jv + h)];
          // ensure CCW outward winding
          const e1 = corners[1].map((c, i) => c - corners[0][i]);
          const e2 = corners[2].map((c, i) => c - corners[0][i]);
          if (dot(cross(e1, e2), normal) < 0) corners = [corners[0], corners[3], corners[2], corners[1]];
          quads.push({ corners, normal, color: col });
          ju += w;
        }
    }
  }
  return quads;
}

/** Build OBJ/MTL strings + PNG buffer from a grid. Pure (no disk writes). */
export function buildModel(grid, name) {
  const colors = grid.colors();
  const column = new Map(colors.map((c, i) => [c, i])); // color -> palette column

  const b = grid.bounds();
  // world = (cell - center) * VOXEL ; feet (minY) -> y=0 ; centered in X/Z
  const cx = (b.minX + b.maxX + 1) / 2;
  const cz = (b.minZ + b.maxZ + 1) / 2;
  const toWorld = (gx, gy, gz) => [
    +((gx - cx) * VOXEL).toFixed(4),
    +((gy - b.minY) * VOXEL).toFixed(4),
    +((gz - cz) * VOXEL).toFixed(4),
  ];

  const verts = [];
  const vIndex = new Map(); // "x,y,z" -> 1-based index
  const uvs = []; // one per palette column actually used
  const uvIndex = new Map(); // column -> 1-based index
  const normals = []; // deduped, 1-based
  const nIndex = new Map();
  const tris = []; // [ [v,vt,vn] x3 ]

  const vertId = (gx, gy, gz) => {
    const w = toWorld(gx, gy, gz);
    const key = w.join(",");
    let id = vIndex.get(key);
    if (!id) {
      verts.push(w);
      id = verts.length;
      vIndex.set(key, id);
    }
    return id;
  };

  const uvId = (col) => {
    let id = uvIndex.get(col);
    if (!id) {
      uvs.push(+((col + 0.5) / 256).toFixed(6));
      id = uvs.length;
      uvIndex.set(col, id);
    }
    return id;
  };

  const normalId = (n) => {
    const key = n.join(",");
    let id = nIndex.get(key);
    if (!id) {
      normals.push(n);
      id = normals.length;
      nIndex.set(key, id);
    }
    return id;
  };

  for (const q of greedyQuads(grid)) {
    const vt = uvId(column.get(q.color));
    const vn = normalId(q.normal);
    const ids = q.corners.map((c) => vertId(c[0], c[1], c[2]));
    tris.push([[ids[0], vt, vn], [ids[1], vt, vn], [ids[2], vt, vn]]);
    tris.push([[ids[0], vt, vn], [ids[2], vt, vn], [ids[3], vt, vn]]);
  }

  // ---- OBJ ----
  const L = ["# Bero voxelgen", "", "o ", "", `mtllib ${name}.vox.mtl`, "usemtl palette", ""];
  L.push("# normals");
  for (const [x, y, z] of normals) L.push(`vn ${x} ${y} ${z}`);
  L.push("", "# texcoords");
  for (const u of uvs) L.push(`vt ${u} 0.5`);
  L.push("", "# verts");
  for (const [x, y, z] of verts) L.push(`v ${x} ${y} ${z}`);
  L.push("", "# faces");
  for (const t of tris) L.push("f " + t.map(([v, vt, vn]) => `${v}/${vt}/${vn}`).join(" "));
  const obj = L.join("\n") + "\n";

  // ---- MTL ----
  const mtl = [
    "# Bero voxelgen",
    "newmtl palette",
    "illum 1",
    "Ka 0.000 0.000 0.000",
    "Kd 1.000 1.000 1.000",
    "Ks 0.000 0.000 0.000",
    `map_Kd ${name}.vox.png`,
    "",
  ].join("\n");

  // ---- PNG (256x1 palette strip) ----
  const rgb = new Uint8Array(256 * 3); // unused columns stay black
  colors.forEach((hex, i) => {
    const [r, g, bl] = hexToRgb(hex);
    rgb[i * 3] = r;
    rgb[i * 3 + 1] = g;
    rgb[i * 3 + 2] = bl;
  });
  const png = encodePNG(256, 1, rgb);

  return { obj, mtl, png, stats: { verts: verts.length, tris: tris.length, colors: colors.length } };
}

/** Build + write the 3 files into <outDir>/<name>/. Returns stats. */
export function exportAnimal(grid, name, outDir) {
  const { obj, mtl, png, stats } = buildModel(grid, name);
  const dir = join(outDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.vox.obj`), obj);
  writeFileSync(join(dir, `${name}.vox.mtl`), mtl);
  writeFileSync(join(dir, `${name}.vox.png`), png);
  return { ...stats, dir };
}
