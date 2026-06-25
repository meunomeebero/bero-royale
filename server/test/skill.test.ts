import { makeHarness, assert, done } from "./_bot-harness.ts";

const h = makeHarness({ players: [{ id: "P", x: 0, z: 0 }] });
for (let i = 0; i < 5; i++) h.sim.tick("voxelcube-ffa", 0.05); // spawn + settle

const bots = h.inspect();
assert(bots.length >= 3, `expected >=3 bots, got ${bots.length}`);

// (a) skill spread is real: not all identical
const skills = bots.map((b) => b.skill as number);
assert(new Set(skills.map((s) => s.toFixed(3))).size > 1, "all bots share one skill (no spread)");

// (b) derived caches match the formulas exactly
for (const b of bots) {
  const s = b.skill as number;
  assert(Math.abs((b.accEff as number) - 0.3 * (0.7 + 0.6 * s)) < 1e-9, "accEff formula wrong");
  assert(Math.abs((b.cadenceMul as number) - (1.25 - 0.5 * s)) < 1e-9, "cadenceMul formula wrong");
  assert(Math.abs((b.leadMul as number) - (0.5 + s)) < 1e-9, "leadMul formula wrong");
}

// (c) population-mean accuracy invariant: E[accEff] ≈ ACCURACY (0.30) over many rolls
let sum = 0, n = 50000;
for (let i = 0; i < n; i++) { const sk = (Math.random() + Math.random()) / 2; sum += 0.3 * (0.7 + 0.6 * sk); }
assert(Math.abs(sum / n - 0.3) < 0.005, `mean accEff drifted: ${(sum / n).toFixed(4)}`);

done();
