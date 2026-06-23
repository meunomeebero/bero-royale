import * as THREE from "three";

/**
 * Procedurally-built voxel pig rig (legacy). Entities (Player/Bot/RemotePlayer)
 * no longer use this — they now render OBJ MagicaVoxel animals via `Avatar` +
 * `ModelLibrary`. Kept for any remaining decorative/pig-specific uses; it is not
 * the live entity body. Builds a parts pig from BoxGeometry cubes and returns a
 * {@link PigBuild} (root group + per-instance materials/geometries to dispose).
 */

const PINK = new THREE.Color("#efa3a3");
const PINK_DARK = new THREE.Color("#c46d6f");
const PINK_DEEP = new THREE.Color("#a25154");
const SNOUT = new THREE.Color("#b65f63");
const NOSTRIL = new THREE.Color("#3a1a1c");
const EYE_WHITE = new THREE.Color("#f8f0e8");
const EYE_PUPIL = new THREE.Color("#0a0a10");

export interface PigBuild {
  /** Root group to add to the scene. Contains body + head + legs + tail. */
  root: THREE.Group;
  /** Every material that should react to hit-flash / death tinting. */
  materials: THREE.MeshLambertMaterial[];
  /** All geometries owned by this pig (for dispose). */
  geometries: THREE.BufferGeometry[];
  /** Reference height of the visible pig (top of head -> bottom of legs). */
  totalHeight: number;
  /** Y offset from root.position to the body center (used for camera/HUD). */
  bodyCenterY: number;
}

interface BodyBuilder {
  geos: THREE.BufferGeometry[];
  mats: THREE.MeshLambertMaterial[];
}

function addCube(
  parent: THREE.Object3D,
  ctx: BodyBuilder,
  size: [number, number, number],
  pos: [number, number, number],
  color: THREE.Color,
  opts: { skin?: boolean } = {},
): THREE.Mesh {
  const geo = new THREE.BoxGeometry(size[0], size[1], size[2]);
  const mat = new THREE.MeshLambertMaterial({
    color: color.clone(),
    transparent: true,
  });
  ctx.geos.push(geo);
  // Only "skin" cubes (the pink body parts) follow hit-flash/death tinting.
  if (opts.skin) ctx.mats.push(mat);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(pos[0], pos[1], pos[2]);
  parent.add(mesh);
  return mesh;
}

/**
 * Builds a Minecraft-style voxel pig.
 *
 * Coordinate system: pig faces +Z (forward), Y is up. The root group is the
 * "feet anchor" -- root.position.y should be set to the ground Y, and the pig
 * geometry sits entirely above it.
 *
 * Layout (units):
 *   leg height = 0.18
 *   body: 0.5 wide x 0.32 tall x 0.7 deep
 *   head: 0.34 wide x 0.34 tall x 0.34 deep (front of body)
 *   tail: 0.08^3 cube at back top
 */
export function buildPig(): PigBuild {
  const root = new THREE.Group();
  const ctx: BodyBuilder = { geos: [], mats: [] };

  const LEG_H = 0.18;
  const BODY_W = 0.5;
  const BODY_H = 0.32;
  const BODY_D = 0.7;
  const HEAD = 0.34;

  // Body center sits leg height + half body height
  const bodyCenterY = LEG_H + BODY_H / 2;

  // Main body (pink)
  addCube(
    root,
    ctx,
    [BODY_W, BODY_H, BODY_D],
    [0, bodyCenterY, 0],
    PINK,
    { skin: true },
  );

  // Head (in FRONT = +Z, sticking out past the body)
  const headCenterZ = BODY_D / 2 + HEAD / 2 - 0.02; // slight overlap
  const headCenterY = LEG_H + BODY_H * 0.6 + HEAD / 2 - 0.02;
  const headGroup = new THREE.Group();
  headGroup.position.set(0, headCenterY, headCenterZ);
  root.add(headGroup);

  // Head cube
  addCube(headGroup, ctx, [HEAD, HEAD, HEAD], [0, 0, 0], PINK, { skin: true });

  // Snout: small cube on the front face of the head (smaller than head)
  const SN_W = 0.16;
  const SN_H = 0.12;
  const SN_D = 0.08;
  addCube(
    headGroup,
    ctx,
    [SN_W, SN_H, SN_D],
    [0, -HEAD * 0.12, HEAD / 2 + SN_D / 2 - 0.002],
    SNOUT,
    { skin: true },
  );
  // Two nostril pits on the snout
  const N = 0.025;
  addCube(
    headGroup,
    ctx,
    [N, N, 0.01],
    [-SN_W * 0.25, -HEAD * 0.12, HEAD / 2 + SN_D + 0.001],
    NOSTRIL,
  );
  addCube(
    headGroup,
    ctx,
    [N, N, 0.01],
    [SN_W * 0.25, -HEAD * 0.12, HEAD / 2 + SN_D + 0.001],
    NOSTRIL,
  );

  // Eyes: two cubes embedded on the front face, above the snout
  const EYE = 0.05;
  const EYE_OFF_X = HEAD * 0.28;
  const EYE_Y = HEAD * 0.15;
  const EYE_Z = HEAD / 2 + 0.002;
  // White part
  addCube(
    headGroup,
    ctx,
    [EYE * 1.4, EYE, 0.01],
    [-EYE_OFF_X, EYE_Y, EYE_Z],
    EYE_WHITE,
  );
  addCube(
    headGroup,
    ctx,
    [EYE * 1.4, EYE, 0.01],
    [EYE_OFF_X, EYE_Y, EYE_Z],
    EYE_WHITE,
  );
  // Pupil
  addCube(
    headGroup,
    ctx,
    [EYE * 0.6, EYE * 0.8, 0.012],
    [-EYE_OFF_X + EYE * 0.2, EYE_Y, EYE_Z + 0.001],
    EYE_PUPIL,
  );
  addCube(
    headGroup,
    ctx,
    [EYE * 0.6, EYE * 0.8, 0.012],
    [EYE_OFF_X - EYE * 0.2, EYE_Y, EYE_Z + 0.001],
    EYE_PUPIL,
  );

  // Ears: two darker pink cubes on top of the head
  const EAR = 0.08;
  addCube(
    headGroup,
    ctx,
    [EAR, EAR * 0.5, EAR * 0.6],
    [-HEAD * 0.28, HEAD / 2 + EAR * 0.25, 0],
    PINK_DARK,
    { skin: true },
  );
  addCube(
    headGroup,
    ctx,
    [EAR, EAR * 0.5, EAR * 0.6],
    [HEAD * 0.28, HEAD / 2 + EAR * 0.25, 0],
    PINK_DARK,
    { skin: true },
  );

  // Legs: 4 short legs under the body, slightly darker pink belly tone
  const LEG_W = 0.12;
  const legY = LEG_H / 2;
  const legX = BODY_W / 2 - LEG_W / 2 - 0.01;
  const legZF = BODY_D / 2 - LEG_W / 2 - 0.04;
  const legZB = -BODY_D / 2 + LEG_W / 2 + 0.04;
  addCube(root, ctx, [LEG_W, LEG_H, LEG_W], [-legX, legY, legZF], PINK_DARK, { skin: true });
  addCube(root, ctx, [LEG_W, LEG_H, LEG_W], [legX, legY, legZF], PINK_DARK, { skin: true });
  addCube(root, ctx, [LEG_W, LEG_H, LEG_W], [-legX, legY, legZB], PINK_DARK, { skin: true });
  addCube(root, ctx, [LEG_W, LEG_H, LEG_W], [legX, legY, legZB], PINK_DARK, { skin: true });

  // Tail: tiny cube at the back top, slightly darker pink
  addCube(
    root,
    ctx,
    [0.06, 0.06, 0.06],
    [0, LEG_H + BODY_H * 0.85, -BODY_D / 2 - 0.03],
    PINK_DEEP,
    { skin: true },
  );

  // Total visible height: from y=0 (feet) up to head top
  const totalHeight = headCenterY + HEAD / 2;

  return {
    root,
    materials: ctx.mats,
    geometries: ctx.geos,
    totalHeight,
    bodyCenterY,
  };
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

  ctx.font = "bold 40px 'Courier New', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.lineWidth = 8;
  ctx.strokeStyle = "#1a0a0a";
  ctx.strokeText(text, cnv.width / 2, cnv.height / 2);

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
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.4, 0.35, 1);
  sprite.renderOrder = 999;
  return sprite;
}

/**
 * The player's little pistol: a Group ready to drop into the aim rig (the exact
 * geometry the in-game Player uses) plus the barrel-tip anchor (muzzle / bullet
 * origin). Shared so the character-select preview shows EXACTLY the in-game gun.
 */
export function buildGun(): { group: THREE.Group; barrelTip: THREE.Object3D } {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({
    color: new THREE.Color("#1a1a2e"),
    emissive: new THREE.Color("#0a0a18"),
    emissiveIntensity: 0.4,
  });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.12), mat);
  group.add(body);

  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.07, 0.07), mat);
  barrel.position.set(0.16, 0.02, 0);
  group.add(barrel);

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.14, 0.09), mat);
  grip.position.set(-0.05, -0.12, 0);
  group.add(grip);

  const barrelTip = new THREE.Object3D();
  barrelTip.position.set(0.28, 0.02, 0);
  group.add(barrelTip);

  return { group, barrelTip };
}
