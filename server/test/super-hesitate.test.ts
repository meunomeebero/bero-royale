import { makeHarness, assert, done } from "./_bot-harness.ts";
const ROOM = "voxelcube-ffa";

// A player parked in close range should eventually draw a super telegraph ("kame"),
// proving the hesitation commits and never permanently holds the slot.
const h = makeHarness({ players: [{ id: "P", x: 3, z: 0 }] });
let sawHesitate = false, sawKame = false;
for (let i = 0; i < 800; i++) { // long enough for superCd to elapse
  h.sim.tick(ROOM, 0.05);
  if (h.inspect().some((b) => (b.superHesitateT as number) > 0)) sawHesitate = true;
  if (h.fanned.some((m) => m.event === "kame")) { sawKame = true; break; }
}
assert(sawHesitate, "no bot ever entered super hesitation");
assert(sawKame, "hesitation never resolved into a fired super (slot held forever)");
done();
