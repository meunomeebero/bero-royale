import * as THREE from "three";
import { ModelLibrary } from "./ModelLibrary";
import type { BulletTarget } from "./Bullets";
import type { AudioEngine } from "./AudioEngine";

/**
 * Destructible supply crates (server-driven). A voxel box that takes shots and,
 * after 10 hits (counted server-side), bursts into white voxel smoke and
 * scatters power-ups. Each crate is a {@link BulletTarget} so the local player's
 * bullets land on it; every hit just RELAYS to the server (sendHit), which owns
 * the crate's HP and decides when it explodes — mirroring the RemotePlayer model.
 */

const CRATE_HEIGHT = 0.9;
const HALF = CRATE_HEIGHT / 2;
const BOX_MODELS = ["box1", "box2"];
const FLASH = 0.12; // hit-flash duration (seconds)

// ── Drop + rubber bounce ──────────────────────────────────────────────────
const DROP_HEIGHT = 8; // how high above its spot the crate starts
const GRAVITY = 22; // fall acceleration
const RESTITUTION = 0.5; // bounciness (fraction of speed kept per bounce)
const MIN_BOUNCE_VY = 2.2; // below this impact speed it settles
const MAX_BOUNCES = 4; // hard cap on bounces
const SQUASH_DUR = 0.16; // how long the squat-on-impact lasts

class Crate implements BulletTarget {
  readonly id: string;
  readonly side = "bot" as const;
  /** Local AI/bots can't break crates — only the player's real bullets do. */
  readonly remote = true;
  readonly bodyHalfHeight = HALF;
  readonly root: THREE.Group;
  readonly position: THREE.Vector3;

  private onHit: (id: string) => void;
  private audio: AudioEngine;
  private model: THREE.Object3D;
  private mats: THREE.MeshLambertMaterial[];
  private flash = 0;

  // Falling / bouncing state.
  private restY: number; // resting center height
  private vy = 0;
  private bounces = 0;
  private squashT = 0; // squat-on-impact timer
  private landed = false;

  constructor(
    id: string,
    x: number,
    groundY: number,
    z: number,
    audio: AudioEngine,
    onHit: (id: string) => void,
  ) {
    this.id = id;
    this.audio = audio;
    this.onHit = onHit;
    this.restY = groundY + HALF; // center sits here once settled
    this.root = new THREE.Group();
    // Start high up and fall — a juicy rubber drop.
    this.root.position.set(x, this.restY + DROP_HEIGHT, z);
    this.position = this.root.position;

    const name = BOX_MODELS[Math.floor(Math.random() * BOX_MODELS.length)];
    const inst = ModelLibrary.create("env", name, CRATE_HEIGHT);
    this.model = inst.object;
    this.model.position.y = -HALF; // feet on the ground
    this.mats = inst.materials;
    this.root.add(this.model);
  }

  /** Always a valid target until the server says it exploded (then Game removes it). */
  isAlive(): boolean {
    return true;
  }

  /** A bullet landed: flash + squash for feedback, then relay to the server. */
  takeHit(): boolean {
    this.flash = FLASH;
    this.onHit(this.id);
    return true;
  }

  update(dt: number): void {
    // ── Fall + rubber bounce until settled ──
    if (!this.landed) {
      this.vy -= GRAVITY * dt;
      this.root.position.y += this.vy * dt;
      if (this.root.position.y <= this.restY) {
        this.root.position.y = this.restY;
        this.squashT = SQUASH_DUR;
        this.audio.playLand(this.root.position, false); // thud (spatial)
        if (Math.abs(this.vy) > MIN_BOUNCE_VY && this.bounces < MAX_BOUNCES) {
          this.vy = -this.vy * RESTITUTION; // bounce back up
          this.bounces++;
        } else {
          this.vy = 0;
          this.landed = true;
        }
      }
    }

    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt);

    // ── Scale: hit-flash > impact squash > airborne stretch > rest ──
    let sx = 1;
    let sy = 1;
    if (this.flash > 0) {
      const f = this.flash / FLASH;
      for (const m of this.mats) m.emissive.setRGB(f, f, f); // white pop on hit
      sx = 1 + 0.18 * f;
      sy = 1 - 0.22 * f;
    } else {
      for (const m of this.mats) m.emissive.setRGB(0, 0, 0);
      if (this.squashT > 0) {
        this.squashT = Math.max(0, this.squashT - dt);
        const k = this.squashT / SQUASH_DUR;
        sx = 1 + 0.34 * k; // wide + flat squat
        sy = 1 - 0.42 * k;
      } else if (!this.landed) {
        const sp = Math.min(1, Math.abs(this.vy) / 10);
        sx = 1 - 0.18 * sp; // thin + tall while flying fast
        sy = 1 + 0.36 * sp;
      }
    }
    this.root.scale.set(sx, sy, sx);
  }

  dispose(): void {
    this.model.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry?.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
      else mat?.dispose();
    });
  }
}

/** Manager: holds the live crates + their group, hands BulletTargets to Game. */
export class Crates {
  readonly group: THREE.Group;
  private crates = new Map<string, Crate>();

  constructor() {
    this.group = new THREE.Group();
  }

  has(id: string): boolean {
    return this.crates.has(id);
  }

  /** Spawn a crate; returns the BulletTarget so Game can register it with bullets. */
  spawn(
    id: string,
    x: number,
    groundY: number,
    z: number,
    audio: AudioEngine,
    onHit: (id: string) => void,
  ): BulletTarget | null {
    if (this.crates.has(id)) return null;
    const c = new Crate(id, x, groundY, z, audio, onHit);
    this.crates.set(id, c);
    this.group.add(c.root);
    return c;
  }

  /** Remove a crate; returns it (a BulletTarget) so Game can unregister it. */
  remove(id: string): BulletTarget | null {
    const c = this.crates.get(id);
    if (!c) return null;
    this.group.remove(c.root);
    c.dispose();
    this.crates.delete(id);
    return c;
  }

  update(dt: number): void {
    for (const c of this.crates.values()) c.update(dt);
  }

  dispose(): void {
    for (const c of this.crates.values()) {
      this.group.remove(c.root);
      c.dispose();
    }
    this.crates.clear();
  }
}
