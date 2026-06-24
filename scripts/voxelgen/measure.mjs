import { readFileSync } from "node:fs";

// Coherence check: a generated model must sit inside the proportion envelope of
// the existing pack. Measured from the 11 in-use animals (height-normalized):
//   width/height  ≈ 0.71 .. 0.87
//   depth/height  ≈ 0.71 .. 0.88
//   footprint roughly square (|w-d| small)
// The game re-normalizes height to 1, so only RATIOS matter, not absolute size.

export const ENVELOPE = {
  widthRatio: [0.6, 1.0],
  depthRatio: [0.6, 1.0],
  maxFootprintSkew: 0.35, // |w - d| / max(w, d)
};

export function measureOBJ(objPath) {
  const txt = readFileSync(objPath, "utf8");
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let verts = 0, tris = 0;
  for (const line of txt.split("\n")) {
    if (line.startsWith("v ")) {
      const [, x, y, z] = line.split(/\s+/);
      const X = +x, Y = +y, Z = +z;
      if (X < minX) minX = X; if (X > maxX) maxX = X;
      if (Y < minY) minY = Y; if (Y > maxY) maxY = Y;
      if (Z < minZ) minZ = Z; if (Z > maxZ) maxZ = Z;
      verts++;
    } else if (line.startsWith("f ")) tris++;
  }
  const w = maxX - minX, h = maxY - minY, d = maxZ - minZ;
  return { w, h, d, verts, tris, feetAtZero: Math.abs(minY) < 1e-6 };
}

export function validate(m) {
  const wr = m.w / m.h, dr = m.d / m.h;
  const skew = Math.abs(m.w - m.d) / Math.max(m.w, m.d);
  const checks = [
    { name: "width/height", val: wr, ok: wr >= ENVELOPE.widthRatio[0] && wr <= ENVELOPE.widthRatio[1], range: ENVELOPE.widthRatio },
    { name: "depth/height", val: dr, ok: dr >= ENVELOPE.depthRatio[0] && dr <= ENVELOPE.depthRatio[1], range: ENVELOPE.depthRatio },
    { name: "footprint skew", val: skew, ok: skew <= ENVELOPE.maxFootprintSkew, range: [0, ENVELOPE.maxFootprintSkew] },
    { name: "feet at y=0", val: m.feetAtZero ? 1 : 0, ok: m.feetAtZero, range: [1, 1] },
  ];
  return { ok: checks.every((c) => c.ok), checks, ratios: { wr, dr, skew } };
}
