import { makeHarness, assert, done } from "./_bot-harness.ts";
const ROOM = "voxelcube-ffa";

// Drive many shots at a strafing player; collect "shot" dir angles and whether targetId is set.
const h = makeHarness({ players: [{ id: "P", x: 6, z: 0, grounded: true }] });
for (let i = 0; i < 200; i++) {
  h.setPlayers([{ id: "P", x: 6, z: (i % 2 ? 3 : -3) }]); // jitter so vx/vz estimate is nonzero
  h.sim.tick(ROOM, 0.05);
}
const shots = h.fanned.filter((m) => m.event === "shot");
assert(shots.length > 20, `too few shots: ${shots.length}`);
// hits carry targetId and point ~straight; misses carry none and vary in sign
const misses = shots.filter((m) => m.payload.targetId == null);
const signs = new Set(misses.map((m) => Math.sign(Math.atan2(m.payload.dir.z, m.payload.dir.x))));
assert(misses.length > 5, "no misses observed");
assert(signs.size >= 2 || misses.length < 8, "miss deflection has only one sign (formulaic)");
assert(shots.every((m) => typeof m.payload.dir.x === "number"), "shot dir malformed");
done();
