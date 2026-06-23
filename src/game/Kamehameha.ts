import * as THREE from "three";
import type { BulletTarget, BulletOwner } from "./Bullets";
import type { SmokePuffs } from "./SmokePuffs";
import { HEARING_RADIUS } from "./consts";

/**
 * The charged "Kamehameha" energy attack — available to every player.
 *
 * - Charge: a stream of small, bright blue voxel cubes flies INWARD and is
 *   absorbed into the caster (multi-instance, keyed by id, so the whole lobby
 *   sees who's winding up — and runs). No glowing ball, no charge box: just the
 *   cubes pouring into the player. The white flash + level-up sound (in Player)
 *   tell the caster it's ready to release.
 * - Fire: a big blue cube bursts at the muzzle, then a stream of smaller blue
 *   cubes is fired along the aim direction (the beam).
 * - Impact / end: the beam dissolves into a burst of blue voxel cubes + smoke.
 *
 * Collision is reported via {@link onHit}; remote casts use a non-damaging
 * visual beam so only the caster's client resolves the hit.
 */

const CUBE = new THREE.BoxGeometry(1, 1, 1);
// White "air-blast" palette (the look the client liked). Names kept for the
// existing references; values are whites now, not blues.
const BLUE = "#ffffff";
const BLUE_BRIGHT = "#ffffff";
const BLUE_DEEP = "#dce8f2";
const BLUE_GLOW = "#f2f8ff";

const BEAM_SPEED = 26;
// Same reach as a normal bullet (2 × hearing radius) so the screen doesn't fill
// with full-length beams in a crowded online match.
const BEAM_MAX_RANGE = 2 * HEARING_RADIUS;
const BEAM_HIT_RADIUS = 1.0;

// Charge stream: particles/sec ramps from MIN→MAX over the wind-up.
const STREAM_RATE_MIN = 12;
const STREAM_RATE_MAX = 34;

interface StreamP {
  mesh: THREE.Mesh;
  offset: THREE.Vector3; // spawn position relative to the (moving) caster anchor
  progress: number; // 0 = spawned at the rim, 1 = absorbed into the player
  speed: number;
  spin: THREE.Vector3;
  baseScale: number;
}

interface ChargeInstance {
  particles: StreamP[];
  spawnAccum: number;
}

interface TrailCube {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  spin: THREE.Vector3;
  vel: THREE.Vector3;
}

interface Beam {
  head: THREE.Mesh;
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  traveled: number;
  damaging: boolean;
  lethal: boolean; // true = insta-kill (concentrated); false = half damage (boss)
  ownerSide: BulletOwner;
  /** Stable id of the caster (player/bot id) for kill attribution. */
  ownerId: string;
  trailAccum: number;
}

/**
 * Solid bright voxel cube material. NOT additive: additive blending washed out
 * to invisible over the bright candy scene (the beam vanished in flight and the
 * charge cubes only showed against the dark player body). Solid cubes read
 * everywhere.
 */
function glowMat(color: string, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    transparent: opacity < 1,
    opacity,
  });
}

export class Kamehameha {
  readonly group: THREE.Group;
  onHit?: (
    target: BulletTarget,
    dir: THREE.Vector3,
    lethal: boolean,
    ownerId: string,
  ) => void;
  onBeamEnd?: (x: number, y: number, z: number) => void;

  private targets: BulletTarget[] = [];
  private smoke: SmokePuffs | null = null;

  /** Per-caster charge streams, keyed by player id (local + remotes). */
  private charges = new Map<string, ChargeInstance>();
  private beams: Beam[] = [];
  private trail: TrailCube[] = [];

  constructor() {
    this.group = new THREE.Group();
  }

  setSmoke(s: SmokePuffs) {
    this.smoke = s;
  }
  registerTarget(t: BulletTarget) {
    this.targets.push(t);
  }
  unregisterTarget(t: BulletTarget) {
    this.targets = this.targets.filter((x) => x !== t);
  }

  /**
   * Feed caster `id`'s charge stream: small bright blue cubes spawn around
   * `anchor` (the player) and fly inward, getting absorbed. `t` (0→1) ramps the
   * spawn rate so it intensifies as it nears ready.
   */
  setCharge(id: string, anchor: THREE.Vector3, t: number, dt: number) {
    let inst = this.charges.get(id);
    if (!inst) {
      inst = { particles: [], spawnAccum: 0 };
      this.charges.set(id, inst);
    }

    const k = Math.min(1, Math.max(0, t));
    const rate = STREAM_RATE_MIN + (STREAM_RATE_MAX - STREAM_RATE_MIN) * k;
    inst.spawnAccum += dt * rate;
    while (inst.spawnAccum >= 1) {
      inst.spawnAccum -= 1;
      this.spawnStreamParticle(inst, anchor);
    }

    for (let i = inst.particles.length - 1; i >= 0; i--) {
      const p = inst.particles[i];
      p.progress += p.speed * dt;
      if (p.progress >= 1) {
        this.group.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
        inst.particles.splice(i, 1);
        continue;
      }
      // Position interpolates from the rim (progress 0) to the player (1).
      const remain = 1 - p.progress;
      p.mesh.position.set(
        anchor.x + p.offset.x * remain,
        anchor.y + p.offset.y * remain,
        anchor.z + p.offset.z * remain,
      );
      p.mesh.rotation.x += p.spin.x * dt;
      p.mesh.rotation.y += p.spin.y * dt;
      // Shrink + brighten as it's absorbed.
      p.mesh.scale.setScalar(p.baseScale * (0.5 + 0.5 * remain));
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(1, 0.5 + remain);
    }
  }

  private spawnStreamParticle(inst: ChargeInstance, anchor: THREE.Vector3) {
    const baseScale = 0.07 + Math.random() * 0.07; // tiny
    const m = new THREE.Mesh(CUBE, glowMat(Math.random() < 0.5 ? BLUE_BRIGHT : BLUE_GLOW, 1));
    m.scale.setScalar(baseScale);
    // Random point on a sphere shell around the player.
    const theta = Math.random() * Math.PI * 2;
    const r = 1.2 + Math.random() * 0.9;
    const offset = new THREE.Vector3(
      Math.cos(theta) * r,
      (Math.random() - 0.2) * 1.3,
      Math.sin(theta) * r,
    );
    m.position.copy(anchor).add(offset);
    this.group.add(m);
    inst.particles.push({
      mesh: m,
      offset,
      progress: 0,
      speed: 1.6 + Math.random() * 1.3,
      spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8),
      baseScale,
    });
  }

  /** Remove caster `id`'s charge stream (on fire, cancel, death, or disconnect). */
  clearCharge(id: string) {
    const inst = this.charges.get(id);
    if (!inst) return;
    for (const p of inst.particles) {
      this.group.remove(p.mesh);
      (p.mesh.material as THREE.Material).dispose();
    }
    this.charges.delete(id);
  }

  /** Fire a beam from `origin` along `dir`. Visual-only when `damaging` is false. */
  fire(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    damaging = true,
    ownerSide: BulletOwner = "player",
    lethal = true,
    ownerId = "",
  ) {
    const d = dir.clone();
    d.y = 0;
    d.normalize();

    const burst = new THREE.Mesh(CUBE, glowMat(BLUE_BRIGHT, 0.85));
    burst.scale.setScalar(0.62);
    burst.position.copy(origin);
    this.group.add(burst);
    this.trail.push({
      mesh: burst,
      life: 0.35,
      maxLife: 0.35,
      spin: new THREE.Vector3(2, 2, 0),
      vel: new THREE.Vector3(0, 0, 0),
    });

    const head = new THREE.Mesh(CUBE, glowMat(BLUE_BRIGHT, 0.9));
    head.scale.setScalar(0.48);
    head.position.copy(origin);
    this.group.add(head);
    this.beams.push({
      head,
      pos: origin.clone(),
      dir: d,
      traveled: 0,
      damaging,
      lethal,
      ownerSide,
      ownerId,
      trailAccum: 0,
    });
  }

  update(dt: number) {
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      const step = BEAM_SPEED * dt;
      b.pos.addScaledVector(b.dir, step);
      b.traveled += step;
      b.head.position.copy(b.pos);
      b.head.rotation.x += dt * 6;
      b.head.rotation.y += dt * 4;

      b.trailAccum += step;
      while (b.trailAccum >= 0.26) {
        b.trailAccum -= 0.26;
        const c = new THREE.Mesh(CUBE, glowMat(Math.random() < 0.5 ? BLUE : BLUE_DEEP, 0.7));
        c.scale.setScalar(0.16 + Math.random() * 0.2);
        c.position.copy(b.pos).add(
          new THREE.Vector3(
            (Math.random() - 0.5) * 0.4,
            (Math.random() - 0.5) * 0.4,
            (Math.random() - 0.5) * 0.4,
          ),
        );
        this.group.add(c);
        this.trail.push({
          mesh: c,
          life: 0.5,
          maxLife: 0.5,
          spin: new THREE.Vector3(Math.random() * 5, Math.random() * 5, Math.random() * 5),
          vel: new THREE.Vector3(
            (Math.random() - 0.5) * 1.2,
            (Math.random() - 0.5) * 1.2,
            (Math.random() - 0.5) * 1.2,
          ),
        });
      }

      let hitTarget: BulletTarget | null = null;
      if (b.damaging) {
        for (const tgt of this.targets) {
          if (!tgt.isAlive()) continue;
          if (tgt.id === b.ownerId) continue; // never hit the caster
          // Local bots can't mega networked remotes (server-authoritative).
          if (b.ownerSide === "bot" && tgt.remote) continue;
          const dx = tgt.position.x - b.pos.x;
          const dz = tgt.position.z - b.pos.z;
          if (dx * dx + dz * dz <= BEAM_HIT_RADIUS * BEAM_HIT_RADIUS) {
            hitTarget = tgt;
            break;
          }
        }
      }

      if (hitTarget || b.traveled >= BEAM_MAX_RANGE) {
        this.dissolveBeam(b);
        this.group.remove(b.head);
        (b.head.material as THREE.Material).dispose();
        this.beams.splice(i, 1);
        if (hitTarget) this.onHit?.(hitTarget, b.dir.clone(), b.lethal, b.ownerId);
      }
    }

    for (let i = this.trail.length - 1; i >= 0; i--) {
      const c = this.trail[i];
      c.life -= dt;
      if (c.life <= 0) {
        this.group.remove(c.mesh);
        (c.mesh.material as THREE.Material).dispose();
        this.trail.splice(i, 1);
        continue;
      }
      const k = c.life / c.maxLife;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += c.spin.x * dt;
      c.mesh.rotation.y += c.spin.y * dt;
      (c.mesh.material as THREE.MeshBasicMaterial).opacity = k;
      c.mesh.scale.multiplyScalar(1 + dt * 0.4);
    }
  }

  private dissolveBeam(b: Beam) {
    const p = b.pos;
    for (let i = 0; i < 14; i++) {
      const c = new THREE.Mesh(CUBE, glowMat(i % 2 ? BLUE : BLUE_BRIGHT, 0.8));
      c.scale.setScalar(0.12 + Math.random() * 0.2);
      c.position.copy(p);
      this.group.add(c);
      this.trail.push({
        mesh: c,
        life: 0.6,
        maxLife: 0.6,
        spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8),
        vel: new THREE.Vector3(
          (Math.random() - 0.5) * 6,
          Math.random() * 4,
          (Math.random() - 0.5) * 6,
        ),
      });
    }
    this.smoke?.spawnPuff(p.clone(), new THREE.Vector3(0, 1, 0), 8, "#ffffff");
    this.onBeamEnd?.(p.x, p.y, p.z);
  }

  dispose() {
    for (const id of [...this.charges.keys()]) this.clearCharge(id);
    for (const b of this.beams) {
      this.group.remove(b.head);
      (b.head.material as THREE.Material).dispose();
    }
    this.beams = [];
    for (const c of this.trail) {
      this.group.remove(c.mesh);
      (c.mesh.material as THREE.Material).dispose();
    }
    this.trail = [];
    this.targets = [];
  }
}
