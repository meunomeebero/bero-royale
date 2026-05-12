/**
 * Tiny 8-bit-style sound engine using the Web Audio API.
 * No external audio assets required.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;

  private getCtx(): AudioContext {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  private blip(
    fromFreq: number,
    toFreq: number,
    durationMs: number,
    type: OscillatorType = "square",
    volume = 0.08,
  ) {
    const ctx = this.getCtx();
    const now = ctx.currentTime;
    const dur = durationMs / 1000;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(fromFreq, now);
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(toFreq, 1),
      now + dur,
    );

    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + dur);
  }

  jump() {
    this.blip(220, 520, 90, "square", 0.07);
  }

  land() {
    this.blip(320, 110, 80, "square", 0.06);
  }

  fall() {
    this.blip(180, 60, 260, "square", 0.08);
  }

  shoot() {
    // Sharp 8-bit pew
    this.blip(900, 180, 70, "square", 0.05);
    // Mix in a tiny noise-ish sawtooth for crunch
    this.blip(1600, 400, 40, "sawtooth", 0.025);
  }

  dispose() {
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
