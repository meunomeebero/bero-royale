import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Cel-shading INVERTED-HULL outline — the black cartoon contour around entities.
 *
 * For each mesh we add a sibling "shell": the same surface, rendered as solid
 * black BACK faces pushed outward along the (smoothed) normal in VIEW space.
 * Where the shell pokes past the real mesh's silhouette it shows as a crisp
 * black rim; everywhere else the real mesh covers it. This is resolution- and
 * camera-independent (works with the orthographic camera, unlike post-process
 * depth-edge detection which barely fires on this scene).
 *
 * ONE shared material drives every shell, so its `thickness` uniform retunes all
 * outlines at once (the Settings slider). At thickness 0 the fragment discards —
 * no rim, no z-fighting, effectively off. The material is a module singleton and
 * is NEVER disposed; entity dispose paths must skip shells (userData.isOutline).
 */

/**
 * Outline thickness in WORLD units (orthographic → constant screen px), merged
 * with the built-in fog uniforms (fogColor/fogNear/fogFar) — a ShaderMaterial
 * with `fog: true` must carry them itself or the renderer throws refreshing them.
 */
const uniforms = THREE.UniformsUtils.merge([
  THREE.UniformsLib.fog,
  { thickness: { value: 0 } },
]);

const outlineMaterial = new THREE.ShaderMaterial({
  uniforms,
  side: THREE.BackSide,
  fog: true, // fade the rim into scene.fog like the bodies (chunks below)
  vertexShader: /* glsl */ `
    uniform float thickness;
    #include <fog_pars_vertex>
    void main() {
      // Works for plain meshes (entities/props) AND InstancedMesh (terrain): the
      // #ifdef applies the per-instance matrix so terrain shells don't collapse
      // to one tile. View-space normal expansion → constant world-space (≈ screen)
      // thickness regardless of each model's / instance's scale.
      vec3 objectNormal = normal;
      vec4 mvPosition = vec4(position, 1.0);
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
        objectNormal = mat3(instanceMatrix) * objectNormal;
      #endif
      mvPosition = modelViewMatrix * mvPosition;
      vec3 vn = normalize(normalMatrix * objectNormal);
      mvPosition.xyz += vn * thickness;
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float thickness;
    #include <fog_pars_fragment>
    void main() {
      if (thickness <= 0.0) discard; // off → no rim, no z-fight
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      #include <fog_fragment>
    }
  `,
});

/**
 * Per source geometry: a position-only, vertex-welded copy with SMOOTH normals.
 * Voxel models ship hard per-face normals; expanding along those would split the
 * shell into separated faces (gaps). Welding by position + computeVertexNormals
 * gives averaged normals that inflate the hull cleanly. Cached + never disposed
 * (the dispose paths only free materials, never geometry).
 */
const smoothCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

function smoothedGeometry(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const cached = smoothCache.get(src);
  if (cached) return cached;
  const pos = src.getAttribute("position");
  let g = new THREE.BufferGeometry();
  g.setAttribute("position", pos.clone());
  if (src.index) g.setIndex(src.index.clone());
  g = mergeVertices(g); // weld coincident positions (only attr is position)
  g.computeVertexNormals();
  smoothCache.set(src, g);
  return g;
}

/**
 * Add a black inverted-hull outline shell behind every mesh in `object`.
 * Call AFTER materials are set up. Shells share the singleton material (live
 * thickness control) and a cached smoothed geometry; they are tagged
 * `userData.isOutline` so dispose paths skip the shared material.
 */
export function addOutline(object: THREE.Object3D): void {
  const meshes: THREE.Mesh[] = [];
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh && !mesh.userData.isOutline) meshes.push(mesh);
  });
  for (const mesh of meshes) {
    const shell = new THREE.Mesh(smoothedGeometry(mesh.geometry), outlineMaterial);
    shell.userData.isOutline = true;
    shell.frustumCulled = mesh.frustumCulled;
    shell.castShadow = false;
    shell.receiveShadow = false;
    shell.renderOrder = mesh.renderOrder - 1; // draw before the real mesh
    mesh.add(shell);
  }
}

/**
 * Build a parallel outline shell for an InstancedMesh (the terrain blocks): a
 * second InstancedMesh sharing the source's instance matrices, but with the
 * smoothed geometry + the singleton black shell material. Add the returned mesh
 * to the same parent. Tagged `userData.isOutline` like the per-mesh shells.
 */
export function makeInstancedOutline(
  source: THREE.InstancedMesh,
): THREE.InstancedMesh {
  const shell = new THREE.InstancedMesh(
    smoothedGeometry(source.geometry),
    outlineMaterial,
    source.count,
  );
  shell.instanceMatrix.array.set(source.instanceMatrix.array);
  shell.instanceMatrix.needsUpdate = true;
  shell.userData.isOutline = true;
  shell.frustumCulled = source.frustumCulled;
  shell.castShadow = false;
  shell.receiveShadow = false;
  shell.renderOrder = source.renderOrder - 1;
  return shell;
}

/** Live cartoon-outline thickness in world units (0 = off). */
export function setOutlineThickness(worldThickness: number): void {
  uniforms.thickness.value = Math.max(0, worldThickness);
}
