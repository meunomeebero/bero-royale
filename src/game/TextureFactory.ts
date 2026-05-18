import * as THREE from "three";

/**
 * Procedural pixel-art texture factory in the style of Minecraft (16x16 tiles
 * with base color + per-pixel tonal noise). All textures are crisp pixel art
 * (NearestFilter) and tileable.
 *
 * Each block face can have its own texture: top / side / bottom. We expose a
 * `kit(...)` helper that returns the array of 6 materials in the order
 * THREE.BoxGeometry expects: [+X, -X, +Y(top), -Y(bottom), +Z, -Z].
 */

const TILE_SIZE = 16;

/** Mulberry32 PRNG for deterministic per-tile noise. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Color {
  r: number;
  g: number;
  b: number;
}

function hexToRgb(hex: string): Color {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function clamp(v: number) {
  return Math.max(0, Math.min(255, v | 0));
}

interface NoiseSpec {
  /** Base color in hex (e.g. "#7da34c") */
  base: string;
  /** Lighter accent color (small chance) */
  light?: string;
  /** Darker accent color (small chance) */
  dark?: string;
  /** Optional third tone (e.g. dirt clumps in grass) */
  accent?: string;
  /** Probability (0..1) of using the light accent for a given pixel */
  lightChance?: number;
  darkChance?: number;
  accentChance?: number;
  /** Per-channel +/- noise range applied on top of base */
  noise?: number;
  /** Seed for reproducible noise */
  seed?: number;
}

function paintNoise(ctx: CanvasRenderingContext2D, spec: NoiseSpec) {
  const img = ctx.createImageData(TILE_SIZE, TILE_SIZE);
  const data = img.data;
  const base = hexToRgb(spec.base);
  const light = spec.light ? hexToRgb(spec.light) : null;
  const dark = spec.dark ? hexToRgb(spec.dark) : null;
  const accent = spec.accent ? hexToRgb(spec.accent) : null;
  const noise = spec.noise ?? 12;
  const r = rng(spec.seed ?? 42);
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const i = (y * TILE_SIZE + x) * 4;
      let c: Color = base;
      const roll = r();
      if (light && roll < (spec.lightChance ?? 0.1)) c = light;
      else if (
        dark &&
        roll < (spec.lightChance ?? 0.1) + (spec.darkChance ?? 0.12)
      )
        c = dark;
      else if (
        accent &&
        roll <
          (spec.lightChance ?? 0.1) +
            (spec.darkChance ?? 0.12) +
            (spec.accentChance ?? 0.06)
      )
        c = accent;
      const n = (r() - 0.5) * 2 * noise;
      data[i] = clamp(c.r + n);
      data[i + 1] = clamp(c.g + n);
      data[i + 2] = clamp(c.b + n);
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function newCanvas(): CanvasRenderingContext2D {
  const cnv = document.createElement("canvas");
  cnv.width = TILE_SIZE;
  cnv.height = TILE_SIZE;
  return cnv.getContext("2d")!;
}

function toTexture(ctx: CanvasRenderingContext2D): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  return tex;
}

// ---- Block texture recipes ------------------------------------------------

function makeDirtTexture(seed = 1): THREE.CanvasTexture {
  const ctx = newCanvas();
  paintNoise(ctx, {
    base: "#3a2618",
    light: "#56371f",
    dark: "#26180e",
    accent: "#1c100a",
    lightChance: 0.16,
    darkChance: 0.2,
    accentChance: 0.08,
    noise: 12,
    seed,
  });
  const r = rng(seed + 99);
  ctx.fillStyle = "#1c100a";
  for (let i = 0; i < 4; i++) {
    const x = Math.floor(r() * TILE_SIZE);
    const y = Math.floor(r() * TILE_SIZE);
    ctx.fillRect(x, y, 1, 1);
  }
  return toTexture(ctx);
}

function makeGrassTopTexture(seed = 2): THREE.CanvasTexture {
  const ctx = newCanvas();
  // Deep moonlit teal-grass. Very low contrast so directional light doesn't
  // wash the lighter pixels into white.
  paintNoise(ctx, {
    base: "#143a30",
    light: "#1a4a3c",
    dark: "#0a2520",
    accent: "#1f5a48",
    lightChance: 0.18,
    darkChance: 0.22,
    accentChance: 0.05,
    noise: 4,
    seed,
  });
  return toTexture(ctx);
}

/** Grass side: dirt with a bluish-green grass fringe along the TOP edge. */
function makeGrassSideTexture(seed = 3): THREE.CanvasTexture {
  const ctx = newCanvas();
  paintNoise(ctx, {
    base: "#3a2618",
    light: "#56371f",
    dark: "#26180e",
    accent: "#1c100a",
    lightChance: 0.16,
    darkChance: 0.2,
    accentChance: 0.08,
    noise: 12,
    seed,
  });
  // Paint the top 3-4 rows as a bluish-green grass fringe
  const r = rng(seed + 7);
  const greens = ["#143a30", "#1a4a3c", "#0a2520", "#1f5a48"];
  for (let x = 0; x < TILE_SIZE; x++) {
    const fringe = 3 + (r() < 0.4 ? 1 : 0);
    for (let y = 0; y < fringe; y++) {
      ctx.fillStyle = greens[Math.floor(r() * greens.length)];
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return toTexture(ctx);
}

function makeStoneTexture(seed = 4): THREE.CanvasTexture {
  const ctx = newCanvas();
  paintNoise(ctx, {
    base: "#7a7a82",
    light: "#9a9aa3",
    dark: "#54545b",
    accent: "#3d3d44",
    lightChance: 0.18,
    darkChance: 0.22,
    accentChance: 0.06,
    noise: 10,
    seed,
  });
  // a couple darker "cracks"
  const r = rng(seed + 21);
  ctx.fillStyle = "#3d3d44";
  for (let i = 0; i < 3; i++) {
    const x = Math.floor(r() * TILE_SIZE);
    const y = Math.floor(r() * TILE_SIZE);
    ctx.fillRect(x, y, 2, 1);
  }
  return toTexture(ctx);
}

function makeAsphaltTexture(seed = 5): THREE.CanvasTexture {
  const ctx = newCanvas();
  paintNoise(ctx, {
    base: "#3a3a40",
    light: "#55555c",
    dark: "#1f1f24",
    accent: "#4a5a3a", // mossy patches
    lightChance: 0.18,
    darkChance: 0.22,
    accentChance: 0.08,
    noise: 8,
    seed,
  });
  // dotted moss clumps
  const r = rng(seed + 11);
  ctx.fillStyle = "#5a7a3a";
  for (let i = 0; i < 5; i++) {
    const x = Math.floor(r() * TILE_SIZE);
    const y = Math.floor(r() * TILE_SIZE);
    ctx.fillRect(x, y, 1, 1);
  }
  return toTexture(ctx);
}

function makeSidewalkTexture(seed = 6): THREE.CanvasTexture {
  const ctx = newCanvas();
  paintNoise(ctx, {
    base: "#b8bcc2",
    light: "#cfd2d8",
    dark: "#8e9298",
    accent: "#6e7278",
    lightChance: 0.2,
    darkChance: 0.18,
    accentChance: 0.05,
    noise: 8,
    seed,
  });
  // paver grout lines: divide tile into 2x2 pavers (8 px each)
  ctx.fillStyle = "#3e4248";
  for (let i = 0; i < TILE_SIZE; i++) {
    ctx.fillRect(i, 7, 1, 1);
    ctx.fillRect(7, i, 1, 1);
  }
  return toTexture(ctx);
}

/** Crosswalk: asphalt base + two big white stripes running horizontally. */
function makeCrosswalkTexture(seed = 7): THREE.CanvasTexture {
  const ctx = newCanvas();
  paintNoise(ctx, {
    base: "#3a3a40",
    light: "#55555c",
    dark: "#1f1f24",
    lightChance: 0.16,
    darkChance: 0.2,
    noise: 6,
    seed,
  });
  // White stripes occupying rows 2-6 and 9-13
  const r = rng(seed + 33);
  for (let y = 2; y <= 6; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const c = r() < 0.85 ? 235 + Math.floor(r() * 20) : 180;
      ctx.fillStyle = `rgb(${c},${c},${c})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  for (let y = 9; y <= 13; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const c = r() < 0.85 ? 235 + Math.floor(r() * 20) : 180;
      ctx.fillStyle = `rgb(${c},${c},${c})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return toTexture(ctx);
}

function makeLavaTexture(seed = 8): THREE.CanvasTexture {
  const ctx = newCanvas();
  paintNoise(ctx, {
    base: "#ff5a16",
    light: "#ffb04a",
    dark: "#c0260a",
    accent: "#7a1a05",
    lightChance: 0.18,
    darkChance: 0.2,
    accentChance: 0.06,
    noise: 18,
    seed,
  });
  // a few bright "hot spots"
  const r = rng(seed + 5);
  ctx.fillStyle = "#ffe07a";
  for (let i = 0; i < 4; i++) {
    const x = Math.floor(r() * TILE_SIZE);
    const y = Math.floor(r() * TILE_SIZE);
    ctx.fillRect(x, y, 1, 1);
  }
  return toTexture(ctx);
}

function makeLavaRockTexture(seed = 9): THREE.CanvasTexture {
  // Cooled lava / obsidian rock for the lower lava layers
  const ctx = newCanvas();
  paintNoise(ctx, {
    base: "#3a1208",
    light: "#7a2a0e",
    dark: "#1a0703",
    accent: "#ff4a10",
    lightChance: 0.14,
    darkChance: 0.22,
    accentChance: 0.06,
    noise: 10,    seed,
  });
  return toTexture(ctx);
}

// ---- Material kits --------------------------------------------------------

function makeMat(tex: THREE.Texture, tint = "#ffffff"): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({
    map: tex,
    color: new THREE.Color(tint),
  });
}

function makeUnlitMat(tex: THREE.Texture, tint = "#ffffff"): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map: tex,
    color: new THREE.Color(tint),
  });
}

/** Build a 6-material array for a BoxGeometry: [+X,-X,top,bottom,+Z,-Z]. */
function sixSides(
  side: THREE.Material,
  top: THREE.Material,
  bottom: THREE.Material,
): THREE.Material[] {
  return [side, side, top, bottom, side, side];
}

export interface BlockKit {
  /** Materials in BoxGeometry order. */
  materials: THREE.Material[];
}

let _cache: Record<string, BlockKit> | null = null;

/** Returns the cached set of block kits used by the platform. */
export function getBlockKits(): {
  sidewalk: BlockKit;
  asphalt: BlockKit;
  crosswalkH: BlockKit;
  crosswalkV: BlockKit;
  dirt: BlockKit;
  stone: BlockKit;
  grass: BlockKit;
  lava: BlockKit;
  lavaRock: BlockKit;
} {
  if (_cache) return _cache as never;

  // Generate base textures once
  const dirtTex = makeDirtTexture(11);
  const stoneTex = makeStoneTexture(13);
  const grassTopTex = makeGrassTopTexture(15);
  const grassSideTex = makeGrassSideTexture(17);
  const asphaltTex = makeAsphaltTexture(19);
  const sidewalkTex = makeSidewalkTexture(21);
  const crosswalkTex = makeCrosswalkTexture(23);
  const lavaTex = makeLavaTexture(25);
  const lavaRockTex = makeLavaRockTexture(27);

  // Crosswalk rotated 90 deg for vertical-running stripes
  const crosswalkRotTex = makeCrosswalkTexture(23);
  crosswalkRotTex.center.set(0.5, 0.5);
  crosswalkRotTex.rotation = Math.PI / 2;

  const dirtMat = makeMat(dirtTex);
  const stoneMat = makeMat(stoneTex);

  const sidewalk: BlockKit = {
    materials: sixSides(
      dirtMat, // sides are dirt (you see them when walking off edge)
      makeMat(sidewalkTex),
      stoneMat,
    ),
  };
  const asphalt: BlockKit = {
    materials: sixSides(dirtMat, makeMat(asphaltTex), stoneMat),
  };
  const crosswalkH: BlockKit = {
    materials: sixSides(dirtMat, makeMat(crosswalkTex), stoneMat),
  };
  const crosswalkV: BlockKit = {
    materials: sixSides(dirtMat, makeMat(crosswalkRotTex), stoneMat),
  };
  const dirt: BlockKit = {
    materials: [dirtMat, dirtMat, dirtMat, dirtMat, dirtMat, dirtMat],
  };
  const stone: BlockKit = {
    materials: [stoneMat, stoneMat, stoneMat, stoneMat, stoneMat, stoneMat],
  };
  const grass: BlockKit = {
    materials: sixSides(
      makeMat(grassSideTex),
      makeMat(grassTopTex),
      dirtMat,
    ),
  };

  // Lava uses unlit / emissive-like materials so it stays bright at night.
  const lavaSide = makeUnlitMat(lavaTex, "#ff7a30");
  const lavaTop = makeUnlitMat(lavaTex);
  const lavaBottom = makeUnlitMat(lavaRockTex);
  const lava: BlockKit = {
    materials: sixSides(lavaSide, lavaTop, lavaBottom),
  };
  const lavaRockMat = makeUnlitMat(lavaRockTex, "#a02410");
  const lavaRock: BlockKit = {
    materials: [
      lavaRockMat,
      lavaRockMat,
      lavaRockMat,
      lavaRockMat,
      lavaRockMat,
      lavaRockMat,
    ],
  };

  _cache = {
    sidewalk,
    asphalt,
    crosswalkH,
    crosswalkV,
    dirt,
    stone,
    grass,
    lava,
    lavaRock,
  };
  return _cache as never;
}
