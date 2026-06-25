import { makeHarness, assert, done } from "./_bot-harness.ts";
const ROOM = "voxelcube-ffa";

const h = makeHarness({ players: [{ id: "P", x: 0, z: 0 }] });
for (let i = 0; i < 20; i++) h.sim.tick(ROOM, 0.05);
// pick a calm bot far from its target and shoot it from the player
const b0 = h.inspect().find((b) => (b as any).reactT === 0)!;
const before = h.fanned.length;
h.sim.damageBot(ROOM, b0.id as string, "P"); // player shoots the bot
const after = h.inspect().find((b) => b.id === b0.id)!;
assert((after.reactT as number) > 0, "reactT not seeded on a fresh hit (wasCalm seed dead)");
assert(after.pendingTargetId === "P", "pendingTargetId not stashed to attacker");

// during the startle the bot must NOT fire at the player on the very next tick
h.fanned.length = 0;
h.sim.tick(ROOM, 0.05);
const firedAtP = h.fanned.some((m) => m.event === "shot" && m.from === b0.id && m.payload?.targetId === "P");
assert(!firedAtP, "bot fired at attacker during startle window (no reaction delay)");

// after the window elapses it does turn & engage
for (let i = 0; i < 8; i++) h.sim.tick(ROOM, 0.05); // > 0.30s
const committed = h.inspect().find((b) => b.id === b0.id)!;
assert(committed.targetId === "P", "bot never turned to its attacker after the startle");

// vx/vz are always present in the snapshot (never stranded by a continue)
const lastSnap = [...h.fanned].reverse().find((m) => m.event === "s" && m.from === b0.id);
assert(lastSnap && typeof lastSnap.payload.vx === "number" && typeof lastSnap.payload.vz === "number", "snapshot missing vx/vz (stranded)");

done();
