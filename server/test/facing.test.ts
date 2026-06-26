import { describe, it, expect } from "vitest";
import { makeHarness } from "./_bot-harness.ts";
const ROOM = "voxelcube-ffa";
const MAX_TURN_RATE = 8, dt = 0.05;
const epsilon = 1e-6;
const cap = MAX_TURN_RATE * dt; // max allowed single-tick yaw delta (0.4 rad)

// Wrap a yaw delta to [-π, π] before taking the magnitude.
function wrapDelta(d: number): number {
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d);
}

describe("facing", () => {
  it("single-tick yaw slew cap holds for 180° flip and across a moving-player run", () => {
    // ── Part A: single-tick large-turn guard ──────────────────────────────────────
    // Spawn with a player off to one side, let bots orient toward it (slewed, ~20 ticks),
    // then MOVE the player to the OPPOSITE side (≈180° flip). A single tick must only
    // advance yaw by ≤ MAX_TURN_RATE*dt — NOT by ~π as a hard set would.
    const h = makeHarness({ players: [{ id: "P", x: 30, z: 0 }] });
    for (let i = 0; i < 20; i++) h.sim.tick(ROOM, dt);

    // Pick the first alive bot.
    const bots0 = h.inspect().filter((b) => b.alive);
    expect(bots0.length > 0, "no alive bots after warm-up").toBeTruthy();
    const b0id = bots0[0].id as string;
    const yawBefore = bots0[0].yaw as number;

    // Move player to roughly the opposite side of b0 (force ~180° desired heading change).
    const b0x = bots0[0].x as number;
    const b0z = bots0[0].z as number;
    // Place player on the diametrically opposite side, far enough to be a clear target.
    h.setPlayers([{ id: "P", x: b0x - 30, z: b0z }]);

    // Tick ONCE — yaw must slew at most cap rad, not jump ~π.
    h.sim.tick(ROOM, dt);
    const afterSnap = h.inspect();
    const b0after = afterSnap.find((b) => (b.id as string) === b0id);
    expect(b0after != null && b0after.alive, "b0 died unexpectedly").toBeTruthy();
    const singleTickDelta = wrapDelta((b0after!.yaw as number) - yawBefore);
    expect(
      singleTickDelta <= cap + epsilon,
      `180° flip: single-tick yaw snap ${singleTickDelta.toFixed(4)} rad > slew cap ${cap.toFixed(4)} rad — slew missing in HUNT or ENGAGE branch`,
    ).toBeTruthy();

    // ── Part B: global per-tick cap over a long run with a moving player ─────────
    // Covers ALL branches (ENGAGE, HUNT, SEEK_ITEM).  A moving player forces frequent
    // direction changes; no alive bot may ever snap more than cap+epsilon in one tick.
    let px = 0, pz = 0;
    const h2 = makeHarness({ players: [{ id: "Q", x: px, z: pz }] });
    // Warm up.
    for (let i = 0; i < 20; i++) h2.sim.tick(ROOM, dt);

    let prev = new Map(h2.inspect().map((b) => [b.id as string, b.yaw as number]));
    let maxStep = 0;
    for (let i = 0; i < 60; i++) {
      // Move player in a circle so bots must continuously re-orient.
      const angle = i * 0.25;
      px = Math.cos(angle) * 20;
      pz = Math.sin(angle) * 20;
      h2.setPlayers([{ id: "Q", x: px, z: pz }]);
      const beforeFanned = h2.fanned.length;
      h2.sim.tick(ROOM, dt);
      // Exclude bots that dashed this tick: startDash intentionally hard-sets yaw to the
      // lunge direction (a separate mechanic from the slew cap under test here).
      const dashedIds = new Set(h2.fanned.slice(beforeFanned).filter((m) => m.event === "dash").map((m) => m.from));
      for (const b of h2.inspect()) {
        if (!b.alive) continue;
        if (dashedIds.has(b.id as string)) { prev.set(b.id as string, b.yaw as number); continue; }
        const p = prev.get(b.id as string);
        if (p != null) {
          const d = wrapDelta((b.yaw as number) - p);
          maxStep = Math.max(maxStep, d);
        }
        prev.set(b.id as string, b.yaw as number);
      }
    }
    expect(
      maxStep <= cap + epsilon,
      `global yaw snap ${maxStep.toFixed(4)} rad in one tick (> slew cap ${cap.toFixed(4)}) — branch still does a hard b.yaw= set`,
    ).toBeTruthy();
  }, 30000);
});
