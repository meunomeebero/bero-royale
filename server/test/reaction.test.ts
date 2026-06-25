import { makeHarness, assert, done } from "./_bot-harness.ts";
const ROOM = "voxelcube-ffa";

const h = makeHarness({ players: [{ id: "P", x: 0, z: 0 }] });
for (let i = 0; i < 20; i++) h.sim.tick(ROOM, 0.05);
// pick a calm bot
const b0 = h.inspect().find((b) => (b as any).reactT === 0)!;

// reposition player right next to the bot so retaliation range is guaranteed
h.setPlayers([{ id: "P", x: (b0 as any).x as number, z: (b0 as any).z as number }]);
// one tick so the bot's position-delta estimate sees the player at the new location
h.sim.tick(ROOM, 0.05);

// now shoot the bot from the player (player is right next to it)
h.sim.damageBot(ROOM, b0.id as string, "P");
const after = h.inspect().find((b) => b.id === b0.id)!;
assert((after.reactT as number) > 0, "reactT not seeded on a fresh hit (wasCalm seed dead)");

// during the ENTIRE startle window the bot must NOT fire at the player on ANY tick
let remaining = (after.reactT as number);
while (remaining > 0) {
  h.fanned.length = 0;
  h.sim.tick(ROOM, 0.05);
  const firedAtP = h.fanned.some(
    (m) => m.event === "shot" && m.from === b0.id && m.payload?.targetId === "P"
  );
  assert(!firedAtP, "bot fired at attacker during startle window (no reaction delay)");
  remaining -= 0.05;
}

// the bot orients toward the attacker (via retaliation) — this is immediate, not delayed
const orientSnap = h.inspect().find((b) => b.id === b0.id)!;
assert(orientSnap.targetId === "P", "bot did not orient to attacker after being shot (retaliation failed)");

// after the window elapses the bot can fire (targetId is still P)
for (let i = 0; i < 8; i++) h.sim.tick(ROOM, 0.05); // > 0.30s
const committed = h.inspect().find((b) => b.id === b0.id)!;
assert(committed.targetId === "P", "bot lost attacker target after startle window");

// vx/vz are always present in the snapshot (never stranded by a continue)
const lastSnap = [...h.fanned].reverse().find((m) => m.event === "s" && m.from === b0.id);
assert(lastSnap && typeof lastSnap.payload.vx === "number" && typeof lastSnap.payload.vz === "number", "snapshot missing vx/vz (stranded)");

done();
