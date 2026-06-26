import { describe, test, expect } from "vitest";
import { RoomHub } from "../src/ws/rooms";

/**
 * Server side of the "damage-on-arrival" contract: the impact-tick scheduler
 * (RoomHub.enqueueHit / drainPendingHits). This is what makes a bot's damage land
 * WHEN its visible tracer arrives instead of ~0.3-0.4s earlier ("die to an
 * invisible shot"). Deterministic, no WS server / postgres / DOM — `now` is passed
 * in. The client end of the same contract is covered by LethalImpactGate.test.ts.
 * See docs/systems/netcode-hit-sync-plan.md (Phase 1) + docs/systems/netcode-testing.md.
 */
describe("RoomHub impact-tick scheduler (damage-on-arrival)", () => {
  test("a hit resolves only at/after its applyAt", () => {
    const hub = new RoomHub();
    const fired: number[] = [];
    hub.enqueueHit("r", { applyAt: 1100, resolve: () => fired.push(1100) });
    hub.drainPendingHits("r", 1050); // tracer still in flight
    expect(fired).toEqual([]);
    hub.drainPendingHits("r", 1100); // applyAt reached (<=)
    expect(fired).toEqual([1100]);
  });

  test("a resolved hit never fires twice (drained exactly once)", () => {
    const hub = new RoomHub();
    let n = 0;
    hub.enqueueHit("r", { applyAt: 1000, resolve: () => (n += 1) });
    hub.drainPendingHits("r", 2000);
    hub.drainPendingHits("r", 3000);
    expect(n).toBe(1);
  });

  test("due hits resolve in insertion order; not-yet-due ones are kept", () => {
    const hub = new RoomHub();
    const order: string[] = [];
    hub.enqueueHit("r", { applyAt: 1200, resolve: () => order.push("late") });
    hub.enqueueHit("r", { applyAt: 1000, resolve: () => order.push("a") });
    hub.enqueueHit("r", { applyAt: 1000, resolve: () => order.push("b") });
    hub.drainPendingHits("r", 1000);
    expect(order).toEqual(["a", "b"]); // insertion order among the due; "late" kept
    hub.drainPendingHits("r", 1200);
    expect(order).toEqual(["a", "b", "late"]);
  });

  test("per-room queues are independent", () => {
    const hub = new RoomHub();
    const fired: string[] = [];
    hub.enqueueHit("r1", { applyAt: 1000, resolve: () => fired.push("r1") });
    hub.enqueueHit("r2", { applyAt: 1000, resolve: () => fired.push("r2") });
    hub.drainPendingHits("r1", 2000);
    expect(fired).toEqual(["r1"]);
    hub.drainPendingHits("r2", 2000);
    expect(fired).toEqual(["r1", "r2"]);
  });

  test("damage lands WITH the tracer: applyAt = fireTime + max(MIN_TRAVEL, dist/SPEED*1000)", () => {
    // Mirrors the formula in server/src/ws/bots.ts fire(). Damage scheduled for the
    // tracer's true arrival must NOT resolve while the bullet is still travelling.
    const BULLET_SPEED = 22;
    const MIN_TRAVEL_MS = 90;
    const hub = new RoomHub();
    const fireTime = 10_000;
    const dist = 8; // 8 / 22 * 1000 ≈ 364 ms of travel
    const applyAt = fireTime + Math.max(MIN_TRAVEL_MS, (dist / BULLET_SPEED) * 1000);
    let landed = false;
    hub.enqueueHit("r", { applyAt, resolve: () => (landed = true) });
    hub.drainPendingHits("r", fireTime + 100); // mid-flight
    expect(landed).toBe(false);
    hub.drainPendingHits("r", Math.ceil(applyAt)); // tracer arrives → damage lands
    expect(landed).toBe(true);
  });

  test("point-blank shots are floored to MIN_TRAVEL_MS (still a visible tracer)", () => {
    const MIN_TRAVEL_MS = 90;
    const hub = new RoomHub();
    const fireTime = 5_000;
    const applyAt = fireTime + Math.max(MIN_TRAVEL_MS, 0); // dist ~0 → floored
    let landed = false;
    hub.enqueueHit("r", { applyAt, resolve: () => (landed = true) });
    hub.drainPendingHits("r", fireTime + MIN_TRAVEL_MS - 1);
    expect(landed).toBe(false);
    hub.drainPendingHits("r", fireTime + MIN_TRAVEL_MS);
    expect(landed).toBe(true);
  });

  test("the defensive 512-cap keeps the queue bounded under a runaway producer", () => {
    const hub = new RoomHub();
    let fired = 0;
    for (let i = 0; i < 600; i++) {
      hub.enqueueHit("r", { applyAt: 1000, resolve: () => (fired += 1) });
    }
    hub.drainPendingHits("r", 2000);
    expect(fired).toBe(512); // oldest 88 dropped by the cap, never resolved
  });
});
