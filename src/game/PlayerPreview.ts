import * as THREE from "three";
import { Avatar, AVATAR_HEIGHT } from "./Avatar";
import { buildGun, buildNameLabel } from "./PigParts";

/**
 * A small live preview of the local player EXACTLY as they appear in-game: the
 * chosen voxel animal + the same little pistol, with a floating name tag above
 * the head and a gentle idle (bob + sway), on a transparent canvas. Built to
 * later double as a customization viewer (weapons, characters, user tag).
 *
 * Requires ModelLibrary.preload() to have resolved before construction.
 */

// Same hero 3/4 angle the roster uses (Avatar faces +Z, the camera).
const AIM_YAW = Math.PI / 2 - 0.42;
// Small name tag tucked just above the head.
const LABEL_SCALE = 0.5;
const LABEL_Y = 0.52;
// Turntable spin speed (rad/s) so the gun is visible from every side.
const SPIN_SPEED = 0.7;

export class PlayerPreview {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private root: THREE.Group; // bob + sway happen here
  private charGroup: THREE.Group;
  private aimGroup: THREE.Group;
  private gun: THREE.Group;
  private avatar: Avatar;
  private label: THREE.Sprite;
  private clock = new THREE.Clock();
  private rafId = 0;
  private resizeObs: ResizeObserver;

  constructor(container: HTMLElement, animal: string, name: string) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearAlpha(0);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
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
    this.camera.position.set(0, 0.9, 8);
    this.camera.lookAt(0, 0.12, 0);

    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.charGroup = new THREE.Group();
    this.root.add(this.charGroup);

    // The aim rig holds the gun at the in-game offset and rotates with aim.
    this.aimGroup = new THREE.Group();
    this.aimGroup.rotation.y = -AIM_YAW;
    const { group: gun } = buildGun();
    this.gun = gun;
    this.gun.position.set(0.12, 0, -0.3);
    this.aimGroup.add(this.gun);
    this.charGroup.add(this.aimGroup);

    this.avatar = new Avatar(animal, AVATAR_HEIGHT, -AVATAR_HEIGHT / 2);
    this.avatar.faceYaw(AIM_YAW);
    this.charGroup.add(this.avatar.group);

    this.label = buildNameLabel(name || "Você");
    this.styleLabel();
    this.root.add(this.label);

    this.layout();
    this.resizeObs = new ResizeObserver(() => this.layout());
    this.resizeObs.observe(container);
  }

  private layout() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const aspect = w / h;
    // Fit the body + the name tag above it with a little margin.
    const halfH = 0.82;
    const halfW = 0.8;
    const viewH = Math.max(halfH, halfW / aspect);
    const viewW = viewH * aspect;
    this.camera.left = -viewW;
    this.camera.right = viewW;
    this.camera.top = viewH;
    this.camera.bottom = -viewH;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  /** Swap the previewed animal (keeps the gun + name tag). */
  setAnimal(animal: string) {
    if (animal === this.avatar.animalName) return;
    this.charGroup.remove(this.avatar.group);
    this.avatar.dispose();
    this.avatar = new Avatar(animal, AVATAR_HEIGHT, -AVATAR_HEIGHT / 2);
    this.avatar.faceYaw(AIM_YAW);
    this.charGroup.add(this.avatar.group);
  }

  /** Update the floating name tag. */
  setName(name: string) {
    this.root.remove(this.label);
    this.disposeLabel();
    this.label = buildNameLabel(name || "Você");
    this.styleLabel();
    this.root.add(this.label);
  }

  /** Small tag tucked just above the head. */
  private styleLabel() {
    this.label.scale.set(1.4 * LABEL_SCALE, 0.35 * LABEL_SCALE, 1);
    this.label.position.set(0, LABEL_Y, 0);
  }

  private disposeLabel() {
    const mat = this.label.material as THREE.SpriteMaterial;
    mat.map?.dispose();
    mat.dispose();
  }

  start() {
    if (this.rafId) return;
    const loop = () => {
      this.rafId = requestAnimationFrame(loop);
      const t = this.clock.getElapsedTime();
      this.charGroup.position.y = Math.sin(t * 1.5) * 0.025; // breathing bob
      this.charGroup.rotation.y = t * SPIN_SPEED; // 360° turntable (shows the gun)
      this.renderer.render(this.scene, this.camera);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  dispose() {
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.resizeObs.disconnect();
    this.avatar.dispose();
    this.gun.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) {
        const mm = m.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mm)) mm.forEach((x) => x.dispose());
        else mm.dispose();
      }
    });
    this.disposeLabel();
    this.renderer.dispose();
    const el = this.renderer.domElement;
    if (el.parentElement === this.container) this.container.removeChild(el);
  }
}
