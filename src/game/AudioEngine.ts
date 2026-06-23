import * as THREE from "three";
import { HEARING_RADIUS, SFX_MUTED_KEY } from "./consts";

/**
 * Spatial procedural Web-Audio SFX engine — no external audio assets.
 *
 * Supersedes AudioManager: every sound carries a world position and an
 * `isLocal` flag. Local sounds (the player, and single-player bots) always
 * play at full volume; remote sounds attenuate linearly with distance and
 * go fully silent beyond HEARING_RADIUS (the same ring voice uses), so the
 * spatial gate is identical across SFX and voice.
 *
 * One shared lazy AudioContext + master GainNode. resume() must be called on
 * a real user gesture (Game hooks the first mousedown/keydown) or remote
 * sounds — which can fire before the local player ever clicks — stay
 * suspended/silent.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** When true the master gain is pinned to 0 (Settings → mute SFX). */
  private muted = AudioEngine.readMuted();

  /** Listener (local player) world position on the XZ plane. */
  private listenerX = 0;
  private listenerZ = 0;

  /** Cached decaying-noise buffer for explosions (built once, reused per kill). */
  private explosionNoise: AudioBuffer | null = null;

  /** Read the persisted "mute SFX" flag (defaults to false / audible). */
  static readMuted(): boolean {
    try {
      return localStorage.getItem(SFX_MUTED_KEY) === "1";
    } catch {
      return false;
    }
  }

  private getCtx(): AudioContext {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  /**
   * Mute/unmute all procedural SFX live (and persist the choice). Does NOT touch
   * proximity voice — that's a separate channel gated by {@link VoiceChat}.
   */
  setMuted(muted: boolean) {
    this.muted = muted;
    try {
      localStorage.setItem(SFX_MUTED_KEY, muted ? "1" : "0");
    } catch {
      /* storage unavailable (private mode) — in-memory flag still applies */
    }
    if (this.master) this.master.gain.value = muted ? 0 : 1;
  }

  /** Resume the AudioContext on a user gesture so playback is unblocked. */
  resume() {
    const ctx = this.getCtx();
    if (ctx.state === "suspended") {
      void ctx.resume();
    }
  }

  /** Update the local listener position (call each frame before remotes). */
  setListener(x: number, z: number) {
    this.listenerX = x;
    this.listenerZ = z;
  }

  /**
   * Spatial gain for a world position. Local sounds are always full volume;
   * remote sounds fade linearly to 0 at HEARING_RADIUS. Returns 0 beyond the
   * ring so callers can skip allocating nodes entirely.
   */
  private gainFor(worldPos: THREE.Vector3, isLocal: boolean): number {
    if (isLocal) return 1;
    const dx = worldPos.x - this.listenerX;
    const dz = worldPos.z - this.listenerZ;
    const d = Math.hypot(dx, dz);
    if (d >= HEARING_RADIUS) return 0;
    return 1 - d / HEARING_RADIUS;
  }

  /** Pitched oscillator blip, scaled by the spatial gain. */
  private blip(
    spatialGain: number,
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
    osc.frequency.exponentialRampToValueAtTime(Math.max(toFreq, 1), now + dur);

    const peak = volume * spatialGain;
    gain.gain.setValueAtTime(peak, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    osc.connect(gain).connect(this.master!);
    osc.start(now);
    osc.stop(now + dur);
  }

  /** Short randomized triangle step, scaled by the spatial gain. */
  private step(spatialGain: number) {
    const ctx = this.getCtx();
    const now = ctx.currentTime;
    const dur = 0.05;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    const base = 180 + Math.random() * 80;
    osc.frequency.setValueAtTime(base, now);
    osc.frequency.exponentialRampToValueAtTime(base * 0.5, now + dur);
    gain.gain.setValueAtTime(0.025 * spatialGain, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(gain).connect(this.master!);
    osc.start(now);
    osc.stop(now + dur);
  }

  playShot(worldPos: THREE.Vector3, isLocal: boolean) {
    const g = this.gainFor(worldPos, isLocal);
    if (g <= 0) return;
    this.blip(g, 900, 180, 70, "square", 0.05);
    this.blip(g, 1600, 400, 40, "sawtooth", 0.025);
  }

  playJump(worldPos: THREE.Vector3, isLocal: boolean) {
    const g = this.gainFor(worldPos, isLocal);
    if (g <= 0) return;
    this.blip(g, 220, 520, 90, "square", 0.07);
  }

  playLand(worldPos: THREE.Vector3, isLocal: boolean) {
    const g = this.gainFor(worldPos, isLocal);
    if (g <= 0) return;
    this.blip(g, 320, 110, 80, "square", 0.06);
  }

  playFall(worldPos: THREE.Vector3, isLocal: boolean) {
    const g = this.gainFor(worldPos, isLocal);
    if (g <= 0) return;
    this.blip(g, 180, 60, 260, "square", 0.08);
  }

  playHit(worldPos: THREE.Vector3, isLocal: boolean) {
    const g = this.gainFor(worldPos, isLocal);
    if (g <= 0) return;
    this.blip(g, 420, 90, 110, "square", 0.07);
    this.blip(g, 140, 60, 90, "sawtooth", 0.05);
  }

  playDeath(worldPos: THREE.Vector3, isLocal: boolean) {
    const g = this.gainFor(worldPos, isLocal);
    if (g <= 0) return;
    this.blip(g, 220, 40, 500, "sawtooth", 0.09);
    this.blip(g, 110, 30, 700, "square", 0.06);
  }

  playFootstep(worldPos: THREE.Vector3, isLocal: boolean) {
    const g = this.gainFor(worldPos, isLocal);
    if (g <= 0) return;
    this.step(g);
  }

  /** Big satisfying boom for a super-shot kill: low sine sweep + noise crack. */
  playExplosion(worldPos: THREE.Vector3, isLocal: boolean) {
    const g = this.gainFor(worldPos, isLocal);
    if (g <= 0) return;
    const ctx = this.getCtx();
    const now = ctx.currentTime;

    // Low boom (pitch sweeps down).
    const osc = ctx.createOscillator();
    const og = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(190, now);
    osc.frequency.exponentialRampToValueAtTime(34, now + 0.45);
    og.gain.setValueAtTime(0.22 * g, now);
    og.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
    osc.connect(og).connect(this.master!);
    osc.start(now);
    osc.stop(now + 0.55);

    // Noise crack (debris). The decaying-noise buffer is identical every kill,
    // so build it once and reuse it (a buffer can back many sources safely).
    const dur = 0.3;
    if (!this.explosionNoise) {
      const buffer = ctx.createBuffer(
        1,
        Math.floor(ctx.sampleRate * dur),
        ctx.sampleRate,
      );
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      }
      this.explosionNoise = buffer;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = this.explosionNoise;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.14 * g, now);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    noise.connect(ng).connect(this.master!);
    noise.start(now);
    noise.stop(now + dur);
  }

  /** Rising arpeggio "level-up" cue — the charged special is ready to release. */
  playPowerUp(worldPos: THREE.Vector3, isLocal: boolean) {
    const g = this.gainFor(worldPos, isLocal);
    if (g <= 0) return;
    const ctx = this.getCtx();
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    notes.forEach((f, i) => {
      const t0 = now + i * 0.085;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(f, t0);
      gain.gain.setValueAtTime(0.07 * g, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
      osc.connect(gain).connect(this.master!);
      osc.start(t0);
      osc.stop(t0 + 0.22);
    });
  }

  dispose() {
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
      this.master = null;
      // Drop the cached buffer: it's bound to the closed context's sampleRate.
      this.explosionNoise = null;
    }
  }
}
