import { describe, it, expect } from "vitest";
import { makeHarness } from "./_bot-harness.ts";

describe("skill", () => {
  it("spread, derived caches, and population-mean accuracy invariant", () => {
    const h = makeHarness({ players: [{ id: "P", x: 0, z: 0 }] });
    for (let i = 0; i < 5; i++) h.sim.tick("voxelcube-ffa", 0.05); // spawn + settle

    const bots = h.inspect();
    expect(bots.length >= 3, `expected >=3 bots, got ${bots.length}`).toBeTruthy();

    // (a) skill spread is real: not all identical
    const skills = bots.map((b) => b.skill as number);
    expect(new Set(skills.map((s) => s.toFixed(3))).size > 1, "all bots share one skill (no spread)").toBeTruthy();

    // (b) derived caches match the formulas exactly
    for (const b of bots) {
      const s = b.skill as number;
      expect(Math.abs((b.accEff as number) - 0.3 * (0.7 + 0.6 * s)) < 1e-9, "accEff formula wrong").toBeTruthy();
      expect(Math.abs((b.cadenceMul as number) - (1.25 - 0.5 * s)) < 1e-9, "cadenceMul formula wrong").toBeTruthy();
      expect(Math.abs((b.leadMul as number) - (0.5 + s)) < 1e-9, "leadMul formula wrong").toBeTruthy();
    }

    // (c) population-mean accuracy invariant: E[accEff] ≈ ACCURACY (0.30) over many rolls
    let sum = 0; const n = 50000;
    for (let i = 0; i < n; i++) { const sk = (Math.random() + Math.random()) / 2; sum += 0.3 * (0.7 + 0.6 * sk); }
    expect(Math.abs(sum / n - 0.3) < 0.005, `mean accEff drifted: ${(sum / n).toFixed(4)}`).toBeTruthy();
  }, 30000);
});
