/**
 * Client impact gate (Phase 3) — extracted as a pure, framework-free state machine
 * so it is unit-testable in isolation (no Three.js, no DOM, no wall-clock, no
 * transport). Game.ts owns one instance in multiplayer mode and feeds it the wire
 * events; every side-effect (kill, impact FX, death-feed credit, name lookup) and
 * the time source are injected via {@link GateEffects} so a test can drive frames
 * one at a time against a fake clock and a mock recorder.
 *
 * Invariant (the whole reason this exists): the local player NEVER dies from a bot
 * shot it did not see arrive. A held death is released the instant the correlated
 * tracer visibly lands (`onArrive`) once the authoritative `"died"` is also seen;
 * if the tracer never lands, a deadline synthesizes a visible impact on one frame
 * and applies the death on a STRICTLY LATER frame — never timeout/bare-cue →
 * instant death. See docs/systems/netcode-hit-sync-plan.md (Phase 3) and
 * docs/systems/netcode-testing.md.
 */

/** Plain 2D point — the gate only ever reads x/z, so it never needs a THREE type
 *  (a `THREE.Vector3` satisfies this structurally and can be passed directly). */
export interface Point2 {
  x: number;
  z: number;
}

/**
 * The side-effects + queries the gate needs, injected at construction. Production
 * wires these to Player / SmokePuffs / the death-feed; tests pass mocks. Keeping
 * them behind an interface is what makes the gate pure and deterministic.
 */
export interface GateEffects {
  /** Monotonic wall-clock in ms — the gate's ONLY time source. */
  now(): number;
  /** Is the local player currently alive? (a dead player drops every gate) */
  isAlive(): boolean;
  /** Local player XZ position, for the eta + synth-impact placement math. */
  selfPos(): Point2;
  /** Apply the authoritative kill. MUST be idempotent (no-op if already dead),
   *  mirroring `Player.serverKilled()`. */
  killSelf(): void;
  /** Show a visible + audible impact at the player (flash/shake/SFX + smoke puff).
   *  Used only on the synthesized-impact fallback paths. */
  playImpact(): void;
  /** Resolve a shooter id to a display name, or null if unknown (server bots are
   *  not locally resolvable — the `"hit"` cue back-fills the name via
   *  {@link LethalImpactGate.setShooterName}). */
  nameForOwner(id: string): string | null;
  /** Credit the death-feed ("X matou você") with the killer name + timestamp. */
  creditKiller(name: string, t: number): void;
}

/** Tracer travel speed used to estimate a lethal bullet's arrival deadline.
 *  **MUST stay in sync with `BULLET_SPEED` in Bullets.ts / server bots.ts.** */
export const LETHAL_TRACER_SPEED = 22;
/** Margin (ms) added to a lethal tracer's expected travel before the gate stops
 *  waiting for the visible bullet and synthesizes the impact (covers client-side
 *  jitter or a dropped/terrain-blocked tracer, and the receive-time vs fire-time
 *  distance skew where the player walked toward the shooter). */
export const LETHAL_GATE_MARGIN_MS = 200;
/** Hard ceiling (ms) on how long a death may be held regardless of computed eta —
 *  bounds the "alive a little longer" window so a far/odd shot can't stall death. */
export const LETHAL_GATE_MAX_MS = 700;

/** A single held-back lethal death, keyed `${shooterId}:${seq}`. */
interface Gate {
  by: string;
  byName: string;
  /** ms epoch — expected tracer arrival + margin; fallback if it never lands. */
  deadlineAt: number;
  /** The tracer visibly reached the local player. */
  arrived: boolean;
  /** The authoritative "died" for this shot arrived (confirms it IS lethal). */
  diedSeen: boolean;
  /** ms epoch the fallback impact was synthesized (0 = not yet). Death releases
   *  the frame after this so the impact is always on-screen first. */
  synthAt: number;
}

export class LethalImpactGate {
  /** Held lethal deaths, independent per simultaneous shooter. */
  private gates = new Map<string, Gate>();
  /** Bare-cue safety net (no keyed gate — bot super, PvP, or an expired gate):
   *  `requested` by a WS callback, `synthed` inside a frame, then released. */
  private bareState: "none" | "requested" | "synthed" = "none";
  private bareSynthAt = 0;

  constructor(private readonly fx: GateEffects) {}

  private key(by: string, seq: number): string {
    return by + ":" + seq;
  }

  /** True while any keyed death is being held — drives the `"hp"` echo deferral. */
  hasPending(): boolean {
    return this.gates.size > 0;
  }

  /** Pre-arm a gate from a lethal `"shot"` (server says it WILL hit me). Deadline =
   *  expected tracer travel + margin, capped. Preserves a diedSeen/arrived already
   *  set by an early/coalesced cue. */
  arm(by: string, seq: number, origin: Point2): void {
    const me = this.fx.selfPos();
    const dist = Math.hypot(me.x - origin.x, me.z - origin.z);
    const etaMs = Math.min(
      LETHAL_GATE_MAX_MS,
      (dist / LETHAL_TRACER_SPEED) * 1000 + LETHAL_GATE_MARGIN_MS,
    );
    const k = this.key(by, seq);
    const prev = this.gates.get(k);
    this.gates.set(k, {
      by,
      byName: this.fx.nameForOwner(by) ?? "Alguém",
      deadlineAt: this.fx.now() + etaMs,
      arrived: prev?.arrived ?? false,
      diedSeen: prev?.diedSeen ?? false,
      synthAt: 0,
    });
    // A "died"/arrival that somehow beat the "shot" is already satisfied.
    if (prev?.diedSeen && prev?.arrived) this.release(k);
  }

  /** Back-fill the REAL shooter name from the `"hit"` cue: `nameForOwner` can't
   *  resolve a server bot, so without this a gated death credits "Alguém". */
  setShooterName(by: string, seq: number, name: string): void {
    const g = this.gates.get(this.key(by, seq));
    if (g) g.byName = name;
  }

  /** The tagged lethal tracer visibly reached the player. Release iff the
   *  authoritative death is already confirmed; otherwise wait (could be non-lethal). */
  onArrive(by: string, seq: number): void {
    const k = this.key(by, seq);
    const g = this.gates.get(k);
    if (!g) return; // non-lethal targeted shot, or already released
    g.arrived = true;
    if (g.diedSeen) this.release(k);
  }

  /** An authoritative self-death carrying a shot `seq`, ALWAYS routed through the
   *  gate so a visible impact precedes death. Live gate → mark lethal, release on
   *  arrival/deadline. No live gate (bot super has no `"shot"`, or the gate already
   *  timed out before a LATE `"died"`) → the bare-cue safety net (impact next
   *  frame, then death). */
  onDied(by: string, seq: number): void {
    if (!this.fx.isAlive()) return;
    const k = this.key(by, seq);
    const g = this.gates.get(k);
    if (g) {
      g.diedSeen = true;
      if (g.arrived) this.release(k);
      return; // else released on tracer arrival or the deadline (synth → death)
    }
    this.requestBareDeath();
  }

  /** Request the bare-cue safety net from a WS hp/died callback. The impact is NOT
   *  synthesized here (that would paint and die on the same frame) — it is
   *  synthesized later inside {@link tick} so it paints first. Idempotent. */
  requestBareDeath(): void {
    if (this.bareState === "none" && this.fx.isAlive()) {
      this.bareState = "requested";
    }
  }

  /** Drop every held death (on a finalized death or respawn). */
  clear(): void {
    if (this.gates.size > 0) this.gates.clear();
  }

  /** Apply a held death now (in sync with the visible impact). */
  private release(key: string): void {
    const g = this.gates.get(key);
    if (!g) return;
    this.gates.delete(key);
    this.fx.creditKiller(g.byName, this.fx.now());
    this.fx.killSelf(); // idempotent (no-op if already dead)
    // Any other in-flight gates for this life are moot now — we're dead.
    this.clear();
    this.bareState = "none";
  }

  /**
   * Per-frame drain. MUST be called every frame AFTER the bullet update that fires
   * `onArrive`, and BEFORE the render, so a synthesized impact paints before its
   * death. `now()` is read ONCE here so the whole frame shares one clock instant —
   * which is what guarantees the synth-then-die step lands on a STRICTLY LATER
   * frame (the next frame's `now` is greater).
   */
  tick(): void {
    const now = this.fx.now();

    // Bare-cue safety net: synthesize the impact DURING this frame (so it paints),
    // then release the death on a LATER frame — never in the same frame the impact
    // first renders.
    if (this.bareState !== "none") {
      if (!this.fx.isAlive()) {
        this.bareState = "none";
      } else if (this.bareState === "requested") {
        this.fx.playImpact();
        this.bareSynthAt = now;
        this.bareState = "synthed";
      } else if (now > this.bareSynthAt) {
        this.bareState = "none";
        this.fx.killSelf();
        this.clear();
      }
    }

    if (this.gates.size === 0) return;
    // Player already dead by any cause (gate release, lava, …) → drop everything.
    if (!this.fx.isAlive()) {
      this.clear();
      return;
    }
    // Snapshot keys: release() mutates the map mid-iteration.
    for (const key of [...this.gates.keys()]) {
      const g = this.gates.get(key);
      if (!g) continue;
      if (g.synthAt > 0) {
        // Impact already shown a prior frame → release the death now (≥1 frame later).
        if (now > g.synthAt) this.release(key);
        continue;
      }
      if (now < g.deadlineAt) continue;
      if (g.diedSeen) {
        // Confirmed lethal but the tracer never visibly landed → show an impact,
        // release death next frame.
        this.fx.playImpact();
        g.synthAt = now;
      } else {
        // Non-lethal targeted shot (no "died" will come) → forget it.
        this.gates.delete(key);
      }
    }
  }
}
