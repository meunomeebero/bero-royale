import * as THREE from "three";
import { Avatar } from "./Avatar";

/**
 * A self-contained 3D character roster for the pick screen. Renders every
 * selectable voxel animal in a responsive grid on a TRANSPARENT canvas (so the
 * blurred live scene shows through), each with a gentle idle bob + sway and a
 * lift/scale on hover. SELECTION is shown by colour: the selected (and any
 * hovered) character is full-colour while every other one desaturates to black
 * & white. Click to select. Pure Three.js, no React.
 *
 * Requires ModelLibrary.preload() to have resolved before construction.
 */

const FACE_CAMERA_YAW = Math.PI / 2; // makes an Avatar look toward +Z (the camera)
const CELL_H = 1.0; // avatar height in world units

interface Cell {
  root: THREE.Group; // holds the avatar; we lift/scale this
  avatar: Avatar;
  index: number;
  animal: string;
  baseYaw: number;
  phase: number;
  rowCenterY: number;
  // animated state (lerped each frame)
  scale: number;
  lift: number;
}

export class CharacterStage {
  onSelect?: (animal: string) => void;
  onHover?: (animal: string | null) => void;

  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private cells: Cell[] = [];
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2(-10, -10);
  private hovered = -1;
  private selected = -1;
  private clock = new THREE.Clock();
  private rafId = 0;
  private resizeObs: ResizeObserver;
  private dx = 1.55;
  private dy = 1.95;

  constructor(container: HTMLElement, animals: string[]) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearAlpha(0);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();

    // Bright candy lighting (mirrors Game) so the voxel colours pop, front-lit so
    // the animals' faces read toward the camera.
    this.scene.add(new THREE.AmbientLight(new THREE.Color("#fff2f8"), 1.7));
    const sun = new THREE.DirectionalLight(new THREE.Color("#fff6ea"), 1.4);
    sun.position.set(5, 14, 12);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(new THREE.Color("#ffd2e8"), 0.55);
    fill.position.set(-6, 6, 6);
    this.scene.add(fill);
    this.scene.add(
      new THREE.HemisphereLight(
        new THREE.Color("#ffe3f2"),
        new THREE.Color("#f0c79a"),
        0.7,
      ),
    );

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    this.camera.position.set(0, 0, 40);
    this.camera.lookAt(0, 0, 0);

    this.buildCells(animals);
    this.layout();

    const el = this.renderer.domElement;
    el.style.touchAction = "none";
    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointerleave", this.onPointerLeave);

    this.resizeObs = new ResizeObserver(() => this.onResize());
    this.resizeObs.observe(container);
  }

  /** Build a cell (avatar + lift/scale group) for every animal. */
  private buildCells(animals: string[]) {
    animals.forEach((animal, index) => {
      const avatar = new Avatar(animal, CELL_H, -CELL_H / 2); // center at root y=0
      avatar.faceYaw(FACE_CAMERA_YAW - 0.42); // 3/4 hero angle toward camera

      const root = new THREE.Group();
      root.userData.cellIndex = index;
      root.add(avatar.group);
      this.scene.add(root);

      this.cells.push({
        root,
        avatar,
        index,
        animal,
        baseYaw: FACE_CAMERA_YAW - 0.42,
        phase: index * 1.7,
        rowCenterY: 0,
        scale: 1,
        lift: 0,
      });
    });
  }

  /**
   * Swap the roster in place (the secret-animal easter-egg reveal). Tears down the
   * current avatars and rebuilds for `animals`, keeping the GL context alive so
   * there's no canvas flicker. Restores the prior selection if it survives.
   */
  setRoster(animals: string[]) {
    const prevSelected = this.getSelected();
    for (const cell of this.cells) {
      this.scene.remove(cell.root);
      cell.avatar.dispose();
    }
    this.cells = [];
    this.hovered = -1;
    this.selected = -1;
    this.buildCells(animals);
    this.layout();
    if (prevSelected) this.setSelected(prevSelected);
  }

  /** Columns chosen from available width (phones get 3 so the grid isn't a
   *  6-row tower; very narrow falls back to 2). */
  private columnsFor(width: number): number {
    if (width >= 900) return 4;
    if (width >= 380) return 3;
    return 2;
  }

  /** (Re)position every cell into a centered grid + frame the ortho camera. */
  private layout() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const total = this.cells.length;
    const cols = this.columnsFor(w);
    const rows = Math.ceil(total / cols);

    for (let i = 0; i < total; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const itemsInRow = Math.min(cols, total - row * cols);
      const startX = -((itemsInRow - 1) / 2) * this.dx;
      const x = startX + col * this.dx;
      const rowCenterY = ((rows - 1) / 2 - row) * this.dy;
      const cell = this.cells[i];
      cell.rowCenterY = rowCenterY;
      cell.root.position.set(x, rowCenterY, 0);
    }

    const halfW = ((cols - 1) / 2) * this.dx + CELL_H * 0.95;
    const halfH = ((rows - 1) / 2) * this.dy + CELL_H * 1.05;
    const aspect = w / h;
    const viewH = Math.max(halfH, halfW / aspect) * 1.12;
    const viewW = viewH * aspect;
    this.camera.left = -viewW;
    this.camera.right = viewW;
    this.camera.top = viewH;
    this.camera.bottom = -viewH;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(w, h);
  }

  private onResize = () => this.layout();

  private updatePointer(e: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private pick(): number {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(
      this.cells.map((c) => c.avatar.group),
      true,
    );
    if (!hits.length) return -1;
    let o: THREE.Object3D | null = hits[0].object;
    while (o) {
      if (o.userData && o.userData.cellIndex !== undefined) {
        return o.userData.cellIndex as number;
      }
      o = o.parent;
    }
    return -1;
  }

  private onPointerMove = (e: PointerEvent) => {
    this.updatePointer(e);
    const idx = this.pick();
    if (idx !== this.hovered) {
      this.hovered = idx;
      this.renderer.domElement.style.cursor = idx >= 0 ? "pointer" : "default";
      this.onHover?.(idx >= 0 ? this.cells[idx].animal : null);
    }
  };

  private onPointerDown = (e: PointerEvent) => {
    this.updatePointer(e);
    const idx = this.pick();
    if (idx >= 0) this.select(idx);
  };

  private onPointerLeave = () => {
    this.pointer.set(-10, -10);
    if (this.hovered !== -1) {
      this.hovered = -1;
      this.renderer.domElement.style.cursor = "default";
      this.onHover?.(null);
    }
  };

  private select(idx: number) {
    if (idx < 0 || idx >= this.cells.length) return;
    this.selected = idx;
    this.onSelect?.(this.cells[idx].animal);
  }

  /** Externally set the selected animal (e.g. restore a saved pick). */
  setSelected(animal: string | null) {
    const idx = animal ? this.cells.findIndex((c) => c.animal === animal) : -1;
    this.selected = idx;
  }

  getSelected(): string | null {
    return this.selected >= 0 ? this.cells[this.selected].animal : null;
  }

  start() {
    if (this.rafId) return;
    const loop = () => {
      this.rafId = requestAnimationFrame(loop);
      this.frame();
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private frame() {
    const t = this.clock.getElapsedTime();
    for (const cell of this.cells) {
      const isHover = cell.index === this.hovered;
      const isSel = cell.index === this.selected;

      // Idle: gentle bob + sway. The Avatar is already vertically centered, so
      // the bob oscillates around the cell origin (0).
      const bob = Math.sin(t * 1.6 + cell.phase) * (isHover ? 0.06 : 0.035);
      cell.avatar.group.position.y = bob;
      const sway = Math.sin(t * 0.9 + cell.phase) * 0.12;
      cell.avatar.faceYaw(cell.baseYaw + sway);

      // Selection signal = SIZE: the selected character is 1.2× the rest.
      // Hover just adds a little hop for feedback. Everyone stays full colour.
      const targetScale = isSel ? 1.2 : 1.0;
      const targetLift = isHover ? 0.08 : 0.0;
      cell.scale += (targetScale - cell.scale) * 0.18;
      cell.lift += (targetLift - cell.lift) * 0.18;

      cell.root.scale.setScalar(cell.scale);
      cell.root.position.y = cell.rowCenterY + cell.lift;
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.resizeObs.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener("pointermove", this.onPointerMove);
    el.removeEventListener("pointerdown", this.onPointerDown);
    el.removeEventListener("pointerleave", this.onPointerLeave);
    for (const cell of this.cells) cell.avatar.dispose();
    this.renderer.dispose();
    if (el.parentElement === this.container) this.container.removeChild(el);
  }
}
