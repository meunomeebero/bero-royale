import { describe, it, expect } from "vitest";
import { makeHarness } from "./_bot-harness.ts";
const ROOM = "voxelcube-ffa";

describe("reaction", () => {
  it("reactT seeded on hit, bot does not fire during startle window, orients to attacker, retains target after window", () => {
    const h = makeHarness({ players: [{ id: "P", x: 0, z: 0 }] });
    for (let i = 0; i < 20; i++) h.sim.tick(ROOM, 0.05);
    // pick a calm bot
    const b0 = h.inspect().find((b) => (b.reactT as number) === 0)!;

    // reposition player right next to the bot so retaliation range is guaranteed
    h.setPlayers([{ id: "P", x: b0.x as number, z: b0.z as number }]);
    // one tick so the bot's position-delta estimate sees the player at the new location
    h.sim.tick(ROOM, 0.05);

    // now shoot the bot from the player (player is right next to it)
    h.sim.damageBot(ROOM, b0.id as string, "P");
    const after = h.inspect().find((b) => b.id === b0.id)!;
    expect((after.reactT as number) > 0, "reactT not seeded on a fresh hit (wasCalm seed dead)").toBeTruthy();

    // during the ENTIRE startle window the bot must NOT fire at the player on ANY tick.
    // Stop one full tick before the window expires: on the boundary tick reactT can hit
    // 0 and firing becomes legal, so we exclude that last fractional tick from the guard.
    const DT = 0.05;
    let remaining = (after.reactT as number);
    while (remaining > DT) {
      h.fanned.length = 0;
      h.sim.tick(ROOM, 0.05);
      const firedAtP = h.fanned.some(
        (m) => m.event === "shot" && m.from === b0.id &&
          (m.payload as { targetId?: string } | null)?.targetId === "P"
      );
      expect(!firedAtP, "bot fired at attacker during startle window (no reaction delay)").toBeTruthy();
      remaining -= DT;
    }

    // the bot orients toward the attacker (via retaliation) — this is immediate, not delayed
    const orientSnap = h.inspect().find((b) => b.id === b0.id)!;
    expect(orientSnap.targetId === "P", "bot did not orient to attacker after being shot (retaliation failed)").toBeTruthy();

    // after the window elapses the bot can fire (targetId is still P)
    for (let i = 0; i < 8; i++) h.sim.tick(ROOM, 0.05); // > 0.30s
    const committed = h.inspect().find((b) => b.id === b0.id)!;
    expect(committed.targetId === "P", "bot lost attacker target after startle window").toBeTruthy();

    // vx/vz are always present in the snapshot (never stranded by a continue)
    const lastSnap = [...h.fanned].reverse().find((m) => m.event === "s" && m.from === b0.id);
    const lp = lastSnap?.payload as { vx?: unknown; vz?: unknown } | undefined;
    expect(lastSnap && typeof lp?.vx === "number" && typeof lp?.vz === "number", "snapshot missing vx/vz (stranded)").toBeTruthy();
  }, 30000);
});
