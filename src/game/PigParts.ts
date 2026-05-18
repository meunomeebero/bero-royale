import * as THREE from "three";

/**
 * Builds the little decorative cubes that turn a plain pink box into a pig:
 * - two eye cubes on the front,
 * - one snout cube between/below the eyes,
 * - one tail cube on the back.
 *
 * Convention: the body cube is centered at (0,0,0) with side length `size`,
 * the pig "looks" toward +Z (front), so the player-facing front is +Z and
 * the rear (tail) is -Z. The aimGroup of Player/Bot rotates the body around Y
 * so the pig always faces its aim direction.
 */
export function buildPigDecorations(size: number): THREE.Group {
  const g = new THREE.Group();
  const half = size / 2;

  // Eyes: small black cubes (with a tiny pinch of white via emissive tint)
  const eyeGeom = new THREE.BoxGeometry(0.08, 0.08, 0.06);
  const eyeMat = new THREE.MeshLambertMaterial({
    color: new THREE.Color("#0c0c12"),
    emissive: new THREE.Color("#000000"),
  });
  const eyeL = new THREE.Mesh(eyeGeom, eyeMat);
  const eyeR = new THREE.Mesh(eyeGeom, eyeMat);
  // Position on the front face (+Z), upper-ish, slightly inset
  const eyeY = size * 0.18;
  const eyeX = size * 0.18;
  const eyeZ = half + 0.005; // a hair past the face to avoid z-fighting
  eyeL.position.set(-eyeX, eyeY, eyeZ);
  eyeR.position.set(eyeX, eyeY, eyeZ);
  g.add(eyeL);
  g.add(eyeR);

  // Snout: one darker pink cube centered, below the eyes
  const snoutGeom = new THREE.BoxGeometry(0.16, 0.12, 0.06);
  const snoutMat = new THREE.MeshLambertMaterial({
    color: new THREE.Color("#b65f63"),
    emissive: new THREE.Color("#3a1a1c"),
    emissiveIntensity: 0.25,
  });
  const snout = new THREE.Mesh(snoutGeom, snoutMat);
  snout.position.set(0, -size * 0.05, eyeZ);
  g.add(snout);

  // Tail: small pink cube on the back (-Z), middle height
  const tailGeom = new THREE.BoxGeometry(0.08, 0.08, 0.08);
  const tailMat = new THREE.MeshLambertMaterial({
    color: new THREE.Color("#efa3a3"),
  });
  const tail = new THREE.Mesh(tailGeom, tailMat);
  tail.position.set(0, size * 0.08, -half - 0.04);
  g.add(tail);

  return g;
}

/**
 * Builds a floating red name label as a Sprite that always faces the camera.
 */
export function buildNameLabel(text: string): THREE.Sprite {
  const cnv = document.createElement("canvas");
  cnv.width = 256;
  cnv.height = 64;
  const ctx = cnv.getContext("2d")!;
  ctx.clearRect(0, 0, cnv.width, cnv.height);

  // Bold pixel-y font with strong outline for legibility at night
  ctx.font = "bold 40px 'Courier New', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Thick black outline
  ctx.lineWidth = 8;
  ctx.strokeStyle = "#1a0a0a";
  ctx.strokeText(text, cnv.width / 2, cnv.height / 2);

  // Bright red fill
  ctx.fillStyle = "#ff3a3a";
  ctx.fillText(text, cnv.width / 2, cnv.height / 2);

  const tex = new THREE.CanvasTexture(cnv);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;

  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false, // always visible above the world
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.4, 0.35, 1);
  // Render after the rest of the scene so it never gets hidden behind fog
  sprite.renderOrder = 999;
  return sprite;
}
