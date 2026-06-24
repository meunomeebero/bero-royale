import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { exportAnimal } from "./exporter.mjs";
import { measureOBJ, validate } from "./measure.mjs";

// CLI: build one AI-authored animal -> write the pack's 3-file model -> validate
// proportions against the existing pack's envelope.
//   node scripts/voxelgen/gen.mjs owl

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "..", "public", "models", "animals");

const which = process.argv[2];
if (!which) {
  console.error("usage: node scripts/voxelgen/gen.mjs <animal>");
  process.exit(1);
}

const mod = await import(`./animals/${which}.mjs`);
const grid = mod.build();
const stats = exportAnimal(grid, mod.name, OUT);
console.log(`✓ exported ${mod.name}: ${stats.verts} verts, ${stats.tris} tris, ${stats.colors} colors`);
console.log(`  -> ${stats.dir}`);

const m = measureOBJ(join(stats.dir, `${mod.name}.vox.obj`));
const v = validate(m);
console.log(`\n  size (world): ${m.w.toFixed(2)} × ${m.h.toFixed(2)} × ${m.d.toFixed(2)}  (W×H×D)`);
console.log(`  ratios: W/H=${v.ratios.wr.toFixed(2)}  D/H=${v.ratios.dr.toFixed(2)}  skew=${v.ratios.skew.toFixed(2)}`);
for (const c of v.checks) {
  const mark = c.ok ? "✓" : "✗";
  console.log(`  ${mark} ${c.name}: ${c.val.toFixed(2)} (want ${c.range[0]}..${c.range[1]})`);
}
console.log(`\n  ${v.ok ? "✓ COHERENT — fits the pack envelope" : "✗ OUT OF ENVELOPE — adjust the model"}`);
process.exit(v.ok ? 0 : 2);
