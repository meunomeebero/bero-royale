import * as THREE from "three";
import { Platform } from "./Platform";
import { Player } from "./Player";
import { InputManager } from "./InputManager";
import { AudioManager } from "./AudioManager";
import { DustParticles } from "./DustParticles";
import { Bullets } from "./Bullets";

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;

  private input: InputManager;
  private audio: AudioManager;
  private dust: DustParticles;
  private bullets: Bullets;
  private platform: Platform;
  private player: Player;

  private clock = new THREE.Clock();
  private rafId = 0;
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setClearColor(new THREE.Color("#060610"), 1);
    container.appendChild(this.renderer.domElement);

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#060610");
    this.scene.fog = new THREE.FogExp2(new THREE.Color("#060610"), 0.04);

    // Isometric camera (smaller view because blocks are smaller)
    const aspect = container.clientWidth / container.clientHeight;
    const viewSize = 4;
    this.camera = new THREE.OrthographicCamera(
      -viewSize * aspect,
      viewSize * aspect,
      viewSize,
      -viewSize,
      0.1,
      100,
    );
    this.camera.position.set(8, 8, 8);
    this.camera.lookAt(0, 0, 0);

    // Lights
    const ambient = new THREE.AmbientLight(new THREE.Color("#1a1a4e"), 0.7);
    this.scene.add(ambient);

    const dir = new THREE.DirectionalLight(new THREE.Color("#6644ff"), 1.2);
    dir.position.set(8, 14, 6);
    this.scene.add(dir);

    const glow = new THREE.PointLight(new THREE.Color("#8800ff"), 0.6, 14);
    glow.position.set(0, -2, 0);
    this.scene.add(glow);

    // Game objects
    this.audio = new AudioManager();
    this.input = new InputManager();
    this.dust = new DustParticles();
    this.bullets = new Bullets();
    this.platform = new Platform();
    this.player = new Player(
      this.platform,
      this.input,
      this.audio,
      this.dust,
      this.bullets,
    );

    this.scene.add(this.platform.group);
    this.scene.add(this.dust.group);
    this.scene.add(this.bullets.group);
    this.scene.add(this.player.root);

    window.addEventListener("resize", this.onResize);
  }

  /** Exposed so HUD can do mouse->world raycasting if needed. */
  getCamera() {
    return this.camera;
  }

  private onResize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const aspect = w / h;
    const viewSize = 4;
    this.camera.left = -viewSize * aspect;
    this.camera.right = viewSize * aspect;
    this.camera.top = viewSize;
    this.camera.bottom = -viewSize;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  start() {
    this.clock.start();
    const loop = () => {
      const dt = Math.min(this.clock.getDelta(), 1 / 30);
      this.player.update(dt, this.camera);
      this.dust.update(dt);
      this.bullets.update(dt);
      this.renderer.render(this.scene, this.camera);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  dispose() {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener("resize", this.onResize);
    this.input.dispose();
    this.audio.dispose();
    this.dust.dispose();
    this.bullets.dispose();
    this.player.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
