import { createRoom, type Room, type RoomKind, type RoomMeta } from "./Room";

export type MpStatus = "connecting" | "online" | "error";

/** Fast-path per-frame state broadcast. */
export interface NetState {
  id: string;
  name: string;
  animal: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  health: number;
  alive: boolean;
  /** Velocity components for dead-reckoning + speed-distort + lean + jump/fall arc. */
  vx: number;
  vz: number;
  vy: number;
  /** Ground-squash vs airborne lerp; footstep/jump audio inference. */
  grounded: boolean;
  /** Remote animation state ("falling" drives the off-edge tumble). */
  state: "alive" | "falling" | "dead";
  /** True while this player is winding up the charged special (drives the
   *  visible charge VFX on every other client). */
  charging?: boolean;
  /** Charge progress 0→1 (so remotes grow the orb to full as it nears ready). */
  chargeT?: number;
  /**
   * True = live socket present on the server; false = grace-window still-avatar
   * (server keeps the player alive during GRACE_MS after socket close).
   * Optional: absent or true on self-broadcast frames; false only when the server
   * marks a player as AFK/disconnected but still within the grace window.
   */
  present?: boolean;
  /**
   * Monotonic per-remote receive counter stamped at net ingress (NOT on the
   * wire). The reconcile loop runs at ~60Hz over a Map that only holds the
   * LATEST packet, so without this each genuine ~33ms packet would be re-pushed
   * ~2x into the interp buffer with identical pose but fresh timestamps,
   * collapsing the interpolation window. Game.ts only calls rp.setState() when
   * this value changed since last consumed. Absent = not yet stamped.
   */
  recvSeq?: number;
}

/** Instant "shot" event — drives the visual bullet + spatial shot SFX on remotes. */
export interface ShotEvent {
  id: string;
  origin: { x: number; y: number; z: number };
  dir: { x: number; y: number; z: number };
  color: string;
}

/** Instant "dash" event — drives the remote dash stretch + facing turn. */
export interface DashEvent {
  id: string;
  dir: number;
}

/** Instant "jump" event — drives the remote jump stretch juice. */
export interface JumpEvent {
  id: string;
}

/** Instant "died" event — carries the death position so gore spawns at the spot. */
export interface DiedEvent {
  id: string;
  x: number;
  z: number;
  /** Who landed the kill (server-stamped). Lets the killer's client react. */
  by?: string;
}

/** Real-time chat message event. */
export interface ChatEvent {
  id: string;
  name: string;
  text: string;
}

/** Kill feed event — broadcast when a player kills another. */
export interface KillEvent {
  id: string;
  killer: string;
  victim: string;
  streak: number;
}

/** Instant kamehameha cast — drives the beam + charge visual on remotes. */
export interface KameEvent {
  id: string;
  origin: { x: number; y: number; z: number };
  dir: { x: number; y: number; z: number };
}

/** A kamehameha landed on `target` — that client launches off + dies. */
export interface KameHitEvent {
  id: string; // caster
  target: string; // victim id
  dir: { x: number; y: number; z: number };
}

/** Server announced a new power-up on the map (drives the floating pickup). */
export interface PowerupSpawnEvent {
  id: string;
  kind: string;
  x: number;
  z: number;
  /** Crate-burst origin (x,z): when present, the item flies OUT from here. */
  fx?: number;
  fz?: number;
}

/** A player picked up a power-up — the recipient applies the effect locally. */
export interface PowerupTakeEvent {
  id: string;
  kind: string;
  by: string; // player id who took it
}

/** Server announced a destructible crate (shoot it to burst it into power-ups). */
export interface CrateSpawnEvent {
  id: string;
  x: number;
  z: number;
}

/** A crate was shot enough to burst — clients play the smoke + remove it. */
export interface CrateExplodeEvent {
  id: string;
  x: number;
  z: number;
}

/** Slow-path metadata tracked via presence (drives the leaderboard). */
export interface PresenceInfo {
  id: string;
  name: string;
  aliveSince: number; // epoch ms the current life started (lower = alive longer)
  kills: number;
  alive: boolean;
  /** True for server-spawned backfill bots (false/absent for real players). */
  isBot?: boolean;
}

const ROOM = "voxelcube-ffa";

/**
 * Online free-for-all over a pluggable {@link Room} transport: presence carries
 * leaderboard metadata (name / aliveSince / kills); broadcast carries fast
 * position+aim updates. Works locally (BroadcastChannel, two tabs) with zero
 * config, or cross-machine over the bundled WebSocket backend.
 */
export class Multiplayer {
  readonly id: string;
  readonly name: string;
  private animal: string;
  status: MpStatus = "connecting";

  private room: Room;
  private remote = new Map<string, NetState>();
  private presence = new Map<string, PresenceInfo>();
  private self: PresenceInfo;
  private onHit?: (targetId: string, fromId: string, fromName: string) => void;
  private seed: number | null = null;
  private seedHandler?: (seed: number) => void;
  private onShot?: (e: ShotEvent) => void;
  private onDash?: (e: DashEvent) => void;
  private onJump?: (e: JumpEvent) => void;
  private onDied?: (e: DiedEvent) => void;
  private onChat?: (e: ChatEvent) => void;
  private onKill?: (e: KillEvent) => void;
  private onKame?: (e: KameEvent) => void;
  private onKameHit?: (e: KameHitEvent) => void;
  private onPowerupSpawn?: (e: PowerupSpawnEvent) => void;
  private onPowerupTake?: (e: PowerupTakeEvent) => void;
  private onCrateSpawn?: (e: CrateSpawnEvent) => void;
  private onCrateExplode?: (e: CrateExplodeEvent) => void;

  constructor(id: string, name: string, animal: string) {
    this.id = id;
    this.name = name;
    this.animal = animal;
    this.self = { id, name, aliveSince: Date.now(), kills: 0, alive: true };
    this.room = createRoom(ROOM, id);
  }

  /** "local" = same-browser BroadcastChannel; "online" = WebSocket cross-machine. */
  get kind(): RoomKind {
    return this.room.kind;
  }

  setHitHandler(cb: (targetId: string, fromId: string, fromName: string) => void) {
    this.onHit = cb;
  }

  /**
   * Set the broadcast animal. The local avatar is chosen by the seed-gated
   * Player build (after Multiplayer is constructed), so Game calls this with
   * `player.getAnimal()` once the world is built — otherwise remotes would see
   * a different animal than the one rendered locally.
   */
  setAnimal(animal: string) {
    this.animal = animal;
  }

  setShotHandler(cb: (e: ShotEvent) => void) {
    this.onShot = cb;
  }

  setDashHandler(cb: (e: DashEvent) => void) {
    this.onDash = cb;
  }

  setJumpHandler(cb: (e: JumpEvent) => void) {
    this.onJump = cb;
  }

  setDiedHandler(cb: (e: DiedEvent) => void) {
    this.onDied = cb;
  }

  /** Register a handler for incoming chat messages from other players. */
  setChatHandler(cb: (e: ChatEvent) => void) {
    this.onChat = cb;
  }

  /** Register a handler for kill feed events. */
  setKillHandler(cb: (e: KillEvent) => void) {
    this.onKill = cb;
  }

  /** Register a handler for incoming kamehameha casts (beam visual). */
  setKameHandler(cb: (e: KameEvent) => void) {
    this.onKame = cb;
  }

  /** Register a handler for incoming kamehameha hits (launch self if targeted). */
  setKameHitHandler(cb: (e: KameHitEvent) => void) {
    this.onKameHit = cb;
  }

  /** Register a handler for power-up spawns (render the floating pickup). */
  setPowerupSpawnHandler(cb: (e: PowerupSpawnEvent) => void) {
    this.onPowerupSpawn = cb;
  }

  /** Register a handler for power-up pickups (remove + apply if we took it). */
  setPowerupTakeHandler(cb: (e: PowerupTakeEvent) => void) {
    this.onPowerupTake = cb;
  }

  setCrateSpawnHandler(cb: (e: CrateSpawnEvent) => void) {
    this.onCrateSpawn = cb;
  }

  setCrateExplodeHandler(cb: (e: CrateExplodeEvent) => void) {
    this.onCrateExplode = cb;
  }

  /** The authoritative world seed, or null until the welcome frame arrives. */
  getSeed(): number | null {
    return this.seed;
  }

  /**
   * Register the seed callback. Fires immediately if the seed already arrived
   * (welcome can land before the game registers its handler).
   */
  setSeedHandler(cb: (seed: number) => void) {
    this.seedHandler = cb;
    if (this.seed != null) cb(this.seed);
  }

  connect() {
    this.status = "connecting";
    this.room.track(this.self as unknown as RoomMeta);
    this.room.connect({
      onStatus: (s) => {
        this.status = s === "online" ? "online" : s === "error" ? "error" : "connecting";
      },
      onSeed: (s) => {
        this.seed = s;
        this.seedHandler?.(s);
      },
      onPresence: (members) => {
        this.presence.clear();
        for (const [pid, meta] of members) {
          this.presence.set(pid, meta as unknown as PresenceInfo);
        }
        // NOTE: We do NOT prune remote render-states on presence absence.
        // Avatar existence is now driven by the server's authoritative state
        // frames (with grace window support). Only truly expired players
        // (absent from both presence AND state after grace) are disposed in Game.ts.
        // Update the present flag on any existing remote states from presence meta.
        for (const [pid, info] of this.presence) {
          const existing = this.remote.get(pid);
          if (existing) {
            const presentFlag = (info as unknown as Record<string, unknown>)["present"];
            existing.present = typeof presentFlag === "boolean" ? presentFlag : true;
          }
        }
      },
      onMessage: {
        s: (payload) => {
          const st = payload as NetState;
          if (st && st.id !== this.id) {
            // Populate `present` from the presence roster if the server-relayed
            // "s" frame does not carry the field (older server builds).
            if (typeof st.present !== "boolean") {
              const presInfo = this.presence.get(st.id);
              const presentFlag = presInfo
                ? (presInfo as unknown as Record<string, unknown>)["present"]
                : undefined;
              st.present = typeof presentFlag === "boolean" ? presentFlag : true;
            }
            // Stamp a monotonic per-remote receive counter so the ~60Hz
            // reconcile loop can skip re-pushing a packet it already consumed
            // (the Map only keeps the latest "s"). Continue from the previous
            // stored seq so respawn/replacement frames keep advancing.
            const prev = this.remote.get(st.id);
            st.recvSeq = (prev?.recvSeq ?? 0) + 1;
            this.remote.set(st.id, st);
          }
        },
        hit: (payload) => {
          // Legacy broadcast "hit" path — still handled for observer flash tint
          // even though damage is now server-authoritative via sendHit.
          const p = payload as { target: string; from: string; fromName: string };
          if (p && this.onHit) this.onHit(p.target, p.from, p.fromName);
        },
        shot: (payload) => {
          const e = payload as ShotEvent;
          if (e && e.id !== this.id) this.onShot?.(e);
        },
        dash: (payload) => {
          const e = payload as DashEvent;
          if (e && e.id !== this.id) this.onDash?.(e);
        },
        jump: (payload) => {
          const e = payload as JumpEvent;
          if (e && e.id !== this.id) this.onJump?.(e);
        },
        died: (payload) => {
          const e = payload as DiedEvent;
          // Pass self-deaths through too: the server fans "died" out to ALL
          // (including the victim) so the victim's client can apply the
          // authoritative kill even if it missed the throttled "hit" cues.
          if (e) this.onDied?.(e);
        },
        chat: (payload) => {
          const e = payload as ChatEvent;
          // id-guard: server never echoes back to sender, but guard for LocalRoom path.
          if (e && e.id !== this.id) this.onChat?.(e);
        },
        kill: (payload) => {
          const e = payload as KillEvent;
          // Relay kill events to all observers (including the killer).
          if (e) this.onKill?.(e);
        },
        kame: (payload) => {
          const e = payload as KameEvent;
          if (e && e.id !== this.id) this.onKame?.(e);
        },
        kamehit: (payload) => {
          const e = payload as KameHitEvent;
          if (e && e.id !== this.id) this.onKameHit?.(e);
        },
        puspawn: (payload) => {
          const e = payload as PowerupSpawnEvent;
          // Global event: server fans out to ALL (incl. late joiners re-announces).
          // No id-guard; clients dedupe floating pickups by id.
          if (e) this.onPowerupSpawn?.(e);
        },
        putake: (payload) => {
          const e = payload as PowerupTakeEvent;
          // Global event: fanned out to ALL so everyone removes the pickup; the
          // recipient (by === self) additionally applies the effect in Game.
          if (e) this.onPowerupTake?.(e);
        },
        crspawn: (payload) => {
          const e = payload as CrateSpawnEvent;
          // Global; clients dedupe crates by id (handles late-joiner re-announces).
          if (e) this.onCrateSpawn?.(e);
        },
        crexplode: (payload) => {
          const e = payload as CrateExplodeEvent;
          if (e) this.onCrateExplode?.(e);
        },
      },
    });
  }

  /** Fast per-frame position/aim broadcast. */
  broadcast(state: Omit<NetState, "id" | "name" | "animal">) {
    this.room.broadcast("s", {
      id: this.id,
      name: this.name,
      animal: this.animal,
      ...state,
    });
  }

  /**
   * Report a hit to the SERVER (server-authoritative damage path).
   * The server applies damage to the target and broadcasts "died" if health
   * reaches 0. Also broadcasts "hit" to observers for instant damage tint.
   * Falls back gracefully if the Room transport does not support sendHit.
   */
  sendHit(targetId: string) {
    // Server-authoritative path: the server owns health/alive.
    this.room.sendHit(targetId);
    // Also fan-out a broadcast "hit" so remote observers get the flash-tint cue
    // even before the server's authoritative health update arrives on the next "s".
    this.room.broadcast("hit", {
      target: targetId,
      from: this.id,
      fromName: this.name,
    });
  }

  /** Broadcast a shot (instant, bypasses the snapshot throttle). */
  sendShot(
    origin: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
    color: string,
  ) {
    this.room.broadcast("shot", { id: this.id, origin, dir, color });
  }

  /** Broadcast a dash with its facing yaw (atan2(dz, dx)). */
  sendDash(dir: number) {
    this.room.broadcast("dash", { id: this.id, dir });
  }

  /** Broadcast a jump for the instant remote stretch juice. */
  sendJump() {
    this.room.broadcast("jump", { id: this.id });
  }

  /** Broadcast our death position so remotes spawn gore at the spot. */
  sendDied(x: number, z: number) {
    this.room.broadcast("died", { id: this.id, x, z });
  }

  /**
   * Broadcast a chat message to all other players in the room.
   * Text is trimmed and capped at 200 characters; empty strings are ignored.
   * The server never echoes back to the sender, so the ChatPanel appends
   * the sender's own message client-side on send.
   */
  sendChat(text: string) {
    const t = text.trim().slice(0, 200);
    if (!t) return;
    this.room.broadcast("chat", { id: this.id, name: this.name, text: t });
  }

  /**
   * Broadcast a kill-feed event carrying the killer's id/name plus the victim
   * name and current kill streak. Wired like sendShot — instant, bypasses the
   * snapshot throttle.
   */
  sendKill(eventId: string, victimName: string, streak: number) {
    this.room.broadcast("kill", {
      id: eventId,
      killer: this.name,
      victim: victimName,
      streak,
    });
  }

  /** Broadcast a kamehameha cast so remotes render the beam. */
  sendKame(
    origin: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
  ) {
    this.room.broadcast("kame", { id: this.id, origin, dir });
  }

  /** Tell `targetId` it was hit by our kamehameha (it launches off + dies). */
  sendKameHit(targetId: string, dir: { x: number; y: number; z: number }) {
    this.room.broadcast("kamehit", { id: this.id, target: targetId, dir });
  }

  /** Update presence metadata (e.g. on respawn or after a kill). */
  updateSelf(patch: Partial<PresenceInfo>) {
    this.self = { ...this.self, ...patch };
    this.room.track(this.self as unknown as RoomMeta);
  }

  getRemoteStates(): Map<string, NetState> {
    return this.remote;
  }

  getPresence(): Map<string, PresenceInfo> {
    return this.presence;
  }

  /**
   * Online players sorted by kills descending (highest-kill first).
   * Tiebreak: longest alive-time wins (lower aliveSince = alive longer).
   * Dead players rank below alive players at equal kills.
   */
  getLeaderboard(): PresenceInfo[] {
    return [...this.presence.values()].sort((a, b) => {
      // Primary: kills descending
      const killDiff = (b.kills ?? 0) - (a.kills ?? 0);
      if (killDiff !== 0) return killDiff;
      // Secondary: alive beats dead
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      // Tertiary: longest surviving (earlier aliveSince) wins
      return a.aliveSince - b.aliveSince;
    });
  }

  getPlayerCount(): number {
    return this.presence.size;
  }

  /** Round-trip latency to the server in ms (null = unknown / local room). */
  getPing(): number | null {
    return this.room.getPing();
  }

  dispose() {
    this.room.dispose();
    this.remote.clear();
    this.presence.clear();
  }
}
