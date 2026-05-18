import * as THREE from "three";

interface FogPatch {
  mesh: THREE.Sprite;
  velocity: THREE.Vector3;
  baseOpacity: number;
  rotSpeed: number;
  bounds: { half: number };
}

/**
 * Drifting volumetric-ish fog patches: soft round sprites that float low over
 * the ground, slowly translating across the map and gently pulsing opacity.
 * Wraps around when leaving the play area so the world always feels misty.
 */
export class FogPatches {
  readonly group: THREE.Group;
  private patches: FogPatch[] = [];
  private mapHalf: number;
  private elapsed = 0;

  constructor(mapHalfSize: number, count = 10) {
    this.group = new THREE.Group();
    this.mapHalf = mapHalfSize;

    const texture = makeFogTexture();
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({
        map: texture,
        color: new THREE.Color("#9ec2ff"),
        transparent: true,
        opacity: 0.05 + Math.random() * 0.06,
        depthWrite: false,
        blending: THREE.NormalBlending,
      });
      const sprite = new THREE.Sprite(mat);
      const size = 5 + Math.random() * 5;
      sprite.scale.set(size, size * 0.5, 1);
      sprite.position.set(
        (Math.random() * 2 - 1) * mapHalfSize,
        0.7 + Math.random() * 0.6,
        (Math.random() * 2 - 1) * mapHalfSize,
      );
      const ang = Math.random() * Math.PI * 2;
      const speed = 0.15 + Math.random() * 0.25;
      this.patches.push({
        mesh: sprite,
        velocity: new THREE.Vector3(
          Math.cos(ang) * speed,
          0,
          Math.sin(ang) * speed,
        ),
        baseOpacity: mat.opacity,
        rotSpeed: (Math.random() - 0.5) * 0.05,
        bounds: { half: mapHalfSize },
      });
      this.group.add(sprite);
    }
  }

  update(dt: number) {
    this.elapsed += dt;
    for (const p of this.patches) {
      p.mesh.position.addScaledVector(p.velocity, dt);
      // Wrap around the map
      if (p.mesh.position.x > p.bounds.half) p.mesh.position.x = -p.bounds.half;
      if (p.mesh.position.x < -p.bounds.half) p.mesh.position.x = p.bounds.half;
      if (p.mesh.position.z > p.bounds.half) p.mesh.position.z = -p.bounds.half;
      if (p.mesh.position.z < -p.bounds.half) p.mesh.position.z = p.bounds.half;
      // Pulse opacity
      const mat = p.mesh.material as THREE.SpriteMaterial;
      mat.opacity =
        p.baseOpacity * (0.7 + 0.3 * Math.sin(this.elapsed * 0.6 + p.rotSpeed * 100));
    }
  }

  dispose() {
    for (const p of this.patches) {
      (p.mesh.material as THREE.SpriteMaterial).dispose();
    }
    this.patches = [];
  }
}

/** Soft round white texture used as the fog sprite. */
function makeFogTexture(): THREE.CanvasTexture {
  const size = 128;
  const cnv = document.createElement("canvas");
  cnv.width = size;
  cnv.height = size;
  const ctx = cnv.getContext("2d")!;
  const grad = ctx.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.05,
    size / 2,
    size / 2,
    size / 2,
  );
  grad.addColorStop(0, "rgba(255,255,255,0.9)");
  grad.addColorStop(0.4, "rgba(255,255,255,0.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cnv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
