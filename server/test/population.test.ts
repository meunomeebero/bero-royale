import { describe, it, expect } from "vitest";
import { makeHarness } from "./_bot-harness.ts";

describe("population", () => {
  it("bot count stays in [3,6], holds across ticks, ignores player joins, and re-rolls after clearRoom", () => {
    const h = makeHarness({ players: [{ id: "P", x: 0, z: 0 }] });
    for (let i = 0; i < 10; i++) h.sim.tick("voxelcube-ffa", 0.05);
    const n1 = h.inspect().length;
    expect(n1 >= 3 && n1 <= 6, `bot count out of [3,6]: ${n1}`).toBeTruthy();

    // held across ticks (no churn): count stays put
    for (let i = 0; i < 40; i++) h.sim.tick("voxelcube-ffa", 0.05);
    expect(h.inspect().length === n1, "bot count drifted within a session").toBeTruthy();

    // flat regardless of more players joining
    h.setPlayers([{ id: "P", x: 0, z: 0 }, { id: "Q", x: 5, z: 5 }, { id: "R", x: -5, z: 5 }]);
    for (let i = 0; i < 10; i++) h.sim.tick("voxelcube-ffa", 0.05);
    expect(h.inspect().length === n1, "bot count changed when players joined (should be flat)").toBeTruthy();

    // teardown re-rolls; a fresh activation can differ; grace (no clearRoom) would keep it
    h.sim.clearRoom("voxelcube-ffa");
    expect(h.inspect().length === 0, "clearRoom did not drop bots").toBeTruthy();
    for (let i = 0; i < 10; i++) h.sim.tick("voxelcube-ffa", 0.05);
    const n2 = h.inspect().length;
    expect(n2 >= 3 && n2 <= 6, `re-roll out of [3,6]: ${n2}`).toBeTruthy();
  }, 30000);
});
