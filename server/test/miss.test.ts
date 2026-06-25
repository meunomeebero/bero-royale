import { makeHarness, assert, done } from "./_bot-harness.ts";
const ROOM = "voxelcube-ffa";

// Drive many shots at a smoothly-orbiting player; collect "shot" dir angles and whether targetId is set.
const h = makeHarness({ players: [{ id: "P", x: 4, z: 0, grounded: true }] });
for (let i = 0; i < 800; i++) {
  // Smooth circular path — stays in engagement range, gives nonzero lateral velocity for angular-speed term
  h.setPlayers([{ id: "P", x: 4 + 1.5 * Math.sin(i * 0.3), z: 1.5 * Math.cos(i * 0.3) }]);
  h.sim.tick(ROOM, 0.05);
}
const shots = h.fanned.filter((m) => m.event === "shot");
assert(shots.length > 15, `too few shots: ${shots.length}`);
// hits carry targetId and point ~straight; misses carry none and vary in sign
const misses = shots.filter((m) => m.payload.targetId == null);
const signs = new Set(misses.map((m) => Math.sign(Math.atan2(m.payload.dir.z, m.payload.dir.x))));
assert(misses.length > 5, `no misses observed: ${misses.length}`);
assert(signs.size >= 2 || misses.length < 8, "miss deflection has only one sign (formulaic)");
assert(shots.every((m) => typeof m.payload.dir.x === "number"), "shot dir malformed");
done();
