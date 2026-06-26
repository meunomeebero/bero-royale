import * as THREE from "three";
import { ModelLibrary } from "./ModelLibrary";

/**
 * A random voxel animal used as an entity body. Drops into the existing
 * Player/Bot rig: `group` receives the squash/stretch scale, lean rotation and
 * hit-shake position exactly like the old cube mesh did. An inner group handles
 * facing so it can spin to look where the entity aims without fighting the lean.
 *
 * Tinting (hit flash / health damage / death fade) is applied across every
 * material of the model so the textured animal still reads damage feedback.
 */

const WHITE = new THREE.Color(0xffffff);
const DAMAGE = new THREE.Color(0x6a1717);
const FLASH = new THREE.Color(0xeaeaea);

// Local forward of the MagicaVoxel animals maps to this yaw offset so they face
// the aim direction (head toward the crosshair). Tuned against the in-game aim
// convention (yaw = atan2(dz, dx)).
const FORWARD_OFFSET = Math.PI / 2;

export const AVATAR_HEIGHT = 0.735;

export class Avatar {
  /** Assign to the entity's `body`: scale / lean / shake act here. */
  readonly group: THREE.Group;
  readonly animalName: string;
  private facing: THREE.Group;
  private materials: THREE.MeshLambertMaterial[];
  /** Cel-outline shells — hidden in lockstep with the body's opacity (the shared
   *  black material can't fade per-instance, so we toggle visibility instead). */
  private shells: THREE.Mesh[] = [];

  constructor(animalName: string, height = AVATAR_HEIGHT, footY = 0) {
    this.animalName = animalName;
    const inst = ModelLibrary.create("animals", animalName, height, true);
    this.materials = inst.materials;
    inst.object.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.isMesh && m.userData.isOutline) this.shells.push(m);
    });

    inst.object.position.y = footY; // drop feet to the rig's ground reference
    this.facing = new THREE.Group();
    this.facing.add(inst.object);

    this.group = new THREE.Group();
    this.group.add(this.facing);

    for (const m of this.materials) {
      m.emissive = new THREE.Color(0x000000);
      m.emissiveIntensity = 1;
    }
  }

  /** Rotate the model to look along a world-space yaw (atan2(dz, dx)). */
  faceYaw(yaw: number) {
    this.facing.rotation.y = -yaw + FORWARD_OFFSET;
  }

  /**
   * Stretch the body along its facing direction (local +Z = where faceYaw
   * points). Positive `amount` elongates forward + slims the sides for the
   * classic dash motion-stretch; negative gives the elastic recoil.
   */
  setDashStretch(amount: number) {
    this.facing.scale.set(1 - amount * 0.4, 1 - amount * 0.28, 1 + amount * 1.1);
  }

  /** Restore healthy appearance (full opacity, true colors, no flash). */
  reset() {
    this.facing.scale.set(1, 1, 1);
    for (const m of this.materials) {
      m.opacity = 1;
      m.color.copy(WHITE);
      m.emissive.setRGB(0, 0, 0);
    }
    for (const s of this.shells) s.visible = true;
  }

  setOpacity(o: number) {
    for (const m of this.materials) m.opacity = o;
    // Hide the outline as the body fades (death/respawn blink) so it never
    // lingers as a solid black silhouette with no body inside.
    for (const s of this.shells) s.visible = o > 0.01;
  }

  /**
   * @param damage 0 (healthy) .. 1 (dead) — darkens/reddens the texture.
   * @param hitFlash paints a bright flash this frame.
   */
  applyTint(damage: number, hitFlash: boolean) {
    for (const m of this.materials) {
      if (hitFlash) {
        m.color.copy(WHITE);
        m.emissive.copy(FLASH);
      } else {
        m.emissive.setRGB(0, 0, 0);
        m.color.copy(WHITE).lerp(DAMAGE, Math.min(1, damage) * 0.7);
      }
    }
  }

  dispose() {
    // Only the cloned materials are per-instance (ModelLibrary.create clones the
    // materials but shares both the template geometry and its palette texture
    // across every avatar of the same animal). Disposing the geometry or the
    // texture here would corrupt/blank every other live avatar of this animal,
    // so we dispose ONLY what this instance owns: its cloned materials.
    for (const m of this.materials) m.dispose();
  }
}
