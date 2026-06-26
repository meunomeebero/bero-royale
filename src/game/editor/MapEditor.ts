import * as THREE from "three";
import { buildWorld } from "../map/buildWorld";
import { ModelLibrary } from "../ModelLibrary";
import type { Platform } from "../Platform";
import { Decor } from "../Decor";
import type { DecorEntry, EnvProp } from "../map/MapDefinition";

/**
 * Top-down map editor engine (NOT the full game): renderer + scene + lights +
 * `buildWorld` + a fixed overhead Orthographic camera, plus the place/delete/
 * pan/zoom/ghost/hover plumbing. No Player, bots, bullets or netcode.
 *
 * Picking is deliberately CHEAP and prop-agnostic: a single invisible ground
 * plane is the only raycast target, so the hovered cell is the inverse of
 * `Platform.cellCenter` regardless of how many props are placed. Props are never
 * raycast — placement/deletion is purely cell-driven.
 *
 * Undo/redo is full-snapshot (the grid is tiny): every mutation pushes the prior
 * `decor.serialize()` onto the undo stack and clears redo; undo/redo rebuild
 * `Decor` from a snapshot.
 */

/** A fixed seed so the editor terrain always matches the live game's default. */
const EDITOR_SEED = 12345;

/** Half-extent (world units) the camera frustum should cover at zoom 1. The
 *  arena is ±45, so ~50 leaves a small margin all around. */
const VIEW_HALF = 50;

/** Pan clamp: keep the camera target inside the arena so you can't lose it. */
const PAN_LIMIT = 45;

const ZOOM_MIN = 1.0;
const ZOOM_MAX = 8.0;

/** Invisible picking plane size (covers the whole ±45 arena with margin). */
const PICK_PLANE = 90;

/** Hover-plane tints. */
const COLOR_HOVER = 0xffe14d; // neutral yellow
const COLOR_VALID = 0x4ade80; // green — action would succeed
const COLOR_INVALID = 0xef4444; // red — action would fail

export type EditorTool = "place" | "delete";

export interface EditorStatus {
  /** Hovered cell, or null when the pointer is off the ground plane. */
  cell: { ix: number; iz: number } | null;
  /** Whether the current tool's action at `cell` would succeed. */
  valid: boolean;
}

export class MapEditor {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.OrthographicCamera;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();

  private platform!: Platform;
  private decor!: Decor;

  /** Invisible ground used as the ONLY raycast target. */
  private pickPlane!: THREE.Mesh;
  /** 1×1 tile drawn at the hovered cell (tinted hover/valid/invalid). */
  private hoverPlane!: THREE.Mesh;
  private hoverMat!: THREE.MeshBasicMaterial;
  /** Translucent preview of the selected prop at the hovered cell (place mode). */
  private ghost: THREE.Object3D | null = null;
  private ghostAsset: EnvProp | null = null;

  private tool: EditorTool = "place";
  private selected: EnvProp;

  /** Current hovered cell (null = pointer off the plane). */
  private hovered: { ix: number; iz: number } | null = null;

  private rafId = 0;
  private disposed = false;

  // Right-drag pan bookkeeping.
  private panning = false;
  private lastPointer = { x: 0, y: 0 };
  /** Camera look target (and position XZ) — the point the overhead cam sits over. */
  private target = new THREE.Vector3(0, 0, 0);
  private zoom = 1.6;

  // Brief green flash on a successful action (so placement never feels dead).
  private flashUntil = 0;

  private onStatus?: (s: EditorStatus) => void;

  /** Snapshot stacks (full `serialize()` copies). */
  private undoStack: DecorEntry[][] = [];
  private redoStack: DecorEntry[][] = [];

  constructor(container: HTMLElement, initialAsset: EnvProp, initialDecor: DecorEntry[]) {
    this.container = container;
    this.selected = initialAsset;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setClearColor(new THREE.Color("#bfe3ff"), 1);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#bfe3ff");

    // Flat top-down lighting — NEUTRAL/white on purpose (unlike the game's stylized
    // pink atmosphere): from a pure overhead view a tinted sky washes every top face,
    // so the editor uses white light to show props in their TRUE colors (green grass,
    // colorful trees) — you're designing, you need to tell props apart at a glance.
    this.scene.add(new THREE.AmbientLight(new THREE.Color("#ffffff"), 1.6));
    const sun = new THREE.DirectionalLight(new THREE.Color("#ffffff"), 1.0);
    sun.position.set(4, 20, 6);
    this.scene.add(sun);
    this.scene.add(
      new THREE.HemisphereLight(new THREE.Color("#ffffff"), new THREE.Color("#cccccc"), 0.5),
    );

    // Pure overhead orthographic camera (no tilt): straight down the −Y axis.
    const aspect = container.clientWidth / container.clientHeight;
    this.camera = new THREE.OrthographicCamera(
      -VIEW_HALF * aspect,
      VIEW_HALF * aspect,
      VIEW_HALF,
      -VIEW_HALF,
      0.1,
      500,
    );
    this.applyCamera();

    // World (terrain + authored decor). `buildWorld` adds both groups to scene.
    const built = buildWorld(this.scene, { seed: EDITOR_SEED, decor: initialDecor });
    this.platform = built.platform;
    this.decor = built.decor;

    this.buildPickPlane();
    this.buildHoverPlane();
    this.rebuildGhost();

    window.addEventListener("resize", this.onResize);
    const el = this.renderer.domElement;
    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("pointerleave", this.onPointerLeave);
    el.addEventListener("wheel", this.onWheel, { passive: false });
    el.addEventListener("contextmenu", this.onContextMenu);

    this.loop();
  }

  // ---- Public API (driven by React) -------------------------------------

  setStatusListener(fn: ((s: EditorStatus) => void) | undefined) {
    this.onStatus = fn;
  }

  setTool(tool: EditorTool) {
    if (tool === this.tool) return;
    this.tool = tool;
    this.updateGhostVisibility();
    this.refreshHover();
    this.emitStatus();
  }

  getTool(): EditorTool {
    return this.tool;
  }

  setSelected(asset: EnvProp) {
    if (asset === this.selected) return;
    this.selected = asset;
    this.rebuildGhost();
    this.refreshHover();
    this.emitStatus();
  }

  /** Snapshot the live layout for the Save request. */
  serialize(): DecorEntry[] {
    return this.decor.serialize();
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo() {
    if (this.undoStack.length === 0) return;
    const prev = this.undoStack.pop()!;
    this.redoStack.push(this.decor.serialize());
    this.rebuildDecor(prev);
  }

  redo() {
    if (this.redoStack.length === 0) return;
    const next = this.redoStack.pop()!;
    this.undoStack.push(this.decor.serialize());
    this.rebuildDecor(next);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    window.removeEventListener("resize", this.onResize);
    const el = this.renderer.domElement;
    el.removeEventListener("pointermove", this.onPointerMove);
    el.removeEventListener("pointerdown", this.onPointerDown);
    el.removeEventListener("pointerup", this.onPointerUp);
    el.removeEventListener("pointerleave", this.onPointerLeave);
    el.removeEventListener("wheel", this.onWheel);
    el.removeEventListener("contextmenu", this.onContextMenu);
    this.decor.dispose();
    this.hoverPlane.geometry.dispose();
    this.hoverMat.dispose();
    this.pickPlane.geometry.dispose();
    (this.pickPlane.material as THREE.Material).dispose();
    this.disposeGhost();
    this.renderer.dispose();
    if (el.parentElement === this.container) this.container.removeChild(el);
  }

  // ---- Camera -----------------------------------------------------------

  private applyCamera() {
    // Sit directly above the target, look straight down (−Y). +Z maps to screen
    // "down" via an up-vector of −Z, so the overhead view is a stable map.
    this.camera.position.set(this.target.x, 200, this.target.z);
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(this.target.x, 0, this.target.z);
    this.camera.zoom = this.zoom;
    this.camera.updateProjectionMatrix();
  }

  private onResize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const aspect = w / h;
    this.camera.left = -VIEW_HALF * aspect;
    this.camera.right = VIEW_HALF * aspect;
    this.camera.top = VIEW_HALF;
    this.camera.bottom = -VIEW_HALF;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  // ---- Pointer / picking ------------------------------------------------

  private buildPickPlane() {
    const geo = new THREE.PlaneGeometry(PICK_PLANE, PICK_PLANE);
    // Lie flat on the ground (XZ) just above the surface; invisible but raycastable.
    const mat = new THREE.MeshBasicMaterial({ visible: false });
    this.pickPlane = new THREE.Mesh(geo, mat);
    this.pickPlane.rotation.x = -Math.PI / 2;
    this.pickPlane.position.y = this.platform.topY + 0.01;
    this.scene.add(this.pickPlane);
  }

  private buildHoverPlane() {
    const geo = new THREE.PlaneGeometry(this.platform.blockSize, this.platform.blockSize);
    this.hoverMat = new THREE.MeshBasicMaterial({
      color: COLOR_HOVER,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });
    this.hoverPlane = new THREE.Mesh(geo, this.hoverMat);
    this.hoverPlane.rotation.x = -Math.PI / 2;
    this.hoverPlane.visible = false;
    this.scene.add(this.hoverPlane);
  }

  /** Convert a pointer event into NDC for the raycaster. */
  private toNdc(e: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  private onPointerMove = (e: PointerEvent) => {
    if (this.panning) {
      this.pan(e.clientX - this.lastPointer.x, e.clientY - this.lastPointer.y);
      this.lastPointer = { x: e.clientX, y: e.clientY };
      return;
    }
    this.toNdc(e);
    this.updateHoverFromNdc();
  };

  private onPointerDown = (e: PointerEvent) => {
    if (e.button === 2) {
      // Right-button → pan.
      this.panning = true;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      this.renderer.domElement.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    // Left-button → place/delete at the hovered cell.
    this.toNdc(e);
    this.updateHoverFromNdc();
    this.act();
  };

  private onPointerUp = (e: PointerEvent) => {
    if (e.button === 2 && this.panning) {
      this.panning = false;
      try {
        this.renderer.domElement.releasePointerCapture(e.pointerId);
      } catch {
        /* pointer already released */
      }
    }
  };

  private onPointerLeave = () => {
    if (this.panning) return;
    this.hovered = null;
    this.hoverPlane.visible = false;
    if (this.ghost) this.ghost.visible = false;
    this.emitStatus();
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    // Wheel up (negative deltaY) zooms IN.
    const factor = Math.exp(-e.deltaY * 0.0015);
    this.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.zoom * factor));
    this.camera.zoom = this.zoom;
    this.camera.updateProjectionMatrix();
  };

  private onContextMenu = (e: Event) => {
    // Right-drag is pan; suppress the browser menu so it doesn't interrupt.
    e.preventDefault();
  };

  /** Move the camera target in world XZ from a screen-space drag delta. */
  private pan(dxScreen: number, dyScreen: number) {
    // World units per screen pixel = frustum height / canvas height / zoom.
    const h = this.container.clientHeight || 1;
    const worldPerPx = (VIEW_HALF * 2) / h / this.zoom;
    // Screen-right (+x) → world −x because we look down with up = −Z; screen-down
    // (+y) → world −z. Drag moves the WORLD under the cursor, so invert.
    this.target.x = clamp(this.target.x - dxScreen * worldPerPx, -PAN_LIMIT, PAN_LIMIT);
    this.target.z = clamp(this.target.z - dyScreen * worldPerPx, -PAN_LIMIT, PAN_LIMIT);
    this.applyCamera();
  }

  /** Raycast the ground plane → hovered cell → refresh ghost/hover/status. */
  private updateHoverFromNdc() {
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hit = this.raycaster.intersectObject(this.pickPlane, false)[0];
    if (!hit) {
      if (this.hovered !== null) {
        this.hovered = null;
        this.refreshHover();
        this.emitStatus();
      }
      return;
    }
    const { ix, iz } = this.platform.cellAtWorld(hit.point.x, hit.point.z);
    if (this.hovered && this.hovered.ix === ix && this.hovered.iz === iz) return;
    this.hovered = { ix, iz };
    this.refreshHover();
    this.emitStatus();
  }

  /** Re-position + re-tint the hover plane and ghost for the current cell/tool. */
  private refreshHover() {
    const cell = this.hovered;
    if (!cell) {
      this.hoverPlane.visible = false;
      if (this.ghost) this.ghost.visible = false;
      return;
    }
    const c = this.platform.cellCenter(cell.ix, cell.iz);
    const y = this.platform.surfaceY(c.x, c.z);
    this.hoverPlane.position.set(c.x, y + 0.02, c.z);
    this.hoverPlane.visible = true;

    const valid = this.actionValid(cell.ix, cell.iz);
    this.hoverMat.color.setHex(valid ? COLOR_VALID : COLOR_INVALID);

    // Ghost (place mode only): preview the selected prop at the cell center.
    if (this.tool === "place" && this.ghost) {
      this.ghost.position.set(c.x, y, c.z);
      this.ghost.visible = true;
    } else if (this.ghost) {
      this.ghost.visible = false;
    }
  }

  /** Would the current tool's action succeed at this cell? (drives green/red). */
  private actionValid(ix: number, iz: number): boolean {
    return this.tool === "place"
      ? this.decor.canPlaceAt(this.selected, ix, iz)
      : this.decor.entryAt(ix, iz) !== undefined;
  }

  // ---- Actions ----------------------------------------------------------

  private act() {
    const cell = this.hovered;
    if (!cell) return;
    if (!this.actionValid(cell.ix, cell.iz)) return;

    // Snapshot BEFORE mutating (undo), and invalidate redo.
    const snapshot = this.decor.serialize();

    let changed = false;
    if (this.tool === "place") {
      changed = this.decor.placeAt(this.selected, cell.ix, cell.iz) !== null;
    } else {
      changed = this.decor.removeAt(cell.ix, cell.iz);
    }
    if (!changed) return;

    this.undoStack.push(snapshot);
    this.redoStack.length = 0;

    // Green flash for instant feedback, then refresh the now-changed cell state.
    this.flashUntil = performance.now() + 100;
    this.refreshHover();
    this.emitStatus();
  }

  // ---- Ghost ------------------------------------------------------------

  private rebuildGhost() {
    if (this.ghostAsset === this.selected && this.ghost) return;
    this.disposeGhost();
    const { object } = ModelLibrary.create("env", this.selected, propHeight(this.selected));
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material;
      const fade = (m: THREE.Material) => {
        m.transparent = true;
        m.opacity = 0.5;
        m.depthWrite = false;
      };
      if (Array.isArray(mat)) mat.forEach(fade);
      else if (mat) fade(mat);
    });
    object.visible = false;
    this.ghost = object;
    this.ghostAsset = this.selected;
    this.scene.add(object);
    this.updateGhostVisibility();
  }

  private updateGhostVisibility() {
    if (this.ghost) this.ghost.visible = this.tool === "place" && this.hovered !== null;
  }

  private disposeGhost() {
    if (!this.ghost) return;
    this.scene.remove(this.ghost);
    this.ghost.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) mat.dispose();
    });
    this.ghost = null;
    this.ghostAsset = null;
  }

  // ---- Undo/redo rebuild ------------------------------------------------

  /** Rebuild `Decor` from a snapshot (used by undo/redo). */
  private rebuildDecor(entries: DecorEntry[]) {
    this.scene.remove(this.decor.group);
    this.decor.dispose();
    this.decor = new Decor(this.platform, entries);
    this.scene.add(this.decor.group);
    this.refreshHover();
    this.emitStatus();
  }

  // ---- Render loop ------------------------------------------------------

  private loop = () => {
    if (this.disposed) return;
    // Apply / clear the success-flash tint.
    if (this.flashUntil > 0) {
      if (performance.now() < this.flashUntil) {
        this.hoverMat.color.setHex(COLOR_VALID);
      } else {
        this.flashUntil = 0;
        if (this.hovered) {
          this.hoverMat.color.setHex(
            this.actionValid(this.hovered.ix, this.hovered.iz) ? COLOR_VALID : COLOR_INVALID,
          );
        }
      }
    }
    this.renderer.render(this.scene, this.camera);
    this.rafId = requestAnimationFrame(this.loop);
  };

  // ---- Status bridge ----------------------------------------------------

  private emitStatus() {
    if (!this.onStatus) return;
    const cell = this.hovered;
    this.onStatus({
      cell: cell ? { ix: cell.ix, iz: cell.iz } : null,
      valid: cell ? this.actionValid(cell.ix, cell.iz) : false,
    });
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Ghost render height per prop — mirrors `Decor`'s `PropSpec.height`. */
function propHeight(asset: EnvProp): number {
  switch (asset) {
    case "tree1":
      return 1.3;
    case "tree2":
      return 1.45;
    case "grassmushroom":
      return 0.55;
    case "grassflower1":
    case "grassflower2":
      return 0.5;
    case "box1":
    case "box2":
      return 0.5;
  }
}
