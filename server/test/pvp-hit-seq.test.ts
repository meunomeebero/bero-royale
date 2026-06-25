import { describe, test, expect } from "vitest";
import { RoomHub } from "../src/ws/rooms";
import type { Sock } from "../src/ws/protocol";
import { SUPER_DAMAGE } from "../src/ws/combat-consts";

/**
 * Phase 5 — PvP death gating. A player's hit/super on another PLAYER is applied
 * IMMEDIATELY (the shooter's "hit" already fired after its local bullet visibly
 * collided, so travel is counted — re-adding dist/BULLET_SPEED would double-count).
 * The one change is that the "died" now carries a monotonic `seq`, which routes the
 * victim's client through its impact gate (whose bare-cue net synthesizes a visible
 * impact before the death) instead of the instant `serverKilled()` a seq-less death
 * triggers. See docs/systems/netcode-hit-sync-plan.md (Phase 5).
 */

/** A minimal fake Sock that captures everything fanned/unicast to it. */
function fakeSock(id: string): { sock: Sock; sent: unknown[] } {
  const sent: unknown[] = [];
  const sock = {
    id,
    room: "r",
    meta: {},
    readyState: 1, // WebSocket.OPEN
    bufferedAmount: 0,
    send: (d: string) => sent.push(JSON.parse(d)),
    terminate: () => {},
  } as unknown as Sock;
  return { sock, sent };
}

function makeHub(...ids: string[]) {
  const hub = new RoomHub();
  const socks: Record<string, { sock: Sock; sent: unknown[] }> = {};
  for (const id of ids) {
    socks[id] = fakeSock(id);
    hub.join("r", socks[id].sock);
  }
  return { hub, socks };
}

function diedFor(sent: unknown[], id: string) {
  return sent
    .map((m) => m as { event?: string; payload?: { id?: string; seq?: number; by?: string } })
    .filter((m) => m.event === "died" && m.payload?.id === id);
}

describe("RoomHub PvP resolution (Phase 5 — seq on the death, applied immediately)", () => {
  test("a non-lethal PvP hit applies exactly 1 damage immediately (no scheduling)", () => {
    const { hub } = makeHub("shooter", "victim");
    const h0 = hub.getPlayer("r", "victim")!.health;
    hub.resolvePlayerHit("r", "victim", "shooter", "shot");
    expect(hub.getPlayer("r", "victim")!.health).toBe(h0 - 1);
  });

  test("a lethal PvP hit fans out 'died' carrying a seq (routes the victim through its gate)", () => {
    const { hub, socks } = makeHub("shooter", "victim");
    hub.damagePlayerN("r", "victim", "shooter", 9); // bring the victim to 1 HP
    hub.resolvePlayerHit("r", "victim", "shooter", "shot");
    const died = diedFor(socks.victim.sent, "victim");
    expect(died).toHaveLength(1);
    expect(typeof died[0].payload!.seq).toBe("number"); // Phase 5: seq present (was absent)
    expect(died[0].payload!.by).toBe("shooter");
    expect(hub.getPlayer("r", "victim")!.alive).toBe(false);
  });

  test("a player super applies SUPER_DAMAGE and its death carries a seq", () => {
    const { hub, socks } = makeHub("shooter", "victim");
    hub.damagePlayerN("r", "victim", "shooter", 10 - SUPER_DAMAGE); // leave exactly SUPER_DAMAGE HP
    hub.resolvePlayerHit("r", "victim", "shooter", "super");
    expect(hub.getPlayer("r", "victim")!.alive).toBe(false);
    const died = diedFor(socks.victim.sent, "victim");
    expect(died).toHaveLength(1);
    expect(typeof died[0].payload!.seq).toBe("number");
  });

  test("seq is monotonic and unique per death", () => {
    const { hub, socks } = makeHub("shooter", "v1", "v2");
    hub.damagePlayerN("r", "v1", "shooter", 9);
    hub.damagePlayerN("r", "v2", "shooter", 9);
    hub.resolvePlayerHit("r", "v1", "shooter", "shot");
    hub.resolvePlayerHit("r", "v2", "shooter", "shot");
    const seq1 = diedFor(socks.v1.sent, "v1")[0].payload!.seq!;
    const seq2 = diedFor(socks.v2.sent, "v2")[0].payload!.seq!;
    expect(seq1).not.toBe(seq2);
    expect(seq2).toBe(seq1 + 1);
  });

  test("a hit on an already-dead victim no-ops (no second death)", () => {
    const { hub, socks } = makeHub("shooter", "victim");
    hub.damagePlayerN("r", "victim", "shooter", 12); // kill outright
    expect(hub.getPlayer("r", "victim")!.alive).toBe(false);
    socks.victim.sent.length = 0;
    hub.resolvePlayerHit("r", "victim", "shooter", "shot"); // applyHit null-guards a corpse
    expect(diedFor(socks.victim.sent, "victim")).toHaveLength(0);
  });
});
