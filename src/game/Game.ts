import * as THREE from "three";
import { Platform } from "./Platform";
import { Player } from "./Player";
import { Bot } from "./Bot";
import { InputManager } from "./InputManager";
import { AudioManager } from "./AudioManager";
import { DustParticles } from "./DustParticles";
import { Bullets } from "./Bullets";
import { Decor } from "./Decor";
import { SmokePuffs } from "./SmokePuffs";
import { FogPatches } from "./FogPatches";
import { Rain } from "./Rain";
import { GrassPoof } from "./GrassPoof";

const INITIAL_BOTS = 3;
const NEW_BOT_EVERY_SECONDS = 60;

// Closer zoom (matches the original gameplay framing before the night-vision change)
const VIEW_SIZE = 4;

const TOP_SCORE_KEY = "voxelCube.topScore";

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;

  private input: InputManager;
  private audio: AudioManager;
  private dust: DustParticles;
  private bullets: Bullets;
  private smoke: SmokePuffs;
  private fog: FogPatches;
  private rain: Rain;
  private grassPoof: GrassPoof;
  private platform: Platform;
  private player: Player;
  private bots: Bot[] = [];
  private nextBotId = 0;

  private clock = new THREE.Clock();
  private rafId = 0;
  private container: HTMLElement;
  private paused = false;

  private cameraOffset = new THREE.Vector3(20, 20, 20);

  // Survival run state
  private elapsed = 0; // seconds in current run
  private nextBotSpawnAt = NEW_BOT_EVERY_SECONDS;
  private topScore = 0;
  private wasPlayerAliveLastFrame = true;
  private onStatsChange?: (stats: GameStats) => void;

  constructor(container: HTMLElement) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setClearColor(new THREE.Color("#03060f"), 1);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#03060f");
    // Distant fog -- subtle blue night atmosphere (kicks in only far away)
    this.scene.fog = new THREE.Fog(new THREE.Color("#0a1428"), 28, 70);

    const aspect = container.clientWidth / container.clientHeight;
    this.camera = new THREE.OrthographicCamera(
      -VIEW_SIZE * aspect,
      VIEW_SIZE * aspect,
      VIEW_SIZE,
      -VIEW_SIZE,
      0.1,
      400,
    );

    // Night lighting -- brighter so the map is clearly visible, still cool/blueish
    const ambient = new THREE.AmbientLight(new THREE.Color("#7896cc"), 1.4);
    this.scene.add(ambient);
    const moon = new THREE.DirectionalLight(new THREE.Color("#d0deff"), 1.0);
    moon.position.set(8, 14, 6);
    this.scene.add(moon);
    const fill = new THREE.DirectionalLight(new THREE.Color("#8aa0d8"), 0.55);
    fill.position.set(-6, 8, -4);
    this.scene.add(fill);

    // Game objects
    this.audio = new AudioManager();
    this.input = new InputManager();
    this.dust = new DustParticles();
    this.bullets = new Bullets();
    this.smoke = new SmokePuffs();
    this.grassPoof = new GrassPoof();
    this.platform = new Platform();
    this.fog = new FogPatches(this.platform.size / 2);
    this.player = new Player(
      this.platform,
      this.input,
      this.audio,
      this.dust,
      this.bullets,
    );
    this.player.setSmoke(this.smoke);
    this.player.setGrassPoof(this.grassPoof);
    this.bullets.registerTarget(this.player);

    this.scene.add(this.platform.group);
    const decor = new Decor(this.platform);
    this.scene.add(decor.group);
    // Wire up bullet collisions with the world (terrain hills + decor props + bounds)
    this.bullets.setObstacles(decor.obstacles);
    this.bullets.setBounds(this.platform.getBounds());
    this.bullets.setWorldBlocker((x, y, z) => this.platform.blocksAt(x, y, z));
    this.scene.add(this.dust.group);
    this.scene.add(this.bullets.group);
    this.scene.add(this.smoke.group);
    this.scene.add(this.grassPoof.group);
    this.scene.add(this.fog.group);
    this.rain = new Rain(this.platform.size / 2);
    this.scene.add(this.rain.mesh);
    this.scene.add(this.player.root);

    // Load top score
    this.topScore = this.loadTopScore();

    // Initial bots
    for (let i = 0; i < INITIAL_BOTS; i++) this.spawnBot();

    this.updateCamera();
    window.addEventListener("resize", this.onResize);
  }

  private loadTopScore(): number {
    try {
      const raw = localStorage.getItem(TOP_SCORE_KEY);
      if (!raw) return 0;
      const n = Number.parseFloat(raw);
      return Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  }

  private saveTopScore(score: number) {
    try {
      localStorage.setItem(TOP_SCORE_KEY, String(score));
    } catch {
      // ignore quota / unavailable storage
    }
  }

  private spawnBot() {
    const bot = new Bot(
      `bot_${this.nextBotId++}`,
      this.platform,
      this.audio,
      this.dust,
      this.bullets,
    );
    bot.setSmoke(this.smoke);
    this.bots.push(bot);
    this.scene.add(bot.root);
    this.bullets.registerTarget(bot);
  }

  private clearBots() {
    for (const bot of this.bots) {
      this.bullets.unregisterTarget(bot);
      this.scene.remove(bot.root);
      bot.dispose();
    }
    this.bots = [];
  }

  /** Reset run state and spawn a fresh wave of bots. */
  private restartRun() {
    if (this.elapsed > this.topScore) {
      this.topScore = this.elapsed;
      this.saveTopScore(this.topScore);
    }
    this.elapsed = 0;
    this.nextBotSpawnAt = NEW_BOT_EVERY_SECONDS;
    this.clearBots();
    for (let i = 0; i < INITIAL_BOTS; i++) this.spawnBot();
    this.notifyStats();
  }

  setStatsListener(cb?: (stats: GameStats) => void) {
    this.onStatsChange = cb;
    this.notifyStats();
  }

  private notifyStats() {
    if (this.onStatsChange) {
      this.onStatsChange({
        elapsed: this.elapsed,
        topScore: this.topScore,
        botCount: this.bots.length,
        health: this.player.getHealth(),
        maxHealth: this.player.getMaxHealth(),
        isDead: !this.player.isAlive(),
      });
    }
  }

  getPlayer() {
    return this.player;
  }

  private updateCamera() {
    this.camera.position.copy(this.player.root.position).add(this.cameraOffset);
    this.camera.lookAt(this.player.root.position);
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
    let lastNotifySecond = -1;
    let lastHealth = this.player.getHealth();
    let lastDead = !this.player.isAlive();
    let lastBotCount = this.bots.length;
    const loop = () => {
      const dt = this.paused ? 0 : Math.min(this.clock.getDelta(), 1 / 30);
      if (!this.paused) {
        this.player.update(dt, this.camera);
        for (const bot of this.bots) bot.update(dt, this.player);
        this.dust.update(dt);
        this.bullets.update(dt);
        this.smoke.update(dt);
        this.grassPoof.update(dt);
        this.fog.update(dt);
        this.rain.update(dt);

        // Lava hazard collision (player + bots): must be touching the ground
        if (
          this.player.isAlive() &&
          this.player.isGrounded() &&
          this.platform.isLavaAt(
            this.player.root.position.x,
            this.player.root.position.z,
          )
        ) {
          this.player.killByHazard();
        }
        for (const bot of this.bots) {
          if (
            bot.isAlive() &&
            bot.isGrounded() &&
            this.platform.isLavaAt(
              bot.root.position.x,
              bot.root.position.z,
            )
          ) {
            bot.killByHazard();
          }
        }

        this.updateCamera();

        // Survival timer ticks only while the player is alive
        const aliveNow = this.player.isAlive();
        if (aliveNow) {
          this.elapsed += dt;
          // Spawn additional bot every minute
          if (this.elapsed >= this.nextBotSpawnAt) {
            this.spawnBot();
            this.nextBotSpawnAt += NEW_BOT_EVERY_SECONDS;
            this.notifyStats();
          }
        }

        // Detect death edge: alive -> not alive, restart the run (and save top score)
        if (this.wasPlayerAliveLastFrame && !aliveNow) {
          this.restartRun();
        }
        this.wasPlayerAliveLastFrame = aliveNow;

        // Notify on health / dead / bot-count change OR every whole second
        const sec = Math.floor(this.elapsed);
        const hp = this.player.getHealth();
        const dead = !aliveNow;
        const botC = this.bots.length;
        if (
          sec !== lastNotifySecond ||
          hp !== lastHealth ||
          dead !== lastDead ||
          botC !== lastBotCount
        ) {
          lastNotifySecond = sec;
          lastHealth = hp;
          lastDead = dead;
          lastBotCount = botC;
          this.notifyStats();
        }
      } else {
        this.clock.getDelta();
      }
      this.renderer.render(this.scene, this.camera);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  setPaused(value: boolean) {
    this.paused = value;
  }

  isPaused() {
    return this.paused;
  }

  togglePause() {
    this.paused = !this.paused;
    return this.paused;
  }

  dispose() {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener("resize", this.onResize);
    this.input.dispose();
    this.audio.dispose();
    this.dust.dispose();
    this.bullets.dispose();
    this.smoke.dispose();
    this.grassPoof.dispose();
    this.fog.dispose();
    this.rain.dispose();
    this.player.dispose();
    this.clearBots();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}

export interface GameStats {
  elapsed: number;
  topScore: number;
  botCount: number;
  health: number;
  maxHealth: number;
  isDead: boolean;
}
