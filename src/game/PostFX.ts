import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPixelatedPass } from "three/examples/jsm/postprocessing/RenderPixelatedPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { Pass } from "three/examples/jsm/postprocessing/Pass.js";
import {
  PIXEL_SIZE,
  POSTERIZE_LEVELS,
  POSTERIZE_SATURATION,
} from "./consts";

/**
 * Map the VHS-filter "level" slider (0..1) onto the PIXELATION + POSTERIZE knobs
 * by lerping from a near-clean endpoint (level 0) to the shipped look (level 1).
 * The cartoon OUTLINE is NOT a post-process here — it's an inverted-hull shell on
 * the geometry (see Outline.ts), so the RenderPixelatedPass edges stay OFF (they
 * barely fire under the orthographic camera anyway). The filter is never fully
 * OFF here — that is the separate "Modo desenho" toggle (Game rebuilds PostFX).
 */
function paramsForLevel(level: number) {
  const t = Math.max(0, Math.min(1, level));
  const lerp = (clean: number, full: number) => clean + (full - clean) * t;
  return {
    // RenderPixelatedPass block size: chunkier toward level 1 (1px = full-res).
    pixelSize: lerp(1, PIXEL_SIZE),
    // Posterize: MORE bands (=subtler) toward 0, flatter cartoon bands toward 1.
    levels: lerp(32, POSTERIZE_LEVELS),
    saturation: lerp(1, POSTERIZE_SATURATION),
  };
}

/**
 * "Modo desenho" — a GameCube-flavored post-processing stack rendered in front of
 * the normal frame. Three layered passes give the look the player asked for:
 *
 *   1. RenderPixelatedPass — renders the scene at a LOW internal resolution and
 *      upscales it crisp (the "lower pixel density" feel) AND draws ink outlines
 *      from surface-normal / depth discontinuities. Pixelation + contour in one.
 *   2. Posterize (custom ShaderPass) — quantizes color into a few flat bands with
 *      a small saturation punch: the cartoon "filter on top". Runs in LINEAR space
 *      before OutputPass so the canonical color pipeline stays correct.
 *   3. OutputPass — the final linear→sRGB (+ tone-map) conversion, renders to screen.
 *
 * This class owns ONLY the composer. The renderer (and its pixelRatio) stay owned
 * by Game, so the filter is fully reversible by disposing this and rendering the
 * scene directly again — no materials are touched.
 */

/** Cartoon color-banding: flat levels per channel + a saturation nudge. */
const PosterizeShader: THREE.ShaderMaterialParameters & {
  uniforms: Record<string, THREE.IUniform>;
} = {
  uniforms: {
    tDiffuse: { value: null },
    levels: { value: POSTERIZE_LEVELS },
    saturation: { value: POSTERIZE_SATURATION },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float levels;
    uniform float saturation;
    varying vec2 vUv;
    void main() {
      vec4 texel = texture2D( tDiffuse, vUv );
      vec3 c = texel.rgb;
      // Punchy cartoon color: push saturation around luma, then flatten to bands.
      // Linear-space luma coefficients (Rec.709) — the buffer is linear here.
      float luma = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
      c = mix( vec3( luma ), c, saturation );
      c = floor( c * levels + 0.5 ) / levels;
      gl_FragColor = vec4( clamp( c, 0.0, 1.0 ), texel.a );
    }
  `,
};

export class PostFX {
  private composer: EffectComposer;
  /** The passes we added — kept so dispose() can free each one (see dispose). */
  private passes: Pass[];
  /** Kept to retune the look live when the VHS-level slider changes. */
  private pixelPass: RenderPixelatedPass;
  private posterizePass: ShaderPass;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    width: number,
    height: number,
    level = 1,
  ) {
    const p = paramsForLevel(level);
    // Edges OFF — the cartoon outline is an inverted-hull shell (Outline.ts),
    // not a post-process edge (which barely fires under the ortho camera).
    this.pixelPass = new RenderPixelatedPass(p.pixelSize, scene, camera, {
      normalEdgeStrength: 0,
      depthEdgeStrength: 0,
    });
    this.posterizePass = new ShaderPass(PosterizeShader);
    this.posterizePass.uniforms.levels.value = p.levels;
    this.posterizePass.uniforms.saturation.value = p.saturation;

    this.composer = new EffectComposer(renderer);
    this.passes = [this.pixelPass, this.posterizePass, new OutputPass()];
    for (const pass of this.passes) this.composer.addPass(pass);
    this.composer.setSize(width, height);
  }

  /** Live-retune the pixelation + posterize to a 0..1 VHS intensity (no rebuild). */
  setLevel(level: number) {
    const p = paramsForLevel(level);
    this.pixelPass.setPixelSize(p.pixelSize);
    this.posterizePass.uniforms.levels.value = p.levels;
    this.posterizePass.uniforms.saturation.value = p.saturation;
  }

  render() {
    this.composer.render();
  }

  setSize(width: number, height: number) {
    this.composer.setSize(width, height);
  }

  dispose() {
    // EffectComposer.dispose() only frees its OWN render targets + copyPass, not
    // the passes we added. The filter toggle rebuilds PostFX on every flip, so we
    // must dispose each pass (RenderPixelatedPass holds two render targets) or GPU
    // memory accumulates with each ON/OFF.
    for (const pass of this.passes) pass.dispose();
    this.composer.dispose();
  }
}
