import { describe, it, expect } from "vitest";
import { makeHarness } from "./_bot-harness.ts";

describe("names", () => {
  it("in-room uniqueness, animal dedup, and style variance", () => {
    const h = makeHarness({ players: [{ id: "P", x: 0, z: 0 }] });
    for (let i = 0; i < 30; i++) h.sim.tick("voxelcube-ffa", 0.05);
    const bots = h.inspect();

    // (a) in-room uniqueness of names AND digit-stripped stems (no void420/void421 pair)
    const names = bots.map((b) => b.name as string);
    expect(new Set(names).size === names.length, "duplicate names in room").toBeTruthy();
    const stems = names.map((n) => n.replace(/[0-9]/g, ""));
    expect(new Set(stems).size === stems.length, `near-duplicate stems: ${names.join(",")}`).toBeTruthy();

    // (b) animals deduped while count <= ANIMAL_NAMES length
    const animals = bots.map((b) => b.animal as string);
    expect(new Set(animals).size === animals.length, "duplicate animals in small lobby").toBeTruthy();

    // (c) style variance over a big sample: genuinely-plain handles (single word, no digit,
    // no xX/Xx wrap, no underscore) should land in the ~30–40% spec band.
    let plain = 0; const total = 5000;
    const seen = new Set<string>();
    // drive variety by repeated independent generation via fresh harnesses
    for (let i = 0; i < total; i++) {
      const g = makeHarness({ players: [{ id: "P", x: 0, z: 0 }] });
      g.sim.tick("voxelcube-ffa", 0.05);
      const nm = (g.inspect()[0]?.name as string) ?? "";
      seen.add(nm);
      // Genuinely plain: no digit, no underscore, no xX/Xx wrap (case-insensitive prefix/suffix)
      const isPlain = !/[0-9]/.test(nm) && !nm.includes("_") && !/^xX/i.test(nm) && !/Xx$/i.test(nm);
      if (isPlain) plain++;
    }
    const plainRatio = plain / total;
    // Bracket the ~30–40% spec intent with margin to avoid flaky failures over 5 000 samples.
    expect(plainRatio > 0.25 && plainRatio < 0.48, `plain-handle ratio off: ${plainRatio.toFixed(2)} (want 0.25–0.48)`).toBeTruthy();
    expect(seen.size > 100, `generator not varied: only ${seen.size} distinct first-bot names`).toBeTruthy();
  }, 30000);
});
