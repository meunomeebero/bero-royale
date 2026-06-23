import * as THREE from "three";
import { ModelLibrary } from "./ModelLibrary";

/**
 * Server-authoritative power-up pickups (online only). The server decides spawns
 * + who picks up; this class is purely the CLIENT-side render: a floating voxel
 * collectible that bobs + spins over a glowing ground ring in the kind color.
 *
 * The 6 kinds (shared string keys server↔client) plus their model/label/color/
 * duration. `model` is a collectibles asset name (see ModelLibrary).
 *   duration 0 = instant effect; >0 = timed boost (seconds).
 */
export const POWERUP_KINDS: Record<
  string,
  { model: string; label: string; color: string; duration: number }
> = {
  // label = the EFFECT (pt-BR), never the power-up's name (drives the HUD boost chip).
  heal: { model: "honey", label: "HP", color: "#ffcf4d", duration: 0 },
  speed: { model: "candy", label: "Velocidade", color: "#ff7ab8", duration: 16 },
  rapid: { model: "corn", label: "Tiro rápido", color: "#ffe066", duration: 20 },
  dash: { model: "carrot", label: "Dash", color: "#ff8a3d", duration: 0 },
  // Shield pickups: each adds one accumulating shield charge (BR-style armor),
  // shown under the HP pips. Not timed (duration 0). Cheese is a 2nd shield.
  shield: { model: "bamboo", label: "Escudo", color: "#6fd66f", duration: 0 },
  super: { model: "cheese", label: "Escudo", color: "#6fd66f", duration: 0 },
};

/** While >0, the pickup is flying OUT of a crate burst toward its resting spot. */
interface Eject {
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  dur: number;
}

/** A live floating pickup on the map. */
interface Pickup {
  kind: string;
  /** Wrapper holding the bobbing model + the ground glow ring. */
  root: THREE.Group;
  /** The cloned collectible model (bobs + spins). */
  model: THREE.Object3D;
  /** Glowing ring under the pickup (kind color). */
  ring: THREE.Mesh;
  /** Phase offset so neighbours don't bob in lockstep. */
  phase: number;
  /** Set when the item is being expelled from a crate burst (arc out + spin). */
  eject?: Eject;
}

const EJECT_DUR = 0.55; // seconds the item takes to fly out of the smoke
const EJECT_ARC = 1.5; // peak height of the eject arc

/** One short-lived poof cube from a pickup burst. */
interface Poof {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
  maxLife: number;
}

const POOF_GEOM = new THREE.BoxGeometry(0.09, 0.09, 0.09);

export class PowerUps {
  readonly group: THREE.Group;
  private pickups = new Map<string, Pickup>();
  private poofs: Poof[] = [];
  private clock = 0;

  constructor() {
    this.group = new THREE.Group();
  }

  /** True if a pickup with this id already exists (clients dedupe by id). */
  has(id: string): boolean {
    return this.pickups.has(id);
  }

  /**
   * Spawn a floating pickup. Idempotent: re-announces from the server (so late
   * joiners see active power-ups) are ignored once we already hold the id.
   */
  spawn(
    id: string,
    kind: string,
    x: number,
    y: number,
    z: number,
    fromX?: number,
    fromZ?: number,
  ): void {
    if (this.pickups.has(id)) return;
    const def = POWERUP_KINDS[kind];
    if (!def) return;

    // Crate drops fly OUT from the burst origin (fromX,fromZ) to their spot.
    const eject =
      fromX !== undefined && fromZ !== undefined
        ? {
            from: new THREE.Vector3(fromX, y, fromZ),
            to: new THREE.Vector3(x, y, z),
            t: 0,
            dur: EJECT_DUR,
          }
        : undefined;

    const root = new THREE.Group();
    root.position.copy(eject ? eject.from : new THREE.Vector3(x, y, z));

    const model = ModelLibrary.create("collectibles", def.model, 0.6).object;
    root.add(model);

    // Glowing ring under the pickup, in the kind color (cf. Game.makeVoiceRing).
    const ringGeo = new THREE.RingGeometry(0.34, 0.46, 48);
    const ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(def.color),
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.42; // just below the model's feet (root sits at spawn Y)
    ring.renderOrder = 2;
    root.add(ring);

    this.group.add(root);
    this.pickups.set(id, {
      kind,
      root,
      model,
      ring,
      phase: Math.random() * Math.PI * 2,
      eject,
    });
  }

  /**
   * Remove a pickup; `poof` spawns a small burst of cubes in the kind color.
   * Returns true if a pickup with this id actually existed (so the caller can
   * apply the effect exactly once, even if a duplicate "putake" ever arrives).
   */
  remove(id: string, poof = false): boolean {
    const p = this.pickups.get(id);
    if (!p) return false;
    if (poof) {
      const def = POWERUP_KINDS[p.kind];
      this.spawnPoof(p.root.position, def ? def.color : "#ffffff");
    }
    this.group.remove(p.root);
    disposeObject(p.root);
    this.pickups.delete(id);
    return true;
  }

  /** Bob + spin the floating pickups, pulse their rings, advance poofs. */
  update(dt: number): void {
    this.clock += dt;
    for (const p of this.pickups.values()) {
      // Eject: arc out of the crate burst, spinning, then settle into the float.
      if (p.eject) {
        p.eject.t += dt;
        const k = Math.min(1, p.eject.t / p.eject.dur);
        const he = 1 - (1 - k) * (1 - k); // easeOut for the horizontal travel
        const { from, to } = p.eject;
        p.root.position.x = from.x + (to.x - from.x) * he;
        p.root.position.z = from.z + (to.z - from.z) * he;
        p.root.position.y = from.y + (to.y - from.y) * k + Math.sin(k * Math.PI) * EJECT_ARC;
        p.model.rotation.y += dt * 11;
        p.model.rotation.x += dt * 7;
        if (k >= 1) {
          p.root.position.copy(to);
          p.model.rotation.x = 0;
          p.eject = undefined;
        }
        continue; // skip the resting bob while flying out
      }
      const t = this.clock + p.phase;
      // Root already sits at the spawn Y; bob the model around the wrapper origin.
      p.model.position.y = Math.sin(t * 2.2) * 0.12;
      p.model.rotation.y += dt * 1.4;
      const ringMat = p.ring.material as THREE.MeshBasicMaterial;
      ringMat.opacity = 0.4 + Math.sin(t * 3) * 0.18;
    }
    for (let i = this.poofs.length - 1; i >= 0; i--) {
      const q = this.poofs[i];
      q.life -= dt;
      if (q.life <= 0) {
        this.group.remove(q.mesh);
        (q.mesh.material as THREE.Material).dispose();
        this.poofs.splice(i, 1);
        continue;
      }
      q.vel.y -= 9 * dt; // gravity
      q.mesh.position.addScaledVector(q.vel, dt);
      q.mesh.rotation.x += q.spin.x * dt;
      q.mesh.rotation.y += q.spin.y * dt;
      q.mesh.rotation.z += q.spin.z * dt;
      (q.mesh.material as THREE.MeshLambertMaterial).opacity = q.life / q.maxLife;
    }
  }

  /** Short burst of small cubes flying outward in the kind color. */
  private spawnPoof(at: THREE.Vector3, color: string) {
    const c = new THREE.Color(color);
    for (let i = 0; i < 12; i++) {
      const mat = new THREE.MeshLambertMaterial({
        color: c.clone(),
        emissive: c.clone().multiplyScalar(0.25),
        transparent: true,
        opacity: 1,
      });
      const mesh = new THREE.Mesh(POOF_GEOM, mat);
      mesh.position.copy(at);
      mesh.position.y += 0.4;
      const ang = Math.random() * Math.PI * 2;
      const out = 1.4 + Math.random() * 2.2;
      const vel = new THREE.Vector3(
        Math.cos(ang) * out,
        1.6 + Math.random() * 2.2,
        Math.sin(ang) * out,
      );
      const maxLife = 0.4 + Math.random() * 0.25;
      this.poofs.push({
        mesh,
        vel,
        spin: new THREE.Vector3(
          (Math.random() - 0.5) * 12,
          (Math.random() - 0.5) * 12,
          (Math.random() - 0.5) * 12,
        ),
        life: maxLife,
        maxLife,
      });
      this.group.add(mesh);
    }
  }

  dispose(): void {
    for (const p of this.pickups.values()) {
      this.group.remove(p.root);
      disposeObject(p.root);
    }
    this.pickups.clear();
    for (const q of this.poofs) {
      this.group.remove(q.mesh);
      (q.mesh.material as THREE.Material).dispose();
    }
    this.poofs = [];
    // POOF_GEOM is a module-level singleton shared across Game instances; keep it.
  }
}

/** Recursively dispose the cloned model's geometries + materials. */
function disposeObject(obj: THREE.Object3D) {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const m = mesh.material;
    if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
    else m?.dispose();
  });
}
