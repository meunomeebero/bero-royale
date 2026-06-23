import * as THREE from "three";

/**
 * Ambient candy-colored butterflies that flutter and drift around the map to
 * make the world feel alive. Camera-facing sprites that flap (horizontal
 * squash) and wander with a gentle random-walk heading.
 */

const COUNT = 24;
const COLORS = [
  "#ff9ecb", "#ffd166", "#9be7ff", "#c8a2ff", "#ff8fa3", "#b8f2c9", "#ffc4e1",
];

function butterflyTexture(): THREE.Texture {
  const s = 64;
  const cnv = document.createElement("canvas");
  cnv.width = cnv.height = s;
  const ctx = cnv.getContext("2d")!;
  const cx = s / 2;
  ctx.fillStyle = "rgba(255,255,255,0.94)";
  const wing = (x: number, y: number, rx: number, ry: number) => {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  };
  // upper + lower wing pairs (mirrored)
  wing(cx - 12, 26, 11, 14);
  wing(cx + 12, 26, 11, 14);
  wing(cx - 9, 42, 8, 10);
  wing(cx + 9, 42, 8, 10);
  // body
  ctx.fillStyle = "rgba(58,38,52,0.92)";
  ctx.beginPath();
  ctx.ellipse(cx, 34, 2.2, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  // antennae
  ctx.strokeStyle = "rgba(58,38,52,0.8)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(cx, 22);
  ctx.lineTo(cx - 4, 15);
  ctx.moveTo(cx, 22);
  ctx.lineTo(cx + 4, 15);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(cnv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface Fly {
  sprite: THREE.Sprite;
  vx: number;
  vz: number;
  flap: number;
  bob: number;
  baseScale: number;
  y: number;
}

export class Butterflies {
  readonly group: THREE.Group;
  private flies: Fly[] = [];
  private mats: THREE.SpriteMaterial[] = [];
  private tex: THREE.Texture;
  private half: number;

  constructor(halfSize: number) {
    this.half = Math.max(4, halfSize - 2);
    this.group = new THREE.Group();
    this.tex = butterflyTexture();

    for (let i = 0; i < COUNT; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this.tex,
        color: new THREE.Color(COLORS[i % COLORS.length]),
        transparent: true,
        depthWrite: false,
      });
      this.mats.push(mat);
      const sprite = new THREE.Sprite(mat);
      const baseScale = 0.3 + Math.random() * 0.16;
      const x = (Math.random() * 2 - 1) * this.half;
      const z = (Math.random() * 2 - 1) * this.half;
      const y = 1.0 + Math.random() * 1.7;
      sprite.position.set(x, y, z);
      sprite.scale.set(baseScale, baseScale, 1);
      this.group.add(sprite);

      const ang = Math.random() * Math.PI * 2;
      const spd = 0.7 + Math.random() * 0.8;
      this.flies.push({
        sprite,
        vx: Math.cos(ang) * spd,
        vz: Math.sin(ang) * spd,
        flap: Math.random() * Math.PI * 2,
        bob: Math.random() * Math.PI * 2,
        baseScale,
        y,
      });
    }
  }

  update(dt: number) {
    for (const f of this.flies) {
      const spd = Math.hypot(f.vx, f.vz);
      const ang = Math.atan2(f.vz, f.vx) + (Math.random() - 0.5) * dt * 4;
      f.vx = Math.cos(ang) * spd;
      f.vz = Math.sin(ang) * spd;

      const p = f.sprite.position;
      p.x += f.vx * dt;
      p.z += f.vz * dt;
      f.bob += dt * 3;
      p.y = f.y + Math.sin(f.bob) * 0.2;

      if (p.x > this.half) f.vx = -Math.abs(f.vx);
      else if (p.x < -this.half) f.vx = Math.abs(f.vx);
      if (p.z > this.half) f.vz = -Math.abs(f.vz);
      else if (p.z < -this.half) f.vz = Math.abs(f.vz);

      f.flap += dt * 17;
      const flap = 0.35 + 0.65 * Math.abs(Math.sin(f.flap));
      f.sprite.scale.set(f.baseScale * flap, f.baseScale, 1);
    }
  }

  dispose() {
    for (const m of this.mats) m.dispose();
    this.tex.dispose();
  }
}
