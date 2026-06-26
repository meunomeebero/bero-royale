import { describe, test, expect } from "vitest";
import fc from "fast-check";
import {
  LethalImpactGate,
  LETHAL_GATE_MARGIN_MS,
  LETHAL_GATE_MAX_MS,
  LETHAL_TRACER_SPEED,
  type GateEffects,
  type Point2,
} from "./LethalImpactGate";

/**
 * Deterministic harness around the gate: a fake clock + a recorder of every effect
 * stamped with the clock instant it fired. `killSelf` mirrors Player.serverKilled()
 * idempotency (no-op once dead). Frames are driven one at a time; the clock only
 * moves on `advance()`, so a test proves the ">=1 frame impact-before-death"
 * guarantee by advancing between frames (as real rAF does).
 */
type Effect = { fx: "kill" | "impact" | "credit"; t: number; name?: string };

function harness(opts?: { self?: Point2; names?: Record<string, string | null> }) {
  let t = 1000;
  let alive = true;
  const self: Point2 = opts?.self ?? { x: 0, z: 0 };
  const names = opts?.names ?? {};
  const log: Effect[] = [];

  const fx: GateEffects = {
    now: () => t,
    isAlive: () => alive,
    selfPos: () => self,
    killSelf: () => {
      if (!alive) return; // mirror serverKilled() idempotency
      alive = false;
      log.push({ fx: "kill", t });
    },
    playImpact: () => {
      log.push({ fx: "impact", t });
    },
    nameForOwner: (id) => names[id] ?? null,
    creditKiller: (name, tt) => {
      log.push({ fx: "credit", t: tt, name });
    },
  };

  const gate = new LethalImpactGate(fx);
  return {
    gate,
    log,
    advance: (ms = 1) => {
      t += ms;
    },
    now: () => t,
    setAlive: (b: boolean) => {
      alive = b;
    },
    setSelf: (p: Point2) => {
      self.x = p.x;
      self.z = p.z;
    },
    kills: () => log.filter((e) => e.fx === "kill"),
    impacts: () => log.filter((e) => e.fx === "impact"),
    credits: () => log.filter((e) => e.fx === "credit"),
    /** Run one render frame's drain at the current clock instant. */
    frame: () => gate.tick(),
  };
}

const FAR = { x: 1000, z: 0 }; // dist 1000 → eta capped at LETHAL_GATE_MAX_MS

describe("LethalImpactGate — real-tracer release (no synth)", () => {
  test("died-then-arrive: held until the tracer lands, then dies once", () => {
    const h = harness({ names: { A: "Bot A" } });
    h.gate.arm("A", 1, FAR);
    expect(h.gate.hasPending()).toBe(true);
    h.gate.onDied("A", 1); // diedSeen, not arrived → no death yet
    h.advance(16);
    h.frame(); // deadline far off → still waiting
    expect(h.kills()).toHaveLength(0);
    h.gate.onArrive("A", 1); // tracer reached me → release in sync with the bullet
    expect(h.kills()).toHaveLength(1);
    expect(h.impacts()).toHaveLength(0); // real tracer, the gate synthesizes nothing
    expect(h.credits()[0].name).toBe("Bot A");
    expect(h.gate.hasPending()).toBe(false);
  });

  test("arrive-then-died: arrival alone never kills; death lands when confirmed", () => {
    const h = harness();
    h.gate.arm("A", 1, FAR);
    h.gate.onArrive("A", 1); // arrived but not yet confirmed lethal → hold
    expect(h.kills()).toHaveLength(0);
    h.gate.onDied("A", 1); // now confirmed → release
    expect(h.kills()).toHaveLength(1);
    expect(h.impacts()).toHaveLength(0);
  });

  test("non-lethal targeted shot: arrival without a death expires harmlessly", () => {
    const h = harness();
    h.gate.arm("A", 1, { x: 4.4, z: 0 }); // eta 400ms
    h.gate.onArrive("A", 1); // arrived, but no "died" will ever come
    h.advance(LETHAL_GATE_MAX_MS + 50);
    h.frame(); // deadline passed, diedSeen=false → drop the gate
    expect(h.kills()).toHaveLength(0);
    expect(h.impacts()).toHaveLength(0);
    expect(h.gate.hasPending()).toBe(false);
  });
});

describe("LethalImpactGate — synthesized impact precedes death (codex P1s)", () => {
  test("lost/blocked tracer: deadline synthesizes an impact, death lands a LATER frame", () => {
    const h = harness();
    h.gate.arm("A", 1, { x: 4.4, z: 0 }); // eta = 4.4/22*1000 + 200 = 400ms
    h.gate.onDied("A", 1); // confirmed lethal; tracer will never arrive
    h.advance(450); // past the deadline
    h.frame(); // synth impact — but MUST NOT kill on this frame
    expect(h.impacts()).toHaveLength(1);
    expect(h.kills()).toHaveLength(0);
    h.advance(16);
    h.frame(); // now release the death
    expect(h.kills()).toHaveLength(1);
    expect(h.impacts()[0].t).toBeLessThan(h.kills()[0].t); // impact strictly before death
  });

  test("late died after the gate expired: still impact-first, never instant (P1 #1)", () => {
    const h = harness();
    h.gate.arm("A", 1, { x: 4.4, z: 0 });
    h.advance(450);
    h.frame(); // deadline, diedSeen=false → gate deleted as non-lethal
    expect(h.gate.hasPending()).toBe(false);
    expect(h.kills()).toHaveLength(0);
    h.gate.onDied("A", 1); // the death arrives LATE, no live gate → bare safety net
    h.frame(); // synth impact
    expect(h.impacts()).toHaveLength(1);
    expect(h.kills()).toHaveLength(0);
    h.advance(16);
    h.frame();
    expect(h.kills()).toHaveLength(1);
    expect(h.impacts()[0].t).toBeLessThan(h.kills()[0].t);
  });

  test("bare death (bot super has no 'shot'): impact then death, never instant", () => {
    const h = harness();
    h.gate.requestBareDeath(); // e.g. an hp=0 or seq'd died with no live gate
    h.frame();
    expect(h.impacts()).toHaveLength(1);
    expect(h.kills()).toHaveLength(0);
    h.advance(16);
    h.frame();
    expect(h.kills()).toHaveLength(1);
    expect(h.impacts()[0].t).toBeLessThan(h.kills()[0].t);
  });

  test("the death is held until the clock advances a strict tick (P1 #2)", () => {
    // The exact bug Codex caught: synth + release must not collapse into one frame.
    const h = harness();
    h.gate.requestBareDeath();
    h.frame(); // impact at t (synthed)
    expect(h.impacts()).toHaveLength(1);
    h.frame(); // SAME clock instant — now is NOT > synthAt → must NOT release
    expect(h.kills()).toHaveLength(0);
    h.advance(1); // a real frame would have advanced the clock
    h.frame();
    expect(h.kills()).toHaveLength(1);
  });
});

describe("LethalImpactGate — multiplicity, idempotency, liveness", () => {
  test("multiple simultaneous shooters resolve to exactly one death", () => {
    const h = harness();
    h.gate.arm("A", 1, FAR);
    h.gate.arm("B", 2, FAR);
    h.gate.onDied("A", 1);
    h.gate.onArrive("A", 1); // A wins → release → dead
    // B's cues now arrive on a corpse:
    h.gate.onArrive("B", 2);
    h.gate.onDied("B", 2);
    h.advance(16);
    h.frame();
    expect(h.kills()).toHaveLength(1);
  });

  test("a duplicated 'died' does not kill twice", () => {
    const h = harness();
    h.gate.arm("A", 1, FAR);
    h.gate.onArrive("A", 1);
    h.gate.onDied("A", 1); // release
    h.gate.onDied("A", 1); // duplicate delivery → no-op (already dead)
    expect(h.kills()).toHaveLength(1);
  });

  test("a death by another cause (lava) drops all held gates", () => {
    const h = harness();
    h.gate.arm("A", 1, FAR);
    h.setAlive(false); // player died to a hazard outside the gate
    h.frame();
    expect(h.gate.hasPending()).toBe(false);
    expect(h.kills()).toHaveLength(0); // killSelf is a no-op on a corpse
  });

  test("a confirmed lethal death ALWAYS lands within deadline + one frame", () => {
    const h = harness();
    h.gate.arm("A", 1, FAR); // eta capped at LETHAL_GATE_MAX_MS (tracer never comes)
    h.gate.onDied("A", 1);
    // Drive frames across the whole deadline window; death must occur, bounded.
    for (let i = 0; i < 60 && h.kills().length === 0; i++) {
      h.advance(16);
      h.frame();
    }
    expect(h.kills()).toHaveLength(1);
    expect(h.now()).toBeLessThanOrEqual(1000 + LETHAL_GATE_MAX_MS + 16 * 3);
  });
});

describe("LethalImpactGate — deadline (eta) math", () => {
  test("eta = dist/SPEED*1000 + margin for a mid-range shot", () => {
    const dist = 4.4;
    const expectedEta = (dist / LETHAL_TRACER_SPEED) * 1000 + LETHAL_GATE_MARGIN_MS; // 400
    const h = harness();
    h.gate.arm("A", 1, { x: dist, z: 0 });
    h.gate.onDied("A", 1);
    h.advance(expectedEta - 50); // just before the deadline
    h.frame();
    expect(h.impacts()).toHaveLength(0); // not yet
    h.advance(100); // now past it
    h.frame();
    expect(h.impacts()).toHaveLength(1);
  });

  test("eta is capped at LETHAL_GATE_MAX_MS for a far shot", () => {
    const h = harness();
    h.gate.arm("A", 1, FAR); // raw eta would be ~45s; capped to 700ms
    h.gate.onDied("A", 1);
    h.advance(LETHAL_GATE_MAX_MS - 50);
    h.frame();
    expect(h.impacts()).toHaveLength(0);
    h.advance(100);
    h.frame();
    expect(h.impacts()).toHaveLength(1);
  });
});

describe("LethalImpactGate — killer attribution", () => {
  test("the 'hit' cue back-fills the real bot name (server bots are unresolvable)", () => {
    const h = harness({ names: { A: null } }); // nameForOwner can't resolve the bot
    h.gate.arm("A", 1, FAR); // byName defaults to "Alguém"
    h.gate.setShooterName("A", 1, "Bot Fulano"); // the hit cue carries the real name
    h.gate.onDied("A", 1);
    h.gate.onArrive("A", 1);
    expect(h.credits()[0].name).toBe("Bot Fulano");
  });

  test("falls back to nameForOwner when no back-fill arrives", () => {
    const h = harness({ names: { A: "Resolved Bot" } });
    h.gate.arm("A", 1, FAR);
    h.gate.onArrive("A", 1);
    h.gate.onDied("A", 1);
    expect(h.credits()[0].name).toBe("Resolved Bot");
  });
});

describe("LethalImpactGate — property: never die from an unseen shot", () => {
  // Faithful frame model: each step is one render frame — the clock advances, any
  // WS "died" for the frame is delivered, then the tracer arrival (which in prod
  // fires inside bullets.update) lands, then the gate's drain (tick) runs. Keeping
  // the frame boundary and a single death cycle (keyed XOR bare) is what the real
  // engine does; it makes "a synthesized impact strictly precedes the death" exact.
  test("under any frame schedule: ≤1 death, and any synthesized impact strictly precedes it", () => {
    const frameArb = fc.record({
      dt: fc.integer({ min: 1, max: 60 }), // ms advanced this frame
      died: fc.boolean(), // a WS "died" was delivered this frame (before the drain)
      arrive: fc.boolean(), // the tracer landed this frame (bullets.update, pre-drain)
      bare: fc.boolean(), // a bare cue (bot super / no-gate death) this frame
    });
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 15 }), // shooter distance (drives the eta/deadline)
        fc.boolean(), // keyed: a lethal "shot" pre-armed a gate (vs a bare-only run)
        fc.array(frameArb, { maxLength: 50 }),
        (distX, keyed, frames) => {
          const h = harness();
          if (keyed) h.gate.arm("A", 1, { x: distX, z: 0 });
          for (const f of frames) {
            h.advance(f.dt); // a new render frame: the clock moved
            if (f.died) {
              // A seq'd "died" routes through the gate; a bare cue requests the net.
              if (keyed) h.gate.onDied("A", 1);
              else h.gate.requestBareDeath();
            }
            if (f.bare && !keyed) h.gate.requestBareDeath();
            if (f.arrive && keyed) h.gate.onArrive("A", 1); // tracer landed pre-drain
            h.frame(); // the per-frame drain runs last
          }
          const kills = h.kills();
          const impacts = h.impacts();
          // (1) The player dies at most once.
          expect(kills.length).toBeLessThanOrEqual(1);
          // (2) Every synthesized impact strictly precedes the death — never on the
          //     same frame (codex P1 #2), never a death without a visible cause.
          for (const k of kills) {
            for (const i of impacts) expect(i.t).toBeLessThan(k.t);
          }
        },
      ),
      { numRuns: 2000 },
    );
  });
});
