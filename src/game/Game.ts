import * as THREE from "three";
import { Platform } from "./Platform";
import { Player, type FireMode } from "./Player";
import { Bot } from "./Bot";
import { InputManager } from "./InputManager";
import { AudioEngine } from "./AudioEngine";
import { DustParticles } from "./DustParticles";
import { Bullets } from "./Bullets";
import { Decor } from "./Decor";
import { Butterflies } from "./Butterflies";
import { Gore } from "./Gore";
import { Kamehameha } from "./Kamehameha";
import { PowerUps, POWERUP_KINDS } from "./PowerUps";
import { Crates } from "./Crates";
import { Multiplayer } from "./net/Multiplayer";
import type { ChatEvent } from "./net/Multiplayer";
import type { BulletTarget, BulletOwner } from "./Bullets";
import { VoiceChat } from "./net/VoiceChat";
import { submitScore, fetchTop, type LeaderRow } from "./net/LeaderboardClient";
import { RemotePlayer } from "./RemotePlayer";
import { SmokePuffs } from "./SmokePuffs";
import { FogPatches } from "./FogPatches";
import { Rain } from "./Rain";
import { GrassPoof } from "./GrassPoof";
import { ModelLibrary } from "./ModelLibrary";
import { PostFX } from "./PostFX";
import { isMobileDevice } from "@/lib/useIsMobile";
import { HEARING_RADIUS, NET_TICK_HZ, PIXEL_FILTER_KEY } from "./consts";

const INITIAL_BOTS = 3;
const NEW_BOT_EVERY_SECONDS = 60;

/** Read the persisted "modo desenho" filter flag — defaults ON when never set. */
function pixelFilterEnabled(): boolean {
  try {
    return localStorage.getItem(PIXEL_FILTER_KEY) !== "0";
  } catch {
    return true;
  }
}

// (Online backfill bots are now SERVER-driven — see server/src/ws/bots.ts. The
// client just renders them as remote players via the normal multiplayer path.)

// Closer zoom (matches the original gameplay framing before the night-vision change)
const VIEW_SIZE = 4;

// Camera zoom bounds for the mouse-wheel / two-finger trackpad zoom.
const ZOOM_MIN = 0.55; // zoomed out (see more of the map)
const ZOOM_MAX = 2.6; // zoomed in (close on the character)

const TOP_SCORE_KEY = "voxelCube.topScore";
const VOICE_MODE_KEY = "voxelcube:voice:mode";

/** Number of fighting bots spawned behind the menu in ambient/showcase mode. */
const AMBIENT_BOT_COUNT = 6;
// Boss mega beam does half a normal target's max HP per hit (two hits to kill).
const BOSS_SHOT_DAMAGE = 5;
// Concentrated super damage (3 of a 10-bar → ~4 unshielded hits). Mirrors the
// server SUPER_DAMAGE; online player-vs-player supers are resolved server-side,
// this drives the LOCAL paths (offline bots + local-player victim).
const SUPER_DAMAGE = 3;

// ── Melee staff (hotbar slot 3) — arc hit resolution ──
const MELEE_DAMAGE = 3; // HP per swing
const MELEE_RANGE = 1.6; // staff reach (world units)
const MELEE_ARC_DOT = -0.15; // forward cone: dot(toTarget, aim) >= this (~190°, generous)
const MELEE_KNOCKBACK = 16; // push impulse applied to a hit target

// Subtle screen shake on taking damage
const SHAKE_DURATION = 0.28;
const SHAKE_MAGNITUDE = 0.5;

export type GameMode = "local" | "multiplayer" | "ambient";

/** Voice transmission mode: push-to-talk (hold G) or always-on. */
export type VoiceMode = "ptt" | "open";

export interface GameOptions {
  mode?: GameMode;
  username?: string;
  /** The voxel animal the player picked in the character-select screen. */
  animal?: string;
  /** Ambient mode only: forces the featured showcase avatar's animal. */
  featuredAnimal?: string;
}

/** A single kill-feed entry surfaced to React via the onKillFeed bridge. */
export interface KillFeedEntry {
  id: string;
  killer: string;
  victim: string;
  streak: number;
  /** The victim's kill streak that was ended (drives "interrompeu a chacina"). */
  victimStreak?: number;
  /** epoch ms — lets the HUD age out / sort entries. */
  t: number;
}

export class Game {
  readonly mode: GameMode;
  readonly username: string;

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private skyTexture: THREE.CanvasTexture;
  /** "Modo desenho" post-processing stack — null when the filter is off. */
  private postfx: PostFX | null = null;
  /** Whether the pixel/cartoon filter is currently active (persisted in LS). */
  private pixelFilter = pixelFilterEnabled();

  private input: InputManager;
  private audio: AudioEngine;
  private dust: DustParticles;
  private bullets: Bullets;
  private smoke: SmokePuffs;
  private fog: FogPatches;
  private rain: Rain;
  private grassPoof: GrassPoof;
  private platform: Platform;
  private decor: Decor;
  private butterflies: Butterflies;
  private gore: Gore;
  private player: Player;
  private bots: Bot[] = [];
  private nextBotId = 0;
  /** Ambient/showcase featured avatar (menu background only). */
  private featured: Bot | null = null;
  /** Forced animal for the featured ambient avatar (undefined = random). */
  private readonly featuredAnimal?: string;
  /** The animal the player picked (undefined = random). */
  private readonly chosenAnimal?: string;
  /** Orbit angle for the ambient menu camera. */
  private ambientCamAngle = 0;

  // Multiplayer (only used in "multiplayer" mode)
  private mp: Multiplayer | null = null;
  private voice: VoiceChat | null = null;
  private voiceRing: THREE.Mesh | null = null;
  private lastTalking = false;
  /** Voice transmission mode (persisted). Default "ptt" => muted until G held. */
  private voiceMode: VoiceMode = (() => {
    try {
      return localStorage.getItem(VOICE_MODE_KEY) === "open" ? "open" : "ptt";
    } catch {
      return "ptt";
    }
  })();
  private kame!: Kamehameha;
  /** Floating server-authoritative power-up pickups (multiplayer only). */
  private powerups: PowerUps;
  /** Destructible supply crates (multiplayer only). */
  private crates: Crates;
  private remotePlayers = new Map<string, RemotePlayer>();
  private mpBroadcastAccum = 0;
  /** True while the tab is backgrounded (rAF throttled to ~1Hz). Gates the
   *  network pose broadcast so we stop relaying frozen/stale poses that every
   *  other client would dead-reckon then hard-snap. Local simulation/prediction
   *  is NEVER paused by this. */
  private docHidden =
    typeof document !== "undefined" && document.visibilityState === "hidden";
  private playerAliveSince = 0;
  private kills = 0;
  /** Consecutive kills since the local player last died (for the kill feed). */
  private killStreak = 0;
  /** Monotonic counter so every kill-feed event gets a UNIQUE id (the feed
   *  dedupes by id; a constant id would collapse/duplicate notifications). */
  private killSeq = 0;
  private bestRuns: LeaderRow[] = [];
  private bestRunsTimer = 0;
  private remoteAlivePrev = new Map<string, boolean>();
  /** Last recvSeq fed into each remote's setState, so the ~60Hz reconcile loop
   *  pushes a snapshot ONLY on a genuinely new "s" packet (restores the full
   *  interp window + kills duplicate snapshot allocs). */
  private remoteRecvSeq = new Map<string, number>();
  private recentHits = new Map<string, number>();
  /** Who last damaged the LOCAL player (name + epoch ms) — drives "X matou você". */
  private lastAttacker: { name: string; t: number } | null = null;
  /** Per-remote dedupe so a death gore burst fires exactly once (event OR fallback). */
  private deadFx = new Set<string>();
  /** Fired once the seed-gated world build is complete (Index drops the overlay). */
  private onReady?: () => void;
  /** True once buildWorld has run (local: synchronously; MP: after the seed). */
  private ready = false;
  /** One-time audio-resume hook armed on the first user gesture. */
  private audioResumeArmed = false;
  /** Index called start() — but in MP we defer the loop until the world is built. */
  private startRequested = false;
  /** Guard so the render loop is only ever kicked off once. */
  private loopStarted = false;

  // Screen shake on damage
  private shakeTime = 0;
  private lastShakeHealth = 0;

  private clock = new THREE.Clock();
  private rafId = 0;
  private container: HTMLElement;
  private paused = false;

  private cameraOffset = new THREE.Vector3(20, 20, 20);
  /** User-controlled zoom from the mouse wheel (composes with the boss factor). */
  private userZoom = 1;

  // Survival run state
  private elapsed = 0; // seconds in current run
  private nextBotSpawnAt = NEW_BOT_EVERY_SECONDS;
  private topScore = 0;
  private wasPlayerAliveLastFrame = true;
  private onStatsChange?: (stats: GameStats) => void;
  /** Inbound chat bridge to React (multiplayer ChatPanel). */
  private onChatMessage?: (e: ChatEvent) => void;
  /** Kill-feed bridge to React (local + relayed remote kills). */
  private onKillFeed?: (e: KillFeedEntry) => void;
  /** Power-up pickup bridge to React (drives the PickupToast). */
  private onPowerupPickup?: (kind: string, label: string) => void;

  constructor(container: HTMLElement, opts: GameOptions = {}) {
    this.container = container;
    this.mode = opts.mode ?? "local";
    this.username = opts.username ?? "Você";
    this.featuredAnimal = opts.featuredAnimal;
    this.chosenAnimal = opts.animal;

    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setClearColor(new THREE.Color("#ffd6ec"), 1);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    // Soft vertical candy-sky gradient (lighter up top, warm pink near horizon).
    this.skyTexture = makeSkyGradient();
    this.scene.background = this.skyTexture;
    // Bright candy daytime haze, pushed far back so the big field stays airy.
    this.scene.fog = new THREE.Fog(new THREE.Color("#ffd0e8"), 50, 115);

    const aspect = container.clientWidth / container.clientHeight;
    this.camera = new THREE.OrthographicCamera(
      -VIEW_SIZE * aspect,
      VIEW_SIZE * aspect,
      VIEW_SIZE,
      -VIEW_SIZE,
      0.1,
      400,
    );

    // Build (or skip) the "modo desenho" post-processing stack to match the
    // persisted toggle. Also pins pixelRatio to 1 while the filter is on so the
    // pixelation reads the same chunky size on retina and non-retina displays.
    this.applyPixelFilter();

    // Bright candy-daytime lighting: warm white sun + soft pink fill so the
    // colorful voxel animals read vividly.
    const ambient = new THREE.AmbientLight(new THREE.Color("#fff2f8"), 1.7);
    this.scene.add(ambient);
    const sun = new THREE.DirectionalLight(new THREE.Color("#fff6ea"), 1.35);
    sun.position.set(8, 16, 6);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(new THREE.Color("#ffd2e8"), 0.5);
    fill.position.set(-6, 8, -4);
    this.scene.add(fill);
    // Hemisphere wrap: pink sky bounce + warm ground bounce for a lively, juicy
    // ambient that makes every voxel color pop.
    const hemi = new THREE.HemisphereLight(
      new THREE.Color("#ffe3f2"),
      new THREE.Color("#f0c79a"),
      0.7,
    );
    this.scene.add(hemi);

    // Seed-independent game objects (created up-front; the seed-dependent world
    // — Platform + Decor + bullet world wiring — is built later in buildWorld()).
    this.audio = new AudioEngine();
    this.input = new InputManager();
    this.dust = new DustParticles();
    this.bullets = new Bullets();
    this.smoke = new SmokePuffs();
    this.grassPoof = new GrassPoof();
    this.gore = new Gore();
    this.kame = new Kamehameha();
    this.kame.setSmoke(this.smoke);
    this.powerups = new PowerUps();
    this.crates = new Crates();
    this.scene.add(this.dust.group);
    this.scene.add(this.bullets.group);
    this.scene.add(this.smoke.group);
    this.scene.add(this.grassPoof.group);
    this.scene.add(this.gore.group);
    this.scene.add(this.kame.group);
    this.scene.add(this.powerups.group);
    this.scene.add(this.crates.group);

    // Load top score
    this.topScore = this.loadTopScore();

    if (this.mode === "ambient") {
      // Showcase/menu background: the REAL game (same scene/lighting/terrain/bots)
      // with no player, input, multiplayer, voice, or HUD stats. Built synchronously
      // so start() can kick the render loop immediately.
      this.buildAmbient();
      this.markReady();
    } else if (this.mode === "multiplayer") {
      // Free-for-all: opponents are remote players, no AI bots. Connect FIRST
      // so the authoritative world seed arrives before we build the terrain —
      // Index keeps its loading overlay up until onReady fires from the seed
      // handler below.
      const id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `p_${Math.floor(Math.random() * 1e9)}`;
      // The local avatar is built later (seed-gated), so seed the broadcast
      // animal with a placeholder now and correct it to the real avatar's animal
      // via mp.setAnimal(player.getAnimal()) once buildWorld runs (below).
      this.mp = new Multiplayer(
        id,
        this.username,
        this.chosenAnimal ?? ModelLibrary.randomAnimalName(),
      );
      // Unified hit handler (items 3 + 5). The shooter reports {t:"hit"} to the
      // server, which is the damage authority (it applies the hit even to AFK /
      // grace-window victims and emits "died"). This callback fires off the
      // legacy broadcast "hit" cue, which the server fans out to every client
      // EXCEPT the shooter:
      //   - target names a REMOTE → flash it white instantly (item 3 observer cue).
      //   - target names the LOCAL player → apply predicted damage for responsive
      //     feedback; the server independently enforces the same so a laggy/AFK
      //     victim still dies authoritatively (item 5).
      this.mp.setHitHandler((targetId, _fromId, fromName) => {
        if (targetId === this.mp?.id) {
          if (this.player.isAlive()) this.player.takeHit(new THREE.Vector3());
          // Remember who shot us for the "X matou você" death feed.
          this.lastAttacker = { name: fromName || "Alguém", t: Date.now() };
        } else {
          this.remotePlayers.get(targetId)?.flashHit();
        }
      });
      // Authoritative HP+shield echo (honest HUD): the server is the single source
      // of truth for our health/shield and pushes the real values here on every
      // change, so the bar reconciles instead of drifting from local prediction.
      // This is what stops "I had full HP + shield and instantly died" — the bar
      // now reflects the damage the server actually applied (e.g. a 3-pt super).
      this.mp.setHpHandler((e) => {
        this.player.setHealthShield(e.health, e.shield);
      });
      this.registerNetHandlers();
      this.mp.connect();
      this.playerAliveSince = Date.now();
      // Proximity push-to-talk voice + the red radius ring around the player.
      this.voice = new VoiceChat(id);
      this.voice.connect();
      // Persisted all-time records: pull once on startup, then poll periodically.
      this.refreshBestRuns();
      this.bestRunsTimer = window.setInterval(() => this.refreshBestRuns(), 20000);
      // Build the world (and the voice ring) only once the seed arrives, then
      // tell Index it's ready and start the render loop.
      this.mp.setSeedHandler((seed) => {
        if (this.platform) return; // guard against a second welcome frame
        this.buildWorld(seed);
        // Correct the broadcast animal to the avatar we actually render, so
        // remotes see the same animal we see locally.
        this.mp?.setAnimal(this.player.getAnimal());
        this.voiceRing = this.makeVoiceRing();
        this.scene.add(this.voiceRing);
        this.markReady();
        if (this.startRequested) this.runLoop();
      });
    } else if (this.mode === "local") {
      // Local survival: deterministic single-player world (seed unchanged so the
      // look is identical to before), then spawn the initial AI bots.
      this.buildWorld(12345);
      for (let i = 0; i < INITIAL_BOTS; i++) this.spawnBot();
      this.markReady();
    }

    window.addEventListener("resize", this.onResize);
    // Gate the network pose broadcast when the tab is backgrounded (rAF
    // throttled): stop relaying frozen poses so observers don't rubber-band.
    // Local simulation is never paused by this.
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    // Mouse wheel + two-finger trackpad scroll zoom the camera in/out. Skipped in
    // ambient (menu) mode so the background never steals the page's scroll.
    if (this.mode !== "ambient") {
      this.renderer.domElement.addEventListener("wheel", this.onWheel, {
        passive: false,
      });
    }
    // Resume the AudioContext on the first real user gesture (remote sounds can
    // fire before the local player ever clicks; without this they stay silent).
    this.armAudioResume();
  }

  /**
   * Build the seed-dependent world: terrain (Platform), decor, the player +
   * platform-sized ambient systems, and the bullet world-collision wiring.
   * Called immediately (seed 12345) in local mode, or once the authoritative
   * room seed arrives in multiplayer mode.
   */
  private buildWorld(seed: number) {
    this.platform = new Platform(seed);
    this.scene.add(this.platform.group);

    this.fog = new FogPatches(this.platform.size / 2);
    this.player = new Player(
      this.platform,
      this.input,
      this.audio,
      this.dust,
      this.bullets,
      this.chosenAnimal,
    );
    this.player.setSmoke(this.smoke);
    this.player.setGrassPoof(this.grassPoof);
    // Respawn far from other players/bots so you don't reappear into a firefight.
    this.player.setSpawnPicker(() => this.pickSafeSpawn());
    this.player.setOnFire((origin, dir, color) => {
      this.mp?.sendShot(
        { x: origin.x, y: origin.y, z: origin.z },
        { x: dir.x, y: dir.y, z: dir.z },
        color,
      );
    });
    // Charged special is available to everyone (hold shoot to wind up).
    // "bero" unlocks the boss easter egg (double-tap Tab).
    this.player.setBossUnlocked(this.username.trim().toLowerCase() === "bero");
    this.player.setOnKame((origin, dir, lethal) => {
      this.kame.fire(origin, dir, true, "player", lethal, "player");
      this.mp?.sendKame(
        { x: origin.x, y: origin.y, z: origin.z },
        { x: dir.x, y: dir.y, z: dir.z },
      );
    });
    this.player.setOnMelee((origin, dir) => this.handleMelee(origin, dir));
    this.kame.onHit = (target, dir, lethal, ownerId) =>
      this.onKameHit(target, dir, lethal, ownerId);
    this.bullets.registerTarget(this.player);
    // Track who damages each fighter (bullets) for kill attribution: the local
    // player ("X matou você") and bots ("fulano matou ciclano" for bot-vs-bot).
    this.bullets.setOnDamage((target, ownerId) => {
      const name = this.nameForOwner(ownerId);
      if (!name) return;
      if (target === this.player) {
        this.lastAttacker = { name, t: Date.now() };
      } else if (target instanceof Bot) {
        target.recordHitBy(name);
      }
    });
    // Register the player as a kame target too so enemy mega beams (e.g. online
    // bots, ownerSide "bot") can hit it. Player-fired beams skip same-side, so
    // this never causes a self-hit.
    this.kame.registerTarget(this.player);
    this.scene.add(this.player.root);

    // Every bullet that ends (life/range/blocker/hit/out-of-bounds) puffs white
    // smoke at its last position — mirrors the smoke look of Player.shoot.
    this.bullets.setOnEnd((x, y, z) => {
      this.smoke.spawnPuff(
        new THREE.Vector3(x, y, z),
        new THREE.Vector3(0, 1, 0),
        5,
        "#ffffff",
      );
    });

    this.decor = new Decor(this.platform, seed);
    this.scene.add(this.decor.group);
    // Wire up bullet collisions with the world (terrain hills + decor props + bounds)
    this.bullets.setObstacles(this.decor.obstacles);
    this.bullets.setBounds(this.platform.getBounds());
    this.bullets.setWorldBlocker((x, y, z) => this.platform.blocksAt(x, y, z));

    // Ambient butterflies fluttering around for life.
    this.butterflies = new Butterflies(this.platform.size / 2);
    this.scene.add(this.butterflies.group);
    // Night rain + blue fog patches are omitted for the bright daytime look,
    // but kept instantiated so the update/dispose lifecycle stays intact.
    this.rain = new Rain(this.platform.size / 2);

    this.lastShakeHealth = this.player.getHealth();
    this.updateCamera();
  }

  /** Register the instant-event + shot handlers on the multiplayer transport. */
  private registerNetHandlers() {
    if (!this.mp) return;
    this.mp.setShotHandler((e) => {
      // Anchor the visual tracer to the receiver-visible remote gun: the shot is
      // sent at the shooter's absolute muzzle, but we render the remote avatar
      // ~INTERP_DELAY_MS in the past, so use that avatar's CURRENT rendered XZ
      // (keeping the fired height) so the tracer leaves the visible gun.
      const rp = this.remotePlayers.get(e.id);
      const ox = rp ? rp.root.position.x : e.origin.x;
      const oz = rp ? rp.root.position.z : e.origin.z;
      const origin = new THREE.Vector3(ox, e.origin.y, oz);
      const dir = new THREE.Vector3(e.dir.x, e.dir.y, e.dir.z);
      this.bullets.spawnVisual(origin, dir, e.color);
      this.audio.playShot(origin, false);
      // Muzzle flash + smoke puff at the remote's rendered muzzle (mirrors
      // Player.shoot which calls spawnFlash + spawnPuff at its own muzzle).
      this.smoke.spawnFlash(origin, dir);
      this.smoke.spawnPuff(origin, dir, 6, "#cccccc");
    });
    this.mp.setDashHandler((e) => {
      this.remotePlayers.get(e.id)?.triggerDash(e.dir);
    });
    this.mp.setJumpHandler((e) => {
      this.remotePlayers.get(e.id)?.triggerJump();
    });
    this.mp.setDiedHandler((e) => {
      // The server says WE died (authoritative). Make our client agree even if we
      // missed some "hit" cues (dropped under throttle) — otherwise we'd keep
      // playing while dead to everyone else. No-op if already dead/falling.
      if (e.id === this.mp?.id) {
        this.player.serverKilled();
        return;
      }
      // Spawn the gore where the opponent is actually RENDERED — the server's
      // last-known x/z can be stale or 0, which would put the burst off-screen
      // (and the death sound far away = silent). Fall back to the event coords.
      const rp = this.remotePlayers.get(e.id);
      const p = rp ? rp.getPosition() : null;
      const px = p ? p.x : e.x;
      const pz = p ? p.z : e.z;
      // If WE landed the kill, hear it at full volume regardless of distance.
      this.spawnDeathFx(e.id, px, pz, e.by === this.mp?.id);
      this.markRemoteDead(e.id, e.x, e.z);
    });
    // Inbound chat → forward to React (ChatPanel) via the onChatMessage bridge.
    this.mp.setChatHandler((e) => {
      this.onChatMessage?.(e);
    });
    // Remote kamehameha cast → render the beam from the remote's rendered muzzle
    // (visual only; the caster's client owns the hit resolution).
    this.mp.setKameHandler((e) => {
      const rp = this.remotePlayers.get(e.id);
      const ox = rp ? rp.root.position.x : e.origin.x;
      const oz = rp ? rp.root.position.z : e.origin.z;
      const origin = new THREE.Vector3(ox, e.origin.y, oz);
      const dir = new THREE.Vector3(e.dir.x, e.dir.y, e.dir.z);
      this.kame.fire(origin, dir, false, "player");
      this.audio.playShot(origin, false);
    });
    // We got hit by someone's kamehameha. Damage + death are now SERVER-authoritative
    // (the server resolves the "kamehit" shield-first via SUPER_DAMAGE and pushes the
    // real HP via "hp" / "died"), so this handler is FX-only: land a VISIBLE blast on
    // us right away. The remote beam travels from the caster's muzzle and arrives
    // AFTER the event, so without this you'd feel the hit before seeing its cause.
    this.mp.setKameHitHandler((e) => {
      if (e.target !== this.mp?.id) return;
      const caster = this.mp?.getRemoteStates().get(e.id)?.name;
      this.lastAttacker = { name: caster || "Alguém", t: Date.now() };
      const hitPos = this.player.root.position.clone();
      this.kame.impactAt(hitPos);
      this.audio.playShot(hitPos, false);
    });
    // Remote staff swing → drag a smoke arc on this client (visual only).
    this.mp.setMeleeHandler((e) => {
      const rp = this.remotePlayers.get(e.id);
      const pos = rp
        ? rp.getPosition()
        : new THREE.Vector3(e.origin.x, e.origin.y, e.origin.z);
      const dir = new THREE.Vector3(e.dir.x, 0, e.dir.z);
      this.smoke.spawnPuff(
        new THREE.Vector3(pos.x, pos.y + 0.4, pos.z),
        dir,
        6,
        "#c9b79a",
      );
    });
    // We got clubbed by a remote staff → small knockback (damage arrives via the
    // server "hit" path). Best-effort: the server may re-assert our position.
    this.mp.setMeleeHitHandler((e) => {
      if (e.target !== this.mp?.id) return;
      this.player.applyKnockback(
        new THREE.Vector3(e.dir.x, 0, e.dir.z),
        MELEE_KNOCKBACK,
      );
    });
    // Relayed kill-feed events from other players → surface to React. Skip events
    // where WE are the victim: we self-report our own death locally (below) with
    // the richer streak-break flavor, so honoring the broadcast too would double it.
    this.mp.setKillHandler((e) => {
      if (e.victim === this.username) return;
      this.onKillFeed?.({
        id: e.id,
        killer: e.killer,
        victim: e.victim,
        streak: e.streak,
        t: Date.now(),
      });
    });
    // Server announced a power-up (incl. periodic re-announces for late joiners).
    // Render the floating pickup resting just above the terrain surface; PowerUps
    // dedupes by id so re-announces are no-ops.
    this.mp.setPowerupSpawnHandler((e) => {
      const y = this.platform ? this.platform.surfaceY(e.x, e.z) + 0.5 : 0.5;
      // e.fx/e.fz present on crate drops → the item flies out from the burst spot.
      this.powerups.spawn(e.id, e.kind, e.x, y, e.z, e.fx, e.fz);
    });
    // Someone picked one up: everyone removes the pickup (with a poof burst); the
    // recipient (by === us) additionally applies the effect locally.
    this.mp.setPowerupTakeHandler((e) => {
      // remove() returns false if we already consumed this id → apply the effect
      // exactly once even if a duplicate "putake" ever arrives.
      const existed = this.powerups.remove(e.id, true);
      if (existed && e.by === this.mp?.id) this.applyPowerup(e.kind);
    });
    // Server announced a destructible crate: render it + make it a bullet target
    // so the local player's shots land on it (each hit relays via sendHit; the
    // server owns the crate's HP). Idempotent: re-announces are ignored by id.
    this.mp.setCrateSpawnHandler((e) => {
      const gy = this.platform ? this.platform.surfaceY(e.x, e.z) : 0.5;
      const crate = this.crates.spawn(e.id, e.x, gy, e.z, this.audio, (id) =>
        this.mp?.sendHit(id),
      );
      if (crate) {
        this.bullets.registerTarget(crate);
        this.kame.registerTarget(crate); // mega beam can break crates too
      }
    });
    // Crate burst: remove it (unregister as a target) + white voxel-smoke boom.
    // The scattered power-ups arrive separately as "puspawn" events.
    this.mp.setCrateExplodeHandler((e) => {
      const crate = this.crates.remove(e.id);
      if (crate) {
        this.bullets.unregisterTarget(crate);
        this.kame.unregisterTarget(crate);
      }
      this.crateExplodeFx(e.x, e.z);
    });
  }

  /** White voxel-smoke explosion + dust + boom where a crate bursts. */
  private crateExplodeFx(x: number, z: number) {
    if (!this.platform) return;
    const gy = this.platform.surfaceY(x, z);
    const pos = new THREE.Vector3(x, gy + 0.45, z);
    for (let i = 0; i < 6; i++) {
      const dir = new THREE.Vector3(
        (Math.random() - 0.5) * 1.4,
        1,
        (Math.random() - 0.5) * 1.4,
      );
      this.smoke.spawnPuff(pos.clone(), dir, 9, "#ffffff");
    }
    this.dust.spawnBurst(new THREE.Vector3(x, gy + 0.05, z), 16);
    this.audio.playExplosion(pos, true);
  }

  /**
   * Apply a power-up effect to the LOCAL player (server-authoritative: only
   * fires when the server says WE took it). Maps the kind to the matching
   * self-contained Player.* effect, plays the level-up cue, and fires the
   * pickup-toast bridge so the HUD shows what we got.
   */
  private applyPowerup(kind: string) {
    if (!this.player) return;
    switch (kind) {
      case "heal":
        this.player.heal();
        break;
      case "speed":
        this.player.applySpeed(POWERUP_KINDS.speed.duration);
        break;
      case "rapid":
        this.player.applyRapid(POWERUP_KINDS.rapid.duration);
        break;
      case "dash":
        this.player.addDashBar();
        break;
      case "shield":
      case "super":
        // Both grant one accumulating shield charge (BR-style armor).
        this.player.applyShield();
        break;
      default:
        return; // unknown kind — ignore (no cue/toast)
    }
    this.audio.playPowerUp(this.player.root.position, true);
    const def = POWERUP_KINDS[kind];
    // Toast only heal + dash: speed/rapid show the boost chip, shield shows the
    // shield row under the HP — a toast there would be redundant.
    if (def && (kind === "heal" || kind === "dash")) {
      this.onPowerupPickup?.(kind, def.label);
    }
    // Reflect the new boost chip / health immediately rather than waiting on the
    // next per-second stats notify.
    this.notifyStats();
  }

  /**
   * Force a remote avatar into its dead pose immediately (don't wait on the next
   * 20Hz snapshot). Re-feeds the remote's current state with alive=false at the
   * death position so the avatar vanishes the instant the "died" event lands.
   */
  private markRemoteDead(id: string, x: number, z: number) {
    const rp = this.remotePlayers.get(id);
    if (!rp) return;
    const st = this.mp?.getRemoteStates().get(id);
    const y = st?.y ?? rp.root.position.y;
    const yaw = st?.yaw ?? 0;
    rp.setState(x, y, z, yaw, 0, false, 0, 0, 0, true, "dead");
  }

  /**
   * Spawn the death gore burst (+ spatial death SFX) for a remote, deduped so it
   * fires exactly once whether triggered by the explicit "died" event or the
   * alive-flag fallback. No-op if already spawned for this remote's current life.
   */
  private spawnDeathFx(id: string, x: number, z: number, byMe = false) {
    if (this.deadFx.has(id)) return;
    this.deadFx.add(id);
    if (!this.platform) return;
    const gy = this.platform.surfaceY(x, z);
    const pos = new THREE.Vector3(x, gy, z);
    this.gore.spawn(pos, gy, 24);
    // The killer always hears their kill at full volume (isLocal=true); everyone
    // else hears it spatially, gated by the hearing ring.
    this.audio.playDeath(pos, byMe);
  }

  /**
   * The local player's beam hit a target.
   *  • lethal (concentrated super) → one dramatic kamehit event on a remote.
   *  • non-lethal (boss mega beam) → relayed as normal hits.
   *  Both deal half max HP per hit, so two hits kill (no insta-kill).
   */
  /**
   * Resolve a melee staff swing: damage + knockback every alive target in a
   * forward arc within MELEE_RANGE. Local bots take damage + knockback directly;
   * remote players take server-authoritative damage (sendHit ×N, soaks shield)
   * plus a relayed knockback cue. Spawns impact smoke + broadcasts the swing.
   */
  private handleMelee(origin: THREE.Vector3, dir: THREE.Vector3) {
    this.mp?.sendMelee(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: dir.x, y: dir.y, z: dir.z },
    );
    const r2 = MELEE_RANGE * MELEE_RANGE;
    const inArc = (px: number, pz: number): THREE.Vector3 | null => {
      const dx = px - origin.x;
      const dz = pz - origin.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > r2) return null;
      const len = Math.sqrt(d2) || 1;
      const nx = dx / len;
      const nz = dz / len;
      if (nx * dir.x + nz * dir.z < MELEE_ARC_DOT) return null; // behind the swing
      return new THREE.Vector3(nx, 0, nz);
    };
    for (const bot of this.bots) {
      if (!bot.isAlive()) continue;
      const push = inArc(bot.root.position.x, bot.root.position.z);
      if (!push) continue;
      this.meleeImpactFx(bot.root.position, push);
      for (let i = 0; i < MELEE_DAMAGE && bot.isAlive(); i++) bot.takeHit(push);
      bot.knockback(push, MELEE_KNOCKBACK);
    }
    for (const rp of this.remotePlayers.values()) {
      if (!rp.isAlive()) continue;
      const p = rp.getPosition();
      const push = inArc(p.x, p.z);
      if (!push) continue;
      this.meleeImpactFx(p, push);
      for (let i = 0; i < MELEE_DAMAGE; i++) this.mp?.sendHit(rp.id);
      this.mp?.sendMeleeHit(rp.id, { x: push.x, y: 0, z: push.z });
    }
  }

  /** White-wood impact smoke burst at a melee-hit target. */
  private meleeImpactFx(pos: THREE.Vector3, dir: THREE.Vector3) {
    this.smoke.spawnPuff(new THREE.Vector3(pos.x, pos.y + 0.4, pos.z), dir, 8, "#bfae90");
  }

  private onKameHit(
    target: BulletTarget,
    dir: THREE.Vector3,
    lethal: boolean,
    ownerId: string,
  ) {
    const name = this.nameForOwner(ownerId);
    // Mega beam hit a crate → burst it (relay enough hits to drain its HP; the
    // server owns the crate and broadcasts crexplode + the power-up drops).
    if (this.crates.has(target.id)) {
      for (let i = 0; i < 12; i++) this.mp?.sendHit(target.id);
      return;
    }
    // A local-bot beam landed on the LOCAL player → a concentrated super deals
    // SUPER_DAMAGE (3), a boss mega beam deals BOSS_SHOT_DAMAGE (5). Both soak
    // shield-first via takeHit/applyDamage.
    if (target === this.player) {
      if (name) this.lastAttacker = { name, t: Date.now() };
      const dmg = lethal ? SUPER_DAMAGE : BOSS_SHOT_DAMAGE;
      for (let i = 0; i < dmg && this.player.isAlive(); i++) {
        this.player.takeHit(dir);
      }
      return;
    }
    // Attribute the kill so bot-vs-bot mega kills show in the feed.
    if (target instanceof Bot && name) target.recordHitBy(name);
    // Concentrated super → SUPER_DAMAGE (3); boss mega beam → BOSS_SHOT_DAMAGE (5).
    if (target instanceof Bot) {
      const dmg = lethal ? SUPER_DAMAGE : BOSS_SHOT_DAMAGE;
      for (let i = 0; i < dmg && target.isAlive(); i++) {
        target.takeHit(dir);
      }
      if (!target.isAlive()) this.kameKillFx(target.position.x, target.position.z);
    } else if (target instanceof RemotePlayer) {
      this.recentHits.set(target.id, Date.now());
      if (lethal) {
        // Concentrated super: one kamehit event. The SERVER resolves it shield-first
        // for SUPER_DAMAGE (3) and pushes the victim's real HP back — no client-side
        // damage here, so the two supers (player + bot) share one authoritative model.
        this.mp?.sendKameHit(target.id, { x: dir.x, y: dir.y, z: dir.z });
      } else {
        for (let i = 0; i < BOSS_SHOT_DAMAGE; i++) this.mp?.sendHit(target.id);
      }
    }
  }

  /**
   * Resolve a bullet/beam ownerId to a display name: "player" → our username,
   * a bot id → that bot's (random) name, else null (remote/visual/unknown —
   * remote attribution comes from the net "hit"/"kamehit" events instead).
   */
  private nameForOwner(ownerId: string): string | null {
    if (!ownerId || ownerId === "remote") return null;
    if (ownerId === "player") return this.username;
    const bot = this.bots.find((b) => b.id === ownerId);
    return bot ? bot.getDisplayName() : null;
  }

  /**
   * Choose a respawn point far from every other combatant (remote players + AI
   * bots): sample several candidates and keep the one whose NEAREST enemy is
   * farthest away. Stops the player from respawning on top of a fight.
   */
  private pickSafeSpawn(): THREE.Vector3 | null {
    if (!this.platform) return null;
    const enemies: { x: number; z: number }[] = [];
    for (const rp of this.remotePlayers.values()) {
      if (!rp.isAlive()) continue;
      const p = rp.getPosition();
      enemies.push({ x: p.x, z: p.z });
    }
    for (const bot of this.bots) {
      if (bot.isAlive()) enemies.push({ x: bot.position.x, z: bot.position.z });
    }
    let best: THREE.Vector3 | null = null;
    let bestScore = -Infinity;
    for (let i = 0; i < 16; i++) {
      const c = this.platform.randomSpawn(4);
      let minD = Infinity;
      for (const e of enemies) {
        const d = (c.x - e.x) ** 2 + (c.z - e.z) ** 2;
        if (d < minD) minD = d;
      }
      const score = enemies.length === 0 ? Math.random() : minD;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  }

  /** Exaggerated voxel-gore burst + boom where a super shot lands. */
  private kameKillFx(x: number, z: number) {
    if (!this.platform) return;
    const gy = this.platform.surfaceY(x, z);
    const pos = new THREE.Vector3(x, gy, z);
    this.gore.spawn(pos, gy, 48); // double the normal burst
    this.audio.playExplosion(pos, true); // satisfying boom at full volume
  }

  /** Arm a one-time gesture listener that resumes the AudioContext. */
  private armAudioResume() {
    if (this.audioResumeArmed) return;
    this.audioResumeArmed = true;
    const resume = () => {
      this.audio.resume();
      window.removeEventListener("pointerdown", resume);
      window.removeEventListener("keydown", resume);
    };
    window.addEventListener("pointerdown", resume);
    window.addEventListener("keydown", resume);
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015);
    // Mutate the user-zoom (NOT camera.zoom directly): updateCamera runs every
    // frame and would otherwise snap camera.zoom back to its computed value,
    // wiping the wheel input within one frame.
    this.userZoom = THREE.MathUtils.clamp(
      this.userZoom * factor,
      ZOOM_MIN,
      ZOOM_MAX,
    );
    this.applyZoom();
  };

  /**
   * Tab background lifecycle. When the tab is hidden the browser throttles rAF
   * to ~1Hz; we stop broadcasting fresh pose `s` so other clients don't
   * dead-reckon a frozen avatar and then hard-snap (rubber-band/teleport for
   * observers). Local simulation/prediction is untouched — only the NETWORK
   * broadcast is gated (see updateMultiplayer). On return to visible, the
   * accumulated broadcast backlog is reset so the clamped-huge first dt after
   * refocus can't fire a burst/snap of catch-up snapshots.
   */
  private onVisibilityChange = () => {
    const hidden = document.visibilityState === "hidden";
    if (!hidden && this.docHidden) {
      // Refocus: drop any backlog so the first frame's large dt doesn't spill a
      // burst of broadcasts (mirrors the existing accum cap, but to zero).
      this.mpBroadcastAccum = 0;
    }
    this.docHidden = hidden;
  };

  /**
   * Resolve the effective camera zoom = user wheel zoom × the boss factor (the
   * giant boss zooms out so it stays playable). Single writer of camera.zoom on
   * the playable path, so the wheel and the boss state compose instead of fight.
   */
  private applyZoom() {
    const bossFactor = this.player?.getFireMode() === "boss" ? 0.6 : 1;
    const z = this.userZoom * bossFactor;
    if (this.camera.zoom !== z) {
      this.camera.zoom = z;
      this.camera.updateProjectionMatrix();
    }
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
    this.kame.registerTarget(bot);
  }

  private clearBots() {
    for (const bot of this.bots) {
      this.bullets.unregisterTarget(bot);
      this.kame.unregisterTarget(bot);
      this.kame.clearCharge(bot.id);
      this.scene.remove(bot.root);
      bot.dispose();
    }
    this.bots = [];
  }


  /**
   * Build the ambient showcase world used as the (blurred) menu background: the
   * REAL game scene with a wave of bots fighting each other and one featured
   * auto-jumping avatar. No player control, multiplayer, voice, leaderboard, or
   * HUD stats — runLoop's ambient path renders it in isolation.
   */
  private buildAmbient() {
    // Disable input so the ambient InputManager (window keydown listeners) never
    // preventDefaults WASD/Space — otherwise it would swallow characters typed
    // into the Menu's username field behind which this background renders.
    this.input.setEnabled(false);

    // Time-seeded so the background varies between visits (no determinism need).
    this.buildWorld((Date.now() >>> 0) || 1);
    // buildWorld constructs + adds the local Player; ambient never controls or
    // updates it, so hide it so only the bots + featured actor show. Also drop it
    // as a bullet/beam target so the FFA menu bots can't shoot the invisible
    // player (which would fire stray hit/death SFX behind the menu).
    if (this.player) {
      this.player.root.visible = false;
      this.bullets.unregisterTarget(this.player);
      this.kame.unregisterTarget(this.player);
    }

    // A wave of fighting bots. Alternate the bullet `side` ("player"/"bot") so
    // opposite-side bots damage each other (the collision filter skips bullets
    // whose owner matches the target's side) — no change to the shared path.
    for (let i = 0; i < AMBIENT_BOT_COUNT; i++) {
      this.spawnAmbientBot(i % 2 === 0 ? "player" : "bot");
    }

    // The featured showcase avatar: immortal, wanders + auto-jumps. Kept OUT of
    // this.bots so it is never a hunt target and never gets shot at.
    this.featured = new Bot(
      "featured",
      this.platform,
      this.audio,
      this.dust,
      this.bullets,
      this.featuredAnimal,
      "ambient",
    );
    this.featured.setSmoke(this.smoke);
    this.scene.add(this.featured.root);
  }

  /** Spawn a fighting bot with a chosen bullet side (ambient bot-vs-bot). */
  private spawnAmbientBot(side: BulletOwner) {
    const bot = new Bot(
      `bot_${this.nextBotId++}`,
      this.platform,
      this.audio,
      this.dust,
      this.bullets,
      undefined,
      "hunt",
      side,
    );
    bot.setSmoke(this.smoke);
    this.bots.push(bot);
    this.scene.add(bot.root);
    this.bullets.registerTarget(bot);
    this.kame.registerTarget(bot);
  }

  /**
   * Nearest alive fighting bot to `bot` (excluding itself and the featured
   * showcase actor) so ambient bots hunt each other. Null if none — the bot
   * then falls back to wandering.
   */
  private nearestTargetFor(bot: Bot): BulletTarget | null {
    let best: Bot | null = null;
    let bestD = Infinity;
    for (const other of this.bots) {
      if (other === bot || !other.isAlive()) continue;
      const dx = other.position.x - bot.position.x;
      const dz = other.position.z - bot.position.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = other;
      }
    }
    return best;
  }

  /**
   * Slow orbit around the platform center for the ambient menu background.
   * Never reads this.player (which is hidden + unsimulated in ambient mode).
   */
  private updateAmbientCamera(dt: number) {
    this.ambientCamAngle += dt * 0.06;
    const radius = this.cameraOffset.length();
    const cx = 0;
    const cz = 0;
    const cy = this.cameraOffset.y;
    this.camera.position.set(
      cx + Math.cos(this.ambientCamAngle) * radius,
      cy,
      cz + Math.sin(this.ambientCamAngle) * radius,
    );
    this.camera.lookAt(cx, this.platform.topY, cz);
  }

  /** Reset run state and spawn a fresh wave of bots. */
  private restartRun() {
    if (this.elapsed > this.topScore) {
      this.topScore = this.elapsed;
      this.saveTopScore(this.topScore);
    }
    this.elapsed = 0;
    this.kills = 0;
    this.killStreak = 0;
    this.nextBotSpawnAt = NEW_BOT_EVERY_SECONDS;
    this.clearBots();
    if (this.mode === "local") {
      for (let i = 0; i < INITIAL_BOTS; i++) this.spawnBot();
    } else if (this.mp) {
      // Mark a fresh life so the leaderboard alive-time resets.
      this.mp.updateSelf({ aliveSince: Date.now(), alive: true });
    }
    this.notifyStats();
  }

  setStatsListener(cb?: (stats: GameStats) => void) {
    this.onStatsChange = cb;
    this.notifyStats();
  }

  /**
   * Register the world-ready callback (Index drops its loading overlay here).
   * Fires immediately if the world is already built — covers local mode, where
   * buildWorld runs synchronously in the constructor before Index can register.
   */
  setOnReady(cb: () => void) {
    this.onReady = cb;
    if (this.ready) cb();
  }

  private markReady() {
    if (this.ready) return;
    this.ready = true;
    this.onReady?.();
  }

  private notifyStats() {
    if (this.onStatsChange) {
      // The player only exists after the seed-gated world build; before that
      // (MP "Conectando...") emit a neutral snapshot so the HUD can render the
      // loading state without crashing.
      if (!this.player) {
        this.onStatsChange({
          elapsed: 0,
          topScore: this.topScore,
          botCount: 0,
          health: 0,
          maxHealth: 0,
          isDead: false,
          dashCharges: 0,
          dashMaxCharges: 0,
          kills: this.kills,
          mode: this.mode,
          mpConnected: this.mp?.status === "online",
          mpLocal: this.mp?.kind === "local",
          mpPlayers: this.mp?.getPlayerCount() ?? 0,
        ping: this.mp?.getPing() ?? null,
          talking: this.lastTalking,
          voiceMode: this.voiceMode,
          fireMode: "constant",
          weaponSlot: 0,
          chargeProgress: 0,
          respawnIn: 0,
          shield: 0,
          leaderboard: this.buildLeaderboard(),
          roster: this.buildRoster(),
          bestRuns: this.bestRuns,
          boosts: [],
        });
        return;
      }
      this.onStatsChange({
        elapsed: this.elapsed,
        topScore: this.topScore,
        botCount: this.bots.length,
        health: this.player.getHealth(),
        maxHealth: this.player.getMaxHealth(),
        isDead: !this.player.isAlive(),
        dashCharges: this.player.getDashCharges(),
        dashMaxCharges: this.player.getDashMaxCharges(),
        kills: this.kills,
        mode: this.mode,
        mpConnected: this.mp?.status === "online",
        mpLocal: this.mp?.kind === "local",
        // Presence already includes the server-driven bots, so this counts them.
        mpPlayers: this.mp?.getPlayerCount() ?? 0,
        ping: this.mp?.getPing() ?? null,
        talking: this.lastTalking,
        voiceMode: this.voiceMode,
        fireMode: this.player.getFireMode(),
        weaponSlot: this.player.getWeaponSlot(),
        chargeProgress: this.player.getChargeProgress(),
        respawnIn: Math.ceil(this.player.getRespawnRemaining()),
        shield: this.player.getShield(),
        leaderboard: this.buildLeaderboard(),
        roster: this.buildRoster(),
        bestRuns: this.bestRuns,
        // Active timed boosts, mapped to their PT-BR labels for the BoostBar.
        boosts: this.player
          .getBoosts()
          .map((b) => ({ ...b, label: POWERUP_KINDS[b.kind].label })),
      });
    }
  }

  /** Leaderboard rows ranked by alive-time (longest-alive first). */
  private buildLeaderboard(): LeaderboardEntry[] {
    if (this.mode !== "multiplayer") return [];
    const pres = this.mp?.getLeaderboard() ?? [];
    const myId = this.mp?.id;
    if (pres.length > 0) {
      return pres.map((p) => ({
        id: p.id,
        name: p.name,
        aliveSince: p.aliveSince,
        kills: p.kills,
        alive: p.alive,
        me: p.id === myId,
      }));
    }
    // Offline / not yet synced: show just the local player.
    return [
      {
        id: "me",
        name: this.username,
        aliveSince: this.playerAliveSince || Date.now(),
        kills: this.kills,
        alive: this.player ? this.player.isAlive() : true,
        me: true,
      },
    ];
  }

  /**
   * Online roster for the HUD players list. Presence already includes the
   * server-driven bots (they're broadcast as pseudo-players), so this lists
   * every live player + bot, self first.
   */
  private buildRoster(): RosterEntry[] {
    if (this.mode !== "multiplayer" || !this.mp) return [];
    const myId = this.mp.id;
    const rows: RosterEntry[] = [];
    for (const p of this.mp.getPresence().values()) {
      rows.push({ id: p.id, name: p.name, me: p.id === myId, isBot: p.isBot === true });
    }
    rows.sort((a, b) => (a.me === b.me ? 0 : a.me ? -1 : 1)); // self first
    return rows;
  }

  /** Pull the persisted all-time best runs and push them into the HUD. */
  private refreshBestRuns() {
    fetchTop(8)
      .then((rows) => {
        this.bestRuns = rows;
        this.notifyStats();
      })
      .catch(() => {
        /* best-effort; persisted records never block gameplay */
      });
  }

  getPlayer() {
    return this.player;
  }

  /**
   * Mute/unmute all procedural game SFX (footsteps, shots, jumps, death). Wired
   * to the Settings screen so the choice applies live to the menu's ambient
   * scene; the real game also reads the persisted flag on construction.
   */
  setSfxMuted(muted: boolean) {
    this.audio.setMuted(muted);
  }

  /**
   * Mute/unmute INCOMING proximity voice (stop hearing teammates) — independent
   * of SFX and of the mic. No-op outside multiplayer (voice is undefined).
   */
  setVoiceMuted(muted: boolean) {
    this.voice?.setOutputMuted(muted);
  }

  /** Voice device bridge (called from the React settings modal via Index). */
  setVoiceInputDevice(id: string) {
    void this.voice?.setInputDevice(id);
  }

  setVoiceOutputDevice(id: string) {
    void this.voice?.setOutputDevice(id);
  }

  /**
   * Full voice restart: tears down all peer connections + mic, then reconnects
   * so fresh negotiation runs from scratch. Wired to the "Reiniciar áudio"
   * button in VoiceSettingsModal via the onRestart prop.
   */
  restartVoice() {
    void this.voice?.restart();
  }

  /** Current voice transmission mode ("ptt" | "open"). */
  getVoiceMode(): VoiceMode {
    return this.voiceMode;
  }

  /**
   * Switch voice mode and apply it immediately. Called synchronously from the
   * HUD toggle's click handler so the user gesture satisfies getUserMedia when
   * switching to "open" (which lazily acquires the mic via setTalking(true)).
   */
  setVoiceMode(mode: VoiceMode) {
    this.voiceMode = mode;
    try {
      localStorage.setItem(VOICE_MODE_KEY, mode);
    } catch {
      // ignore quota / unavailable storage (private mode)
    }
    this.updateVoice();
    this.notifyStats();
  }

  /** Inbound chat bridge (ChatPanel subscribes; pass undefined to detach). */
  setChatListener(cb?: (e: ChatEvent) => void) {
    this.onChatMessage = cb;
  }

  /** Kill-feed bridge (HUD subscribes; pass undefined to detach). */
  setKillFeedListener(cb?: (e: KillFeedEntry) => void) {
    this.onKillFeed = cb;
  }

  /** Power-up pickup bridge (PickupToast subscribes; pass undefined to detach). */
  setPickupListener(cb?: (kind: string, label: string) => void) {
    this.onPowerupPickup = cb;
  }

  /** Send a chat message (no-op in local/ambient where mp is undefined). */
  sendChat(text: string) {
    this.mp?.sendChat(text);
  }

  /**
   * Enable/disable game-key handling so a focused chat input receives raw
   * characters and no game action fires. Wired to ChatPanel onFocus/onBlur.
   */
  setInputEnabled(enabled: boolean) {
    this.input.setEnabled(enabled);
  }

  // ── Mobile touch-control bridge ───────────────────────────────────────────
  // Index forwards MobileControls events here; each proxies straight to the
  // InputManager, which the Player aim + firing already consume.
  /** Forward left-stick (move) from MobileControls to InputManager. */
  mobileMove(x: number, y: number) { this.input.setMoveAxis(x, y); }
  /** Forward right-stick (aim) from MobileControls to InputManager. */
  mobileAim(x: number, y: number) { this.input.setAimAxis(x, y); }
  /** Called when the right stick is released — stop aiming/auto-fire. */
  mobileAimEnd() { this.input.clearAim(); }
  /** Called on Jump button touchstart. */
  mobileJump() { this.input.triggerJump(); }
  /** Called on Dash button touchstart. */
  mobileDash() { this.input.triggerDash(); }
  /** Toggle fire mode (HUD button; Tab also toggles via InputManager). */
  toggleFireMode() {
    this.player?.toggleFireMode();
    this.notifyStats();
  }

  /** Select a hotbar weapon slot (0/1/2) — from a HUD slot click/tap. */
  selectWeaponSlot(slot: number) {
    this.player?.setWeaponSlot(slot);
    this.notifyStats();
  }
  /** Current fire mode for the HUD toggle. */
  getFireMode(): FireMode {
    return this.player?.getFireMode() ?? "constant";
  }
  // ─────────────────────────────────────────────────────────────────────────

  private makeVoiceRing(): THREE.Mesh {
    const geo = new THREE.RingGeometry(HEARING_RADIUS - 0.07, HEARING_RADIUS, 96);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color("#ff4d5e"),
      transparent: true,
      opacity: 0.26,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = 2;
    return mesh;
  }

  /** Push-to-talk (G) or always-on, proximity volume, and the radius ring. */
  private updateVoice() {
    if (!this.voice) return;
    // "open" = always transmit (G ignored); "ptt" = transmit only while G held.
    // Both gate on isAlive so dead players never transmit.
    const wantTalk =
      this.voiceMode === "open" ? true : this.input.isVoiceHeld();
    const talk = wantTalk && this.player.isAlive();
    if (talk !== this.lastTalking) {
      void this.voice.setTalking(talk);
      this.lastTalking = talk;
    }
    this.voice.updateProximity(
      { x: this.player.root.position.x, z: this.player.root.position.z },
      (id) => {
        const st = this.mp?.getRemoteStates().get(id);
        return st ? { x: st.x, z: st.z } : null;
      },
      HEARING_RADIUS,
    );
    if (this.voiceRing) {
      const px = this.player.root.position.x;
      const pz = this.player.root.position.z;
      this.voiceRing.position.set(px, this.platform.surfaceY(px, pz) + 0.06, pz);
      this.voiceRing.visible = this.player.isAlive();
      (this.voiceRing.material as THREE.MeshBasicMaterial).opacity = this
        .lastTalking
        ? 0.6
        : 0.26;
    }
  }

  /** Broadcast our state and reconcile remote-player avatars (multiplayer). */
  private updateMultiplayer(dt: number) {
    if (!this.mp) return;
    this.updateVoice();

    // Spatial-audio listener follows the local player (set BEFORE remote updates
    // run so their inferred SFX attenuate against the current position).
    this.audio.setListener(
      this.player.root.position.x,
      this.player.root.position.z,
    );

    // Fixed-step snapshot broadcast at NET_TICK_HZ. Subtract (don't reset) so the
    // cadence holds at any frame rate; cap the backlog so a long stall (tab in
    // background) can't fire a burst of catch-up snapshots.
    const step = 1 / NET_TICK_HZ;
    this.mpBroadcastAccum += dt;
    if (this.mpBroadcastAccum > step * 5) this.mpBroadcastAccum = step * 5;
    while (this.mpBroadcastAccum >= step) {
      this.mpBroadcastAccum -= step;
      const p = this.player.root.position;
      const chg = this.player.getChargeState();
      this.mp.broadcast({
        x: p.x,
        y: p.y,
        z: p.z,
        yaw: this.player.getAimYaw(),
        health: this.player.getHealth(),
        alive: this.player.isAlive(),
        vx: this.player.getVx(),
        vz: this.player.getVz(),
        vy: this.player.getVy(),
        grounded: this.player.isGrounded(),
        state: this.player.getState(),
        charging: chg.charging,
        chargeT: chg.t,
      });
    }

    // Consume the local player's one-shot flags every frame (NOT throttled) and
    // fire the matching instant events so remotes get the juice immediately.
    if (this.player.consumeJustDashed()) {
      this.mp.sendDash(this.player.getDashYaw());
    }
    if (this.player.consumeJustJumped()) {
      this.mp.sendJump();
    }
    if (this.player.consumeJustDied()) {
      const p = this.player.root.position;
      this.mp.sendDied(p.x, p.z);
    }

    // Reconcile remote avatars from the latest received states.
    //
    // AFK authority (item 5): the server's "s" relay no longer prunes states on
    // presence absence, so getRemoteStates() retains a player's last snapshot
    // through the grace window (avatar stays put, still killable). Existence is
    // driven by the grace-aware presence roster instead: a player only truly
    // GONE once the server's grace sweep drops it from presence. We therefore
    // skip states for ids absent from presence and dispose their avatars below.
    const states = this.mp.getRemoteStates();
    const presence = this.mp.getPresence();
    // When presence has not synced yet (size 0), fall back to trusting states so
    // avatars still appear before the first roster frame lands.
    const havePresence = presence.size > 0;
    for (const [id, st] of states) {
      if (havePresence && !presence.has(id)) continue; // gone after grace
      let rp = this.remotePlayers.get(id);
      if (!rp) {
        rp = new RemotePlayer(id, st.name, st.animal, this.audio, (hid) => {
          this.recentHits.set(hid, Date.now());
          this.mp?.sendHit(hid);
        });
        const present = st.present !== false;
        rp.setState(
          st.x,
          st.y,
          st.z,
          st.yaw,
          st.health,
          st.alive,
          st.vx,
          st.vz,
          st.vy,
          st.grounded,
          st.state,
          present,
        );
        rp.setPresent(present);
        rp.snap();
        this.remotePlayers.set(id, rp);
        this.scene.add(rp.root);
        this.bullets.registerTarget(rp);
        this.kame.registerTarget(rp);
        this.remoteRecvSeq.set(id, st.recvSeq ?? 0);
      } else {
        const present = st.present !== false;
        // recvSeq guard: the reconcile loop runs at ~60Hz over a Map that only
        // holds the latest "s", so push a new snapshot into the interp buffer
        // ONLY when a genuinely new packet arrived (seq changed). Re-pushing the
        // same pose every frame collapses the interpolation window and causes
        // micro-stutter. setPresent + the alive/charge/update logic below still
        // run every frame. (RemotePlayer.setState preserves the respawn-teleport
        // hard-snap when dead→alive, so that path is unaffected.)
        const lastSeq = this.remoteRecvSeq.get(id);
        if (st.recvSeq !== lastSeq) {
          this.remoteRecvSeq.set(id, st.recvSeq ?? 0);
          rp.setState(
            st.x,
            st.y,
            st.z,
            st.yaw,
            st.health,
            st.alive,
            st.vx,
            st.vz,
            st.vy,
            st.grounded,
            st.state,
            present,
          );
        }
        rp.setPresent(present);
      }
      // Kill attribution: a remote we hit recently just died (alive flip is now
      // server-authoritative — the server overwrites alive on relayed "s").
      const prevAlive = this.remoteAlivePrev.get(id) ?? true;
      if (prevAlive && !st.alive && Date.now() - (this.recentHits.get(id) ?? 0) < 2000) {
        this.kills += 1;
        this.killStreak += 1;
        this.mp.updateSelf({ kills: this.kills });
        // UNIQUE per-kill id so the feed never dedupes/duplicates (it keys by id).
        const eventId = `${this.mp.id}:${++this.killSeq}`;
        // Broadcast the kill so every client's feed shows it (item 11), and
        // surface it locally too (the kill relay never echoes to the killer).
        this.mp.sendKill(eventId, st.name, this.killStreak);
        this.onKillFeed?.({
          id: eventId,
          killer: this.username,
          victim: st.name,
          streak: this.killStreak,
          t: Date.now(),
        });
      }
      // Gore fallback: if a remote went alive→dead but no "died" event reached us
      // (dropped packet / blocked broadcast), spawn the burst here. Routed through
      // the SAME deadFx dedupe set so it never double-fires with the event path.
      // Uses the rendered position + credits us if we hit them recently (so the
      // kill is seen on-screen and heard at full volume).
      if (prevAlive && !st.alive) {
        const pos = rp.getPosition();
        const byMe = Date.now() - (this.recentHits.get(id) ?? 0) < 2000;
        this.spawnDeathFx(id, pos.x, pos.z, byMe);
      }
      // Respawned (dead→alive): clear the dedupe so the NEXT death fires once more.
      if (!prevAlive && st.alive) {
        this.deadFx.delete(id);
      }
      this.remoteAlivePrev.set(id, st.alive);

      // Charge orb VFX for a remote winding up the special — the whole lobby
      // sees who's charging (so they can run).
      if (st.charging && st.alive) {
        const rpos = rp.getPosition();
        const anchor = new THREE.Vector3(rpos.x, rpos.y + 0.35, rpos.z);
        this.kame.setCharge(id, anchor, st.chargeT ?? 0, dt);
      } else {
        this.kame.clearCharge(id);
      }
      const gy = this.platform.surfaceY(rp.root.position.x, rp.root.position.z);
      rp.update(dt, gy);

      // ── Remote particle hooks: consume one-shot flags set by RemotePlayer ──
      // Spawn after update() so rp.getPosition() reflects this frame's position.
      const rpos = rp.getPosition();
      const rsy = this.platform.surfaceY(rpos.x, rpos.z);

      const onGrass = !this.platform.isLavaAt(rpos.x, rpos.z);

      if (rp.consumeJustDashed()) {
        // Dash launch FX — exact mirror of Player.dash (Player.ts:627-640):
        // smoke puff (16, against the dash dir) + dust burst (18).
        const ddir = new THREE.Vector3(
          Math.cos(rp.getDashYaw()),
          0,
          Math.sin(rp.getDashYaw()),
        );
        this.smoke.spawnPuff(
          new THREE.Vector3(rpos.x, rpos.y, rpos.z),
          ddir.clone().negate(),
          16,
          "#d6d6d6",
        );
        this.dust.spawnBurst(
          new THREE.Vector3(rpos.x, rsy + 0.05, rpos.z),
          18,
        );
      }

      if (rp.consumeJustJumped()) {
        // Jump FX — exact mirror of Player jump (Player.ts:421-433): grass puff
        // (6), no dust.
        if (onGrass) {
          this.grassPoof.spawn(
            new THREE.Vector3(rpos.x, rsy, rpos.z),
            6,
            null,
          );
        }
      }

      if (rp.consumeJustLanded()) {
        // Land FX — exact mirror of Player landing (Player.ts:488-501): dust
        // burst (10) + grass puff (8).
        this.dust.spawnBurst(
          new THREE.Vector3(rpos.x, rsy + 0.02, rpos.z),
          10,
        );
        if (onGrass) {
          this.grassPoof.spawn(
            new THREE.Vector3(rpos.x, rsy, rpos.z),
            8,
            null,
          );
        }
      }

      if (rp.consumeJustStepped()) {
        // Footstep FX — exact mirror of Player footstep (Player.ts:582-596):
        // grass puff (2) biased along the movement direction.
        if (onGrass) {
          const sdir = rp.getVelocityXZ();
          this.grassPoof.spawn(
            new THREE.Vector3(rpos.x, rsy, rpos.z),
            2,
            sdir,
          );
        }
      }
    }
    // Dispose avatars only when the player is TRULY gone (dropped from the
    // grace-aware presence roster after the server's grace sweep) — NOT on a
    // single-frame "s" gap or a disconnect within the grace window. While
    // present:false the avatar stays rendered (frozen, still killable) above.
    if (havePresence) {
      for (const [id, rp] of this.remotePlayers) {
        if (!presence.has(id)) {
          this.scene.remove(rp.root);
          this.bullets.unregisterTarget(rp);
          this.kame.unregisterTarget(rp);
          this.kame.clearCharge(id);
          rp.dispose();
          this.remotePlayers.delete(id);
          this.remoteAlivePrev.delete(id);
          this.remoteRecvSeq.delete(id);
          this.recentHits.delete(id);
          this.deadFx.delete(id);
        }
      }
    }
  }

  private updateCamera() {
    // Effective zoom = user wheel zoom × boss factor (giant boss zooms out so it
    // stays playable). Composed in applyZoom so the wheel input isn't clobbered.
    this.applyZoom();
    this.camera.position.copy(this.player.root.position).add(this.cameraOffset);
    if (this.shakeTime > 0) {
      const m = SHAKE_MAGNITUDE * (this.shakeTime / SHAKE_DURATION);
      this.camera.position.x += (Math.random() - 0.5) * 2 * m;
      this.camera.position.y += (Math.random() - 0.5) * 2 * m;
      this.camera.position.z += (Math.random() - 0.5) * 2 * m;
    }
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
    this.postfx?.setSize(w, h);
  };

  /**
   * (Re)build or tear down the post-processing stack to match this.pixelFilter.
   * Pins the renderer pixelRatio to 1 while on (the filter intentionally LOWERS
   * pixel density, and this keeps the chunk size consistent across DPRs).
   */
  private applyPixelFilter() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setPixelRatio(
      this.pixelFilter ? 1 : window.devicePixelRatio,
    );
    this.renderer.setSize(w, h);
    if (this.postfx) {
      this.postfx.dispose();
      this.postfx = null;
    }
    if (this.pixelFilter) {
      this.postfx = new PostFX(this.renderer, this.scene, this.camera, w, h);
    }
  }

  /** Live toggle for the "modo desenho" filter (persisted by the Settings UI). */
  setPixelFilter(on: boolean) {
    if (on === this.pixelFilter) return;
    this.pixelFilter = on;
    this.applyPixelFilter();
  }

  /** Render one frame through the filter when active, else straight to screen. */
  private renderFrame() {
    if (this.postfx) this.postfx.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /**
   * Public entry from Index. In local mode the world already exists so the loop
   * starts immediately; in multiplayer the world isn't built until the seed
   * arrives, so we record the request and let the seed handler start the loop.
   */
  start() {
    this.startRequested = true;
    // On a real playable mode (not the ambient menu background), try to pin
    // mobile devices to landscape. Many browsers reject orientation.lock()
    // outside fullscreen — that's fine, the Index rotate-overlay covers it.
    if (this.mode !== "ambient" && isMobileDevice()) {
      void this.lockLandscape();
    }
    if (this.platform) this.runLoop();
  }

  /** Best-effort landscape orientation lock for mobile. Safe to reject. */
  private async lockLandscape() {
    try {
      await (screen.orientation as unknown as {
        lock?: (o: string) => Promise<void>;
      })?.lock?.("landscape");
    } catch {
      // Many browsers reject without fullscreen — the rotate overlay handles it.
    }
  }

  private runLoop() {
    if (this.loopStarted) return;
    this.loopStarted = true;
    this.clock.start();
    let lastNotifySecond = -1;
    let lastHealth = this.player.getHealth();
    let lastDead = !this.player.isAlive();
    let lastBotCount = this.bots.length;
    let lastDashCharges = Math.floor(this.player.getDashCharges());
    let lastKills = this.kills;
    let lastTalkingFlag = this.lastTalking;
    let lastCharge = 0; // charge progress in whole % (drives the toggle fill)
    let lastRespawnSec = 0; // respawn countdown in whole seconds (ticks while dead)
    let lastSlot = this.player.getWeaponSlot(); // active hotbar weapon slot
    const loop = () => {
      const dt = this.paused ? 0 : Math.min(this.clock.getDelta(), 1 / 30);

      // ── Ambient (menu background): bots fight each other + a featured avatar
      // auto-jumps; no player/MP/voice/stats. Fully isolated — never touches
      // this.player (hidden + unsimulated) and returns before the normal path.
      if (this.mode === "ambient") {
        for (const bot of this.bots) bot.update(dt, this.nearestTargetFor(bot));
        this.featured?.update(dt, null);
        this.dust.update(dt);
        this.bullets.update(dt);
        this.smoke.update(dt);
        this.grassPoof.update(dt);
        this.fog.update(dt);
        this.rain.update(dt);
        this.decor.update(dt);
        this.butterflies.update(dt);
        this.gore.update(dt);
        // Voxel gore burst when a fighting bot dies (then it respawns itself).
        for (const bot of this.bots) {
          if (bot.consumeJustDied()) {
            const gy = this.platform.surfaceY(
              bot.root.position.x,
              bot.root.position.z,
            );
            this.gore.spawn(bot.root.position, gy);
          }
          // Keep fighting bots out of lava so the showcase stays lively.
          if (
            bot.isAlive() &&
            bot.isGrounded() &&
            this.platform.isLavaAt(bot.root.position.x, bot.root.position.z)
          ) {
            bot.killByHazard();
          }
        }
        this.updateAmbientCamera(dt);
        this.renderFrame();
        this.rafId = requestAnimationFrame(loop);
        return;
      }

      if (!this.paused) {
        this.player.update(dt, this.camera);
        // Local survival bots hunt the player (online bots are server-driven).
        for (const bot of this.bots) bot.update(dt, this.player);
        this.dust.update(dt);
        this.bullets.update(dt);
        this.smoke.update(dt);
        this.grassPoof.update(dt);
        this.fog.update(dt);
        this.rain.update(dt);
        this.decor.update(dt);
        this.butterflies.update(dt);
        this.gore.update(dt);
        // Kamehameha: drive the LOCAL charge orb (keyed "self") + advance beams.
        // Remote charge orbs are driven from snapshots in updateMultiplayer.
        const charge = this.player.getKameCharge();
        if (charge) this.kame.setCharge("self", charge.anchor, charge.t, dt);
        else this.kame.clearCharge("self");
        this.kame.update(dt);
        // Bob/spin the floating power-up pickups (multiplayer only; the group is
        // empty in local/ambient so this is a cheap no-op there).
        this.powerups.update(dt);
        this.crates.update(dt);
        if (this.mp) this.updateMultiplayer(dt);

        // Screen shake when the player loses health
        if (this.shakeTime > 0) this.shakeTime -= dt;
        const shakeHp = this.player.getHealth();
        if (shakeHp < this.lastShakeHealth) this.shakeTime = SHAKE_DURATION;
        this.lastShakeHealth = shakeHp;

        // Bot deaths (local survival mode only — online bots are server-driven):
        // voxel gore + credit the run score when the player landed the kill.
        for (const bot of this.bots) {
          if (bot.consumeJustDied()) {
            const gy = this.platform.surfaceY(
              bot.root.position.x,
              bot.root.position.z,
            );
            this.gore.spawn(bot.root.position, gy);
            if (bot.getLastHitByName() === this.username) this.kills += 1;
          }
        }

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
          // Spawn additional bot every minute (local survival only)
          if (this.mode === "local" && this.elapsed >= this.nextBotSpawnAt) {
            this.spawnBot();
            this.nextBotSpawnAt += NEW_BOT_EVERY_SECONDS;
            this.notifyStats();
          }
        }

        // Death / respawn handling
        if (this.wasPlayerAliveLastFrame && !aliveNow) {
          // Burst the player into voxel gore on death.
          const gy = this.platform.surfaceY(
            this.player.root.position.x,
            this.player.root.position.z,
          );
          this.gore.spawn(this.player.root.position, gy, 24);
          // Online: surface "X matou você" / "X interrompeu a chacina de você"
          // from OUR side (we know our own streak; remote killers can't). The
          // killer's own broadcast naming us as victim is skipped (above).
          if (this.mode === "multiplayer" && this.mp) {
            const fresh =
              this.lastAttacker && Date.now() - this.lastAttacker.t < 5000;
            this.onKillFeed?.({
              id: `${this.mp.id}:death:${++this.killSeq}`,
              killer: fresh ? this.lastAttacker!.name : "",
              victim: this.username,
              streak: 0,
              victimStreak: this.killStreak,
              t: Date.now(),
            });
          }
          // The local player died — reset the kill streak (item 11).
          this.killStreak = 0;
        }
        if (this.mode === "local") {
          if (this.wasPlayerAliveLastFrame && !aliveNow) this.restartRun();
        } else if (this.mp) {
          if (this.wasPlayerAliveLastFrame && !aliveNow) {
            // Persist this finished life as one run; the server ranks/keeps each
            // player's BEST run = most kills before dying.
            submitScore({
              username: this.username,
              aliveSeconds: Math.max(
                0,
                Math.round((Date.now() - this.playerAliveSince) / 1000),
              ),
              kills: this.kills,
              endedAt: Date.now(),
            });
            // The run ENDS at death → reset the live kill count to 0 so the
            // online leaderboard (ranked by current-run kills) resets the run.
            this.kills = 0;
            this.mp.updateSelf({ alive: false, kills: 0 });
            // Re-pull persisted records shortly after submitting so the player
            // sees their freshly-recorded run reflected in the leaderboard.
            window.setTimeout(() => this.refreshBestRuns(), 1500);
          } else if (!this.wasPlayerAliveLastFrame && aliveNow) {
            // Respawned: reset alive-time and kills for the new life.
            this.playerAliveSince = Date.now();
            this.kills = 0;
            this.mp.updateSelf({
              alive: true,
              aliveSince: this.playerAliveSince,
              kills: 0,
            });
          }
        }
        this.wasPlayerAliveLastFrame = aliveNow;

        // Notify on health / dead / bot-count change OR every whole second
        const sec = Math.floor(this.elapsed);
        const hp = this.player.getHealth();
        const dead = !aliveNow;
        const botC = this.bots.length;
        const dashC = Math.floor(this.player.getDashCharges());
        const chargeC = Math.round(this.player.getChargeProgress() * 100);
        const respawnSec = Math.ceil(this.player.getRespawnRemaining());
        const slotC = this.player.getWeaponSlot();
        if (
          sec !== lastNotifySecond ||
          hp !== lastHealth ||
          dead !== lastDead ||
          botC !== lastBotCount ||
          dashC !== lastDashCharges ||
          this.kills !== lastKills ||
          this.lastTalking !== lastTalkingFlag ||
          chargeC !== lastCharge ||
          respawnSec !== lastRespawnSec ||
          slotC !== lastSlot
        ) {
          lastNotifySecond = sec;
          lastHealth = hp;
          lastDead = dead;
          lastBotCount = botC;
          lastDashCharges = dashC;
          lastKills = this.kills;
          lastTalkingFlag = this.lastTalking;
          lastCharge = chargeC;
          lastRespawnSec = respawnSec;
          lastSlot = slotC;
          this.notifyStats();
        }
      } else {
        this.clock.getDelta();
      }
      this.renderFrame();
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
    if (this.bestRunsTimer) window.clearInterval(this.bestRunsTimer);
    window.removeEventListener("resize", this.onResize);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.renderer.domElement.removeEventListener("wheel", this.onWheel);
    this.input.dispose();
    this.audio.dispose();
    this.dust.dispose();
    this.bullets.dispose();
    this.smoke.dispose();
    this.grassPoof.dispose();
    // The seed-dependent systems may not exist yet if MP disposed before the
    // world seed arrived — guard each one.
    this.fog?.dispose();
    this.rain?.dispose();
    this.decor?.dispose();
    this.butterflies?.dispose();
    this.gore.dispose();
    this.kame?.dispose();
    this.powerups.dispose();
    this.crates.dispose();
    this.player?.dispose();
    this.clearBots();
    this.featured?.dispose();
    for (const rp of this.remotePlayers.values()) rp.dispose();
    this.remotePlayers.clear();
    this.voice?.dispose();
    if (this.voiceRing) {
      this.scene.remove(this.voiceRing);
      this.voiceRing.geometry.dispose();
      (this.voiceRing.material as THREE.Material).dispose();
    }
    this.mp?.dispose();
    this.skyTexture.dispose();
    this.postfx?.dispose();
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
  dashCharges: number;
  dashMaxCharges: number;
  kills: number;
  mode: GameMode;
  mpConnected: boolean;
  mpLocal: boolean;
  mpPlayers: number;
  /** Round-trip latency to the server in ms (null = unknown / local mode). */
  ping: number | null;
  talking: boolean;
  voiceMode: VoiceMode;
  fireMode: FireMode;
  /** Active hotbar weapon slot: 0=constant, 1=concentrated, 2=staff; -1 in boss. */
  weaponSlot: number;
  /** 0→1 concentrated-shot charge progress (drives the HUD toggle fill). */
  chargeProgress: number;
  /** Whole seconds until the local player respawns (0 while alive). */
  respawnIn: number;
  /** Accumulated BR-style shield charges (0–10), shown under the HP pips. */
  shield: number;
  leaderboard: LeaderboardEntry[];
  /** Online roster (live players + bots) for the players list above the chat. */
  roster: RosterEntry[];
  bestRuns?: LeaderRow[];
  /** Active timed power-up boosts (speed/rapid/shield) for the BoostBar. */
  boosts: { kind: string; label: string; remaining: number; duration: number }[];
}

export interface LeaderboardEntry {
  id: string;
  name: string;
  aliveSince: number;
  kills: number;
  alive: boolean;
  me: boolean;
}

/** One row of the online players list (live players + backfill bots). */
export interface RosterEntry {
  id: string;
  name: string;
  me: boolean;
  /** True for server-spawned backfill bots — surfaced to the "bero" admin view. */
  isBot?: boolean;
}

/** Soft vertical candy-sky gradient used as the scene background. */
function makeSkyGradient(): THREE.CanvasTexture {
  const cnv = document.createElement("canvas");
  cnv.width = 2;
  cnv.height = 256;
  const ctx = cnv.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, "#ffe9f6"); // high sky — light
  g.addColorStop(0.55, "#ffd9ee");
  g.addColorStop(1, "#ffc6e2"); // horizon — warm pink
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(cnv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
