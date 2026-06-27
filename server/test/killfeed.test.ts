import { describe, it, expect } from "vitest";
import { makeHarness, Captured } from "./_bot-harness.ts";
const ROOM = "voxelcube-ffa";

describe("killfeed", () => {
  it("bot→bot kill emits kill event with capped streak and increments killer kills", () => {
    const h = makeHarness({ players: [{ id: "P", x: 0, z: 0 }] });
    for (let i = 0; i < 5; i++) h.sim.tick(ROOM, 0.05);
    const ids = h.inspect().map((b) => b.id as string);
    const [killer, victim] = ids;

    // drive the victim to death by repeated bot→bot damage from `killer`
    let killEvt: Captured | undefined;
    for (let i = 0; i < 12 && !killEvt; i++) {
      const before = h.fanned.length;
      h.sim.damageBot(ROOM, victim, killer);
      killEvt = h.fanned.slice(before).find((m) => m.event === "kill");
    }
    expect(killEvt, "no kill feed line emitted for a bot→bot frag").toBeTruthy();
    const kp = killEvt!.payload as { streak: number };
    expect(kp.streak <= 2, `streak not capped at 2: ${kp.streak}`).toBeTruthy();
    const k = h.inspect().find((b) => b.id === killer);
    expect((k!.kills as number) >= 1, "killer kills not incremented").toBeTruthy();
    const v = h.inspect().find((b) => b.id === victim);
    expect((v!.streak as number) === 0, "victim streak not reset on death").toBeTruthy();
  });
});
