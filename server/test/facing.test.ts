import { makeHarness, assert, done } from "./_bot-harness.ts";
const ROOM = "voxelcube-ffa";
const MAX_TURN_RATE = 8, dt = 0.05;

const h = makeHarness({ players: [{ id: "P", x: 0, z: 0 }] });
for (let i = 0; i < 20; i++) h.sim.tick(ROOM, dt);
// track per-tick yaw delta of every bot; none may exceed the cap (+ tiny epsilon)
let prev = new Map(h.inspect().map((b) => [b.id as string, b.yaw as number]));
let maxStep = 0;
for (let i = 0; i < 40; i++) {
  h.sim.tick(ROOM, dt);
  for (const b of h.inspect()) {
    const p = prev.get(b.id as string);
    if (p != null && b.alive) {
      let d = Math.abs((b.yaw as number) - p);
      if (d > Math.PI) d = 2 * Math.PI - d;
      maxStep = Math.max(maxStep, d);
    }
    prev.set(b.id as string, b.yaw as number);
  }
}
assert(maxStep <= MAX_TURN_RATE * dt + 1e-6, `yaw snapped ${maxStep.toFixed(3)} rad in one tick (> cap ${(MAX_TURN_RATE*dt).toFixed(3)})`);
done();
