import { describe, it, expect } from "vitest";
import { makeHarness } from "./_bot-harness.ts";
const ROOM = "voxelcube-ffa";

describe("miss", () => {
  it("shots fired, misses observed with sign variance, dir always well-formed", () => {
    // Drive many shots at a smoothly-orbiting player; collect "shot" dir angles and whether targetId is set.
    const h = makeHarness({ players: [{ id: "P", x: 4, z: 0, grounded: true }] });
    for (let i = 0; i < 800; i++) {
      // Smooth circular path — stays in engagement range, gives nonzero lateral velocity for angular-speed term
      h.setPlayers([{ id: "P", x: 4 + 1.5 * Math.sin(i * 0.3), z: 1.5 * Math.cos(i * 0.3) }]);
      h.sim.tick(ROOM, 0.05);
    }
    const shots = h.fanned.filter((m) => m.event === "shot");
    expect(shots.length > 15, `too few shots: ${shots.length}`).toBeTruthy();
    // hits carry targetId and point ~straight; misses carry none and vary in sign
    const misses = shots.filter((m) => m.payload.targetId == null);
    const signs = new Set(misses.map((m) => Math.sign(Math.atan2(m.payload.dir.z, m.payload.dir.x))));
    expect(misses.length > 5, `no misses observed: ${misses.length}`).toBeTruthy();
    expect(signs.size >= 2 || misses.length < 8, "miss deflection has only one sign (formulaic)").toBeTruthy();
    expect(shots.every((m) => typeof m.payload.dir.x === "number"), "shot dir malformed").toBeTruthy();
  }, 30000);
});
