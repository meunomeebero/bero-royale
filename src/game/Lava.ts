import * as THREE from "three";

const LAVA_COLOR = new THREE.Color("#ff5a16");
const LAVA_EMISSIVE = new THREE.Color("#ff2a05");
const LAVA_DEEP = new THREE.Color("#3a0a02");

export interface LavaHazard {
  /** Center (XZ). */
  cx: number;
  cz: number;
  /** Bounding box used for square hazards (river segments / square pits). */
  halfW: number;
  halfD: number;
  /** If > 0, hazard is treated as a circle of this radius (overrides box). */
  radius: number;
}

/**
 * Procedurally placed lava pits and a winding lava river. Pure visuals +
 * geometry data for collision (returned via getHazards()).
 */
export class Lava {
  readonly group: THREE.Group;
  private hazards: LavaHazard[] = [];
  private glowMeshes: THREE.Mesh[] = [];
  private rim: THREE.Group;
  private elapsed = 0;

  constructor(mapHalfSize: number, sidewalkHalfRoad: number) {
    this.group = new THREE.Group();
    this.rim = new THREE.Group();
    this.group.add(this.rim);

    // ---- 1) Lava river: diagonal winding band that crosses the map ----
    // Built from many short overlapping segments so it can curve.
    const SEG_LEN = 1.6;
    const RIVER_W = 1.4;
    const startX = -mapHalfSize + 2;
    const startZ = -mapHalfSize * 0.7;
    let x = startX;
    let z = startZ;
    let angle = Math.PI * 0.18;
    const segments = 60;
    for (let i = 0; i < segments; i++) {
      // Skip the central intersection (so the player can still walk through it)
      if (Math.abs(x) < sidewalkHalfRoad && Math.abs(z) < sidewalkHalfRoad) {
        x += Math.cos(angle) * SEG_LEN;
        z += Math.sin(angle) * SEG_LEN;
        angle += (Math.random() - 0.5) * 0.4;
        continue;
      }
      this.addRectHazard(x, z, RIVER_W, SEG_LEN, angle);
      x += Math.cos(angle) * SEG_LEN;
      z += Math.sin(angle) * SEG_LEN;
      angle += (Math.random() - 0.5) * 0.45;
      if (x > mapHalfSize - 1 || z > mapHalfSize - 1) break;
    }

    // ---- 2) Random circular lava pits scattered across the map ----
    const NUM_PITS = 14;
    const placed: Array<[number, number]> = [];
    for (let i = 0; i < NUM_PITS; i++) {
      let attempts = 0;
      while (attempts++ < 30) {
        const px = (Math.random() * 2 - 1) * (mapHalfSize - 2);
        const pz = (Math.random() * 2 - 1) * (mapHalfSize - 2);
        // Avoid spawning right on the central intersection
        if (Math.abs(px) < sidewalkHalfRoad + 1 && Math.abs(pz) < sidewalkHalfRoad + 1) {
          continue;
        }
        // Keep pits apart from each other
        let tooClose = false;
        for (const [qx, qz] of placed) {
          if (Math.hypot(px - qx, pz - qz) < 4.5) {
            tooClose = true;
            break;
          }
        }
        if (tooClose) continue;
        const radius = 0.7 + Math.random() * 0.9;
        this.addCirclePit(px, pz, radius);
        placed.push([px, pz]);
        break;
      }
    }
  }

  private addRectHazard(
    cx: number,
    cz: number,
    width: number,
    depth: number,
    rotY: number,
  ) {
    // Slightly recessed lava slab
    const slabY = -0.04;
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(width, 0.08, depth),
      new THREE.MeshBasicMaterial({ color: LAVA_DEEP }),
    );
    slab.position.set(cx, slabY, cz);
    slab.rotation.y = rotY;
    this.group.add(slab);

    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(width * 0.95, depth * 0.95),
      new THREE.MeshBasicMaterial({
        color: LAVA_COLOR,
        transparent: true,
        opacity: 1,
      }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.rotation.z = rotY;
    glow.position.set(cx, 0.005, cz);
    this.group.add(glow);
    this.glowMeshes.push(glow);

    // Subtle rim outline
    const rimMesh = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.08, 0.04, depth + 0.08),
      new THREE.MeshLambertMaterial({
        color: LAVA_EMISSIVE,
        emissive: LAVA_EMISSIVE,
        emissiveIntensity: 0.6,
      }),
    );
    rimMesh.position.set(cx, slabY + 0.02, cz);
    rimMesh.rotation.y = rotY;
    this.rim.add(rimMesh);

    // Collision: axis-aligned box approximation (accurate enough for narrow segments)
    const cos = Math.abs(Math.cos(rotY));
    const sin = Math.abs(Math.sin(rotY));
    this.hazards.push({
      cx,
      cz,
      halfW: (width * cos + depth * sin) / 2,
      halfD: (width * sin + depth * cos) / 2,
      radius: 0,
    });
  }

  private addCirclePit(cx: number, cz: number, radius: number) {
    const slab = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius * 0.85, 0.16, 14),
      new THREE.MeshBasicMaterial({ color: LAVA_DEEP }),
    );
    slab.position.set(cx, -0.05, cz);
    this.group.add(slab);

    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(radius * 0.92, 22),
      new THREE.MeshBasicMaterial({
        color: LAVA_COLOR,
        transparent: true,
        opacity: 1,
      }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(cx, 0.01, cz);
    this.group.add(glow);
    this.glowMeshes.push(glow);

    // Glowing rim
    const rimGeom = new THREE.RingGeometry(radius * 0.95, radius * 1.1, 24);
    const rim = new THREE.Mesh(
      rimGeom,
      new THREE.MeshBasicMaterial({
        color: LAVA_EMISSIVE,
        transparent: true,
        opacity: 0.9,
      }),
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(cx, 0.015, cz);
    this.group.add(rim);

    this.hazards.push({
      cx,
      cz,
      halfW: radius,
      halfD: radius,
      radius,
    });
  }

  /** Returns true if (x, z) is currently inside any lava hazard. */
  isInsideHazard(x: number, z: number): boolean {
    for (const h of this.hazards) {
      if (h.radius > 0) {
        if ((x - h.cx) ** 2 + (z - h.cz) ** 2 <= h.radius * h.radius) {
          return true;
        }
      } else {
        if (
          Math.abs(x - h.cx) <= h.halfW &&
          Math.abs(z - h.cz) <= h.halfD
        ) {
          return true;
        }
      }
    }
    return false;
  }

  update(dt: number) {
    this.elapsed += dt;
    // Pulse opacity / scale a bit so the lava feels alive
    const t = this.elapsed;
    for (let i = 0; i < this.glowMeshes.length; i++) {
      const g = this.glowMeshes[i];
      const mat = g.material as THREE.MeshBasicMaterial;
      const pulse = 0.78 + Math.sin(t * 2 + i * 0.7) * 0.15;
      mat.opacity = pulse;
    }
  }

  dispose() {
    // Three.js GC by traversing
    this.group.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) {
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach((mat) => mat.dispose());
      }
    });
  }
}
