import { makeHarness, assert, done } from "./_bot-harness.ts";
const ROOM = "voxelcube-ffa";

// (a) equal-by-distance: a bot does NOT always pick the player when a bot is nearer.
{
  const h = makeHarness({ players: [{ id: "P", x: 40, z: 40 }] }); // player far in a corner
  for (let i = 0; i < 20; i++) h.sim.tick(ROOM, 0.05);
  const bots = h.inspect();
  const targetingPlayer = bots.filter((b) => b.targetId === "P").length;
  assert(targetingPlayer < bots.length, "every bot still targets the far player (not equal-by-distance)");
  assert(bots.some((b) => b.targetId && b.targetId !== "P"), "no bot is fighting another bot");
}

// (b) player-attention floor: a lone PASSIVE player is targeted within a commit cycle.
{
  let untargeted = 0, trials = 200;
  for (let t = 0; t < trials; t++) {
    const h = makeHarness({ players: [{ id: "P", x: (Math.random()*2-1)*40, z: (Math.random()*2-1)*40 }] });
    for (let i = 0; i < 40; i++) h.sim.tick(ROOM, 0.05); // ~2s, > max commitT
    if (!h.inspect().some((b) => b.targetId === "P")) untargeted++;
  }
  assert(untargeted / trials < 0.08, `lone player ignored ${(100*untargeted/trials).toFixed(1)}% (want <8%)`);
}

// (c) commitment: no per-RETARGET_CD ping-pong between two equidistant enemies.
{
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
  assert(flips < 12, `target flipped ${flips} times in 2s (ping-pong; commit not holding)`);
}

done();
