import { describe, it, expect } from "vitest";
import { makeHarness } from "./_bot-harness.ts";

const ROOM = "voxelcube-ffa";
const dt = 0.05;

/**
 * Server-authoritative SABER (hit-stun) + CLASH coverage.
 *
 * Contexts under test (the golden rule — every mechanic in EVERY context):
 *  - bot → player saber: a bot in melee range fans "melee" (the arc) and, at strike
 *    time, "meleehit" (the stun cue) at the player victim;
 *  - bot snapshot weapon flips to "saber" while swinging, "gun" otherwise;
 *  - client-declared CLASH on a bot cancels that bot's in-flight swing (b.clashed)
 *    so its scheduled strike does NO damage, and recoils the bot.
 *
 * Strike timing: startSaberSwing enqueues the strike at MELEE_SWING_DUR*0.18 ≈ 72ms.
 * Tests drain with an explicit far-future `now` (Number.MAX_SAFE_INTEGER) so the
 * scheduled strike always resolves without depending on real wall-clock elapsing.
 */
const FUTURE = Number.MAX_SAFE_INTEGER;
describe("saber", () => {
  it("a bot in melee range swings: fans 'melee' (arc) and 'meleehit' (stun) at a player", () => {
    // Player parked at origin; bots spawn far, so steer a bot in by ticking until one
    // is within saber range, then assert the swing fans.
    const h = makeHarness({ players: [{ id: "P", x: 0, z: 0 }] });

    let sawMelee = false;
    let sawMeleeHit = false;
    let sawSaberWeapon = false;

    for (let i = 0; i < 400 && !(sawMelee && sawMeleeHit); i++) {
      const before = h.fanned.length;
      h.sim.tick(ROOM, dt);
      h.drainHits(FUTURE); // resolve the scheduled strike (≈72ms after a swing starts)
      for (let j = before; j < h.fanned.length; j++) {
        const m = h.fanned[j];
        if (m.event === "melee") {
          sawMelee = true;
          const pl = m.payload as { id: string; origin: unknown; dir: { x: number; z: number } };
          expect(typeof pl.id).toBe("string");
          expect(pl.origin).toBeTruthy();
          expect(Number.isFinite(pl.dir.x) && Number.isFinite(pl.dir.z)).toBe(true);
        }
        if (m.event === "meleehit") {
          const pl = m.payload as {
            id: string; target: string; stunMs: number; fireLockMs: number; interruptCharge: boolean;
          };
          if (pl.target === "P") {
            sawMeleeHit = true;
            expect(pl.stunMs).toBe(250);
            expect(pl.fireLockMs).toBe(1000);
            expect(pl.interruptCharge).toBe(true);
          }
        }
        if (m.event === "s") {
          const pl = m.payload as { weapon?: string };
          if (pl.weapon === "saber") sawSaberWeapon = true;
        }
      }
    }

    expect(sawMelee, "no bot ever fanned a 'melee' swing arc at the parked player").toBe(true);
    expect(sawMeleeHit, "no bot ever fanned a 'meleehit' stun cue at the player victim").toBe(true);
    expect(sawSaberWeapon, "snapshot weapon never flipped to 'saber' during a swing").toBe(true);
  }, 30000);

  it("a client-declared clash cancels the named bot's in-flight swing (no damage) + recoils it", () => {
    const h = makeHarness({ players: [{ id: "P", x: 0, z: 0 }] });

    // Drive a bot to start a swing (melee event fanned), capture its id, then declare a
    // clash naming it BEFORE the strike resolves and assert the strike does no damage.
    let swungBotId: string | null = null;
    for (let i = 0; i < 400 && swungBotId == null; i++) {
      const before = h.fanned.length;
      h.sim.tick(ROOM, dt);
      for (let j = before; j < h.fanned.length; j++) {
        if (h.fanned[j].event === "melee") {
          swungBotId = h.fanned[j].from;
          break;
        }
      }
      if (swungBotId == null) h.drainHits(); // only drain when no fresh swing to clash
    }
    expect(swungBotId, "no bot started a swing to clash").not.toBeNull();

    // The bot is mid-swing (strike not yet drained). Declare the clash on it.
    const clashed = h.sim.clashBot(ROOM, swungBotId!, 0.5, 0);
    expect(clashed, "clashBot returned false for a mid-swing bot").toBe(true);

    const snap = h.inspect().find((b) => (b.id as string) === swungBotId);
    expect(snap, "swinging bot vanished").toBeTruthy();
    expect(snap!.clashed, "clashBot did not set b.clashed").toBe(true);

    // Now resolve the (cancelled) strike: no "meleehit" must be fanned for this swing.
    const before = h.fanned.length;
    h.drainHits(FUTURE);
    const meleehitsAfter = h.fanned
      .slice(before)
      .filter((m) => m.event === "meleehit" && m.from === swungBotId);
    expect(
      meleehitsAfter.length,
      "a clashed swing still fanned a 'meleehit' (damage/stun leaked through the clash)",
    ).toBe(0);
  }, 30000);

  it("clashBot is a no-op for a bot that is not swinging", () => {
    const h = makeHarness({ players: [{ id: "P", x: 0, z: 0 }] });
    h.sim.tick(ROOM, dt); // spawn bots
    const anyBot = h.inspect().find((b) => b.alive);
    expect(anyBot, "no bot spawned").toBeTruthy();
    // Fresh-spawned bot is not mid-swing → clash is a no-op (best-effort, can't grief).
    expect(h.sim.clashBot(ROOM, anyBot!.id as string, 0, 0)).toBe(false);
  });
});
