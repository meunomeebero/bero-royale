import * as THREE from "three";
import { Platform } from "./Platform";
import { Player } from "./Player";
import { Bot } from "./Bot";
import { InputManager } from "./InputManager";
import { AudioManager } from "./AudioManager";
import { DustParticles } from "./DustParticles";
import { Bullets } from "./Bullets";

const NUM_BOTS = 3;

// Show the whole map (80 blocks * 0.5 = 40 units across; half-extent ~22 with margin)
const VIEW_SIZE = 22;

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
  private bots: Bot[] = [];

  private clock = new THREE.Clock();
  private rafId = 0;
  private container: HTMLElement;

  private cameraOffset = new THREE.Vector3(20, 20, 20);

  constructor(container: HTMLElement) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setClearColor(new THREE.Color("#060610"), 1);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#060610");
    // Fog disabled — full map visibility for now

    const aspect = container.clientWidth / container.clientHeight;
    this.camera = new THREE.OrthographicCamera(
      -VIEW_SIZE * aspect,
      VIEW_SIZE * aspect,
      VIEW_SIZE,
      -VIEW_SIZE,
      0.1,
      400,
    );

    // Lights
    const ambient = new THREE.AmbientLight(new THREE.Color("#1a1a4e"), 0.7);
    this.scene.add(ambient);
    const dir = new THREE.DirectionalLight(new THREE.Color("#6644ff"), 1.2);
    dir.position.set(8, 14, 6);
    this.scene.add(dir);

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
    this.bullets.registerTarget(this.player);

    for (let i = 0; i < NUM_BOTS; i++) {
      const bot = new Bot(
        `bot_${i}`,
        this.platform,
        this.audio,
        this.dust,
        this.bullets,
      );
      this.bots.push(bot);
      this.scene.add(bot.root);
      this.bullets.registerTarget(bot);
    }

    this.scene.add(this.platform.group);
    this.scene.add(this.dust.group);
    this.scene.add(this.bullets.group);
    this.scene.add(this.player.root);

    // Initial camera position
    this.updateCamera();

    window.addEventListener("resize", this.onResize);
  }

  getPlayer() {
    return this.player;
  }

  private updateCamera() {
    // Static camera centered on the world — full map visible
    this.camera.position.set(60, 60, 60);
    this.camera.lookAt(0, 0, 0);
  }

  private onResize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const aspect = w / h;
    this.camera.left = -VIEW_SIZE * aspect;
    this.camera.right = VIEW_SIZE * aspect;
    this.camera.top = VIEW_SIZE;
    this.camera.bottom = -VIEW_SIZE;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  start() {
    this.clock.start();
    const loop = () => {
      const dt = Math.min(this.clock.getDelta(), 1 / 30);
      this.player.update(dt, this.camera);
      for (const bot of this.bots) bot.update(dt, this.player);
      this.dust.update(dt);
      this.bullets.update(dt);
      this.updateCamera();
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
    for (const bot of this.bots) bot.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
