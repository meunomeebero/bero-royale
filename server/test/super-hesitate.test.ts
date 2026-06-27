import { describe, it, expect } from "vitest";
import { makeHarness } from "./_bot-harness.ts";
const ROOM = "voxelcube-ffa";

describe("super-hesitate", () => {
  it("hesitation is observed and eventually resolves into a fired super (no permanent slot hold)", () => {
    // A player parked in close range should eventually draw a super telegraph ("kame"),
    // proving the hesitation commits and never permanently holds the slot.
    const h = makeHarness({ players: [{ id: "P", x: 3, z: 0 }] });
    let sawHesitate = false, sawKame = false;
    for (let i = 0; i < 800; i++) { // long enough for superCd to elapse
      h.sim.tick(ROOM, 0.05);
      if (h.inspect().some((b) => (b.superHesitateT as number) > 0)) sawHesitate = true;
      if (h.fanned.some((m) => m.event === "kame")) { sawKame = true; break; }
    }
    expect(sawHesitate, "no bot ever entered super hesitation").toBeTruthy();
    expect(sawKame, "hesitation never resolved into a fired super (slot held forever)").toBeTruthy();
  }, 30000);
});
