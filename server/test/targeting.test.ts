import { describe, it, expect } from "vitest";
import { makeHarness } from "./_bot-harness.ts";
const ROOM = "voxelcube-ffa";

describe("targeting", () => {
  // (a) equal-by-distance: a bot does NOT always pick the player when a bot is nearer.
  it("(a) equal-by-distance: bots can target each other when player is far", () => {
    const h = makeHarness({ players: [{ id: "P", x: 40, z: 40 }] }); // player far in a corner
    for (let i = 0; i < 20; i++) h.sim.tick(ROOM, 0.05);
    const bots = h.inspect();
    const targetingPlayer = bots.filter((b) => b.targetId === "P").length;
    expect(targetingPlayer < bots.length, "every bot still targets the far player (not equal-by-distance)").toBeTruthy();
    expect(bots.some((b) => b.targetId && b.targetId !== "P"), "no bot is fighting another bot").toBeTruthy();
  }, 30000);

  // (b) player-attention floor: a lone PASSIVE player is targeted within a commit cycle.
  it("(b) player-attention floor: lone player is targeted in <8% untargeted trials", () => {
    let untargeted = 0, trials = 200;
    for (let t = 0; t < trials; t++) {
      const h = makeHarness({ players: [{ id: "P", x: (Math.random()*2-1)*40, z: (Math.random()*2-1)*40 }] });
      for (let i = 0; i < 40; i++) h.sim.tick(ROOM, 0.05); // ~2s, > max commitT
      if (!h.inspect().some((b) => b.targetId === "P")) untargeted++;
    }
    expect(untargeted / trials < 0.08, `lone player ignored ${(100*untargeted/trials).toFixed(1)}% (want <8%)`).toBeTruthy();
  }, 30000);

  // (c) commitment: no per-RETARGET_CD ping-pong between two equidistant enemies.
  it("(c) commitment: target does not flip more than 11 times in 2s", () => {
    const h = makeHarness({ players: [{ id: "P", x: 0, z: 0 }] });
    for (let i = 0; i < 60; i++) h.sim.tick(ROOM, 0.05);
    // sample one bot's targetId across consecutive retarget windows; it must not flip every window
    const id = h.inspect()[0].id;
    let flips = 0; let prev = h.inspect().find((b) => b.id === id)!.targetId;
    for (let i = 0; i < 40; i++) {
      h.sim.tick(ROOM, 0.05);
      const cur = h.inspect().find((b) => b.id === id)?.targetId;
      if (cur && cur !== prev) flips++;
      prev = cur;
    }
    expect(flips < 12, `target flipped ${flips} times in 2s (ping-pong; commit not holding)`).toBeTruthy();
  }, 30000);
});
