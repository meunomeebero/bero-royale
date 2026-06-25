import type { RoomHub } from "./rooms";
import type { ServerMsg } from "./protocol";

/**
 * Server-driven power-ups.
 *
 * Power-ups are spawned + tracked on the SERVER (one shared set per room) and
 * broadcast to every client, so everyone sees the SAME collectibles in the SAME
 * places — mirroring the BotSim model (one authoritative simulation, fanned out
 * as events). The client just renders the floating pickup and, when the server
 * says a given player took it, applies the effect on that player's machine only.
 *
 * Design (server decides spawns + who picks up; effects live client-side):
 *  - spawn one new power-up every ~12s, capped at MAX_ACTIVE on the map at once;
 *  - random kind, weighted (heal/speed/rapid common, dash/shield/super rarer);
 *  - spawned FAR from players (sample candidates, maximize min-distance) so the
 *    pickup is a small detour, not a freebie at your feet;
 *  - players AND alive bots pick up within PICKUP_RADIUS world units; a human
 *    always wins a contested item (a bot defers if a player is within
 *    PICKUP_CONTEST_RADIUS), and bot effects are applied authoritatively on the bot;
 *  - active power-ups are RE-ANNOUNCED every ~3s so late joiners see them
 *    (clients dedupe "puspawn" by id);
 *  - ONLY runs while >=1 live player is connected (resource gate — mirror BotSim).
 *
 * Wire events (fanned out via hub.fanout):
 *  - "puspawn" { id, kind, x, z }     a new (or re-announced) power-up exists.
 *  - "putake"  { id, kind, by }       player `by` picked up power-up `id`.
 */

// Arena is PLATFORM_GRID(180) * BLOCK_SIZE(0.5) = 90 wide → half 45; keep a margin.
const ARENA_HALF = 40;

/** The only room power-ups populate (matches the bots' GAME_ROOM). */
const GAME_ROOM = "voxelcube-ffa";

/** Spawn cadence: a new power-up roughly this often (seconds). */
const SPAWN_INTERVAL = 5;
/** First power-up appears fast so a fresh lobby isn't barren. */
const FIRST_SPAWN_DELAY = 3;
/** At most this many power-ups active on the map at once (bigger map → more). */
const MAX_ACTIVE = 9;

/**
 * Spatial spawn ZONE per kind, by distance from the map center:
 *  - "center": combat buffs (rapid) spawn where the fighting is.
 *  - "periphery": defensive/mobility FARMING (shield, dash, heal) + crates spawn
 *    at the edges — players ring the outside early to build up shield & dash,
 *    THEN push to the center to fight.
 *  - "any": everywhere (speed).
 */
const KIND_ZONE: Record<string, "center" | "periphery" | "any"> = {
  heal: "periphery",
  rapid: "center",
  shield: "periphery",
  super: "periphery", // repurposed as a shield (see client POWERUP_KINDS)
  speed: "any",
  dash: "periphery",
  crate: "periphery", // crates rain on the outer ring
};
/** Center zone: within this radius of the map center. */
const CENTER_RADIUS = 14;
/** Periphery zone: beyond this radius from the map center. */
const PERIPHERY_RADIUS = 26;

// ── Destructible crates: shoot one CRATE_HP times and it bursts into power-ups ──
const CRATE_HP = 10; // shots to destroy
const CRATE_MAX = 14; // cap so waves don't pile up indefinitely (raised for periphery farming)
const CRATE_WAVE = 4; // crates dropped per cycle (a wave falls together)
const CRATE_INTERVAL = 5; // a wave of crates falls this often (seconds) — faster so the edges stay stocked
const FIRST_CRATE_DELAY = 4; // first wave soon after a player joins
const CRATE_DROPS = 3; // power-ups expelled when a crate bursts
const CRATE_DROP_SPREAD = 3.0; // how far (world units) the drops scatter
/** A player within this many world units of a power-up picks it up. (Generous so
 *  a fast / dashing player skimming the edge between ticks still collects it.) */
const PICKUP_RADIUS = 1.6;
const PICKUP_RADIUS_SQ = PICKUP_RADIUS * PICKUP_RADIUS;
/**
 * Contest yield: a bot takes an item only if NO live player is within this radius
 * of that same item this tick, so a human always wins a contested pickup. Wider
 * than PICKUP_RADIUS so the bot defers BEFORE the player is even close enough to
 * grab it (the human gets the last step uncontested).
 */
const PICKUP_CONTEST_RADIUS = 4;
const PICKUP_CONTEST_RADIUS_SQ = PICKUP_CONTEST_RADIUS * PICKUP_CONTEST_RADIUS;
/** Re-announce every active power-up this often so late joiners see them (seconds). */
const REANNOUNCE_INTERVAL = 3;

/**
 * The 6 kinds, with spawn weights. Common buffs (heal/speed/rapid) are weighted
 * heavier than the punchy rare ones (dash/shield/super) — "boa cadência para não
 * quebrar o jogo". Kind strings are the shared server↔client key.
 */
const KIND_WEIGHTS: { kind: string; weight: number }[] = [
  { kind: "heal", weight: 2 },
  { kind: "speed", weight: 2 },
  { kind: "rapid", weight: 2 },
  { kind: "dash", weight: 2 },
  { kind: "shield", weight: 3 },
  { kind: "super", weight: 1 },
];
const TOTAL_WEIGHT = KIND_WEIGHTS.reduce((s, k) => s + k.weight, 0);

// The sim is ticked from index.ts on the SAME 20 Hz interval as the bots
// (BOT_TICK_SECONDS) — no separate timer. Cadence is time-based (seconds), so the
// tick rate only affects how snappily pickups are detected.

interface ServerPowerUp {
  id: string;
  kind: string;
  x: number;
  z: number;
}

interface ServerCrate {
  id: string;
  x: number;
  z: number;
  hp: number;
}

const rand = () => Math.random();
const clampArena = (v: number) => Math.max(-ARENA_HALF, Math.min(ARENA_HALF, v));

export class PowerUpSim {
  private powerups = new Map<string, ServerPowerUp>(); // GAME_ROOM only
  private seq = 0;
  /** Time until the next spawn attempt (seconds), decremented each tick. */
  private spawnCd = FIRST_SPAWN_DELAY;
  /** Time until the next re-announce of all active power-ups (seconds). */
  private reannounceCd = REANNOUNCE_INTERVAL;
  /** Destructible crates + their spawn countdown. */
  private crates = new Map<string, ServerCrate>();
  private crateCd = FIRST_CRATE_DELAY;

  constructor(private hub: RoomHub) {}

  /** Drop all power-ups + crates (room emptied). Mirrors BotSim.clearRoom. */
  clearRoom(room: string) {
    if (room === GAME_ROOM) {
      this.powerups.clear();
      this.crates.clear();
      this.spawnCd = FIRST_SPAWN_DELAY;
      this.crateCd = FIRST_CRATE_DELAY;
      this.reannounceCd = REANNOUNCE_INTERVAL;
    }
  }

  // ---------------------------------------------------------------------------

  /** Roll a weighted-random kind. */
  private pickKind(): string {
    let r = rand() * TOTAL_WEIGHT;
    for (const k of KIND_WEIGHTS) {
      r -= k.weight;
      if (r <= 0) return k.kind;
    }
    return KIND_WEIGHTS[0].kind;
  }

  /** A random point whose distance-from-center matches the requested zone. */
  private pointInZone(zone: "center" | "periphery" | "any"): { x: number; z: number } {
    const ang = rand() * Math.PI * 2;
    let r: number;
    if (zone === "center") r = rand() * CENTER_RADIUS;
    else if (zone === "periphery") r = PERIPHERY_RADIUS + rand() * (ARENA_HALF - PERIPHERY_RADIUS);
    else r = rand() * ARENA_HALF;
    return { x: Math.cos(ang) * r, z: Math.sin(ang) * r };
  }

  /**
   * A spawn point in the kind's ZONE (center / periphery / any), sampled to stay
   * away from players so an item never drops right on someone.
   */
  private pickSpawn(room: string, kind: string): { x: number; z: number } {
    const zone = KIND_ZONE[kind] ?? "any";
    const players = this.hub.playerTargets(room);
    let best = this.pointInZone(zone);
    let bestD = -1;
    for (let i = 0; i < 12; i++) {
      const c = this.pointInZone(zone);
      let minD = Infinity;
      for (const p of players) {
        const d = (c.x - p.x) ** 2 + (c.z - p.z) ** 2;
        if (d < minD) minD = d;
      }
      const score = players.length === 0 ? rand() : minD;
      if (score > bestD) {
        bestD = score;
        best = c;
      }
    }
    return best;
  }

  private spawnPowerUp(room: string) {
    const id = `srvpu_${this.seq++}`;
    const kind = this.pickKind();
    const pos = this.pickSpawn(room, kind);
    const pu: ServerPowerUp = { id, kind, x: pos.x, z: pos.z };
    this.powerups.set(id, pu);
    this.announce(room, pu);
  }

  /** Broadcast a single power-up's existence (spawn or re-announce). */
  private announce(room: string, pu: ServerPowerUp) {
    this.fanout(room, "puspawn", { id: pu.id, kind: pu.kind, x: pu.x, z: pu.z });
  }

  private fanout(room: string, event: string, payload: unknown) {
    const msg: ServerMsg = { t: "broadcast", event, payload, from: "" };
    this.hub.fanout(room, msg);
  }

  /**
   * Advance the power-up sim by `dt`: maintain the spawn cadence, detect
   * player pickups, and periodically re-announce active power-ups. Driven by
   * index.ts on the SAME interval as the bot sim. Runs only while >=1 live
   * player is connected (resource gate — mirror BotSim).
   */
  tick(room: string, dt: number) {
    if (room !== GAME_ROOM) return;

    // Resource gate: no power-ups in an empty room (no live REAL player).
    const live = this.hub.liveSizeOf(room);
    if (live <= 0) {
      // If everyone left, abandon any orphaned power-ups (they'll re-spawn fresh
      // once players return). Reset the cadence so the next cohort isn't starved.
      if (this.powerups.size > 0 || this.crates.size > 0) {
        this.powerups.clear();
        this.crates.clear();
        this.spawnCd = FIRST_SPAWN_DELAY;
        this.crateCd = FIRST_CRATE_DELAY;
        this.reannounceCd = REANNOUNCE_INTERVAL;
      }
      return;
    }

    const players = this.hub.playerTargets(room);
    // Bots can ALSO pick up items now (additive second pass, players win contests).
    const bots = this.hub.botSim.botTargets(room);

    // ── Pickup detection ──
    // PASS 1 (players first — they always win a contested item): any alive player
    // within PICKUP_RADIUS takes it.
    if (this.powerups.size > 0 && players.length > 0) {
      for (const pu of [...this.powerups.values()]) {
        for (const p of players) {
          const d2 = (p.x - pu.x) ** 2 + (p.z - pu.z) ** 2;
          if (d2 <= PICKUP_RADIUS_SQ) {
            this.powerups.delete(pu.id);
            // Power-ups that touch authoritative HP/shield MUST mutate server
            // state (not just the client prediction) — otherwise the next "hp"
            // sync reverts them. Shield/super accumulate shield; heal restores HP.
            if (pu.kind === "shield" || pu.kind === "super") {
              this.hub.addShield(room, p.id);
            } else if (pu.kind === "heal") {
              this.hub.healPlayer(room, p.id);
            }
            this.fanout(room, "putake", { id: pu.id, kind: pu.kind, by: p.id });
            break; // this power-up is gone; move to the next one
          }
        }
      }
    }

    // PASS 2 (bots): an alive bot within PICKUP_RADIUS takes a remaining item, but
    // ONLY if NO live player is contesting it (within PICKUP_CONTEST_RADIUS) — a
    // human always gets the contested grab. The effect is applied AUTHORITATIVELY
    // on the bot (BotSim owns bot health/shield/buffs); the "putake" fanout makes
    // every client remove the visual (Game.ts applies NO effect for a bot `by`).
    if (this.powerups.size > 0 && bots.length > 0) {
      for (const pu of [...this.powerups.values()]) {
        // Contest check: skip this item entirely if a live player is near it.
        let contested = false;
        for (const p of players) {
          if ((p.x - pu.x) ** 2 + (p.z - pu.z) ** 2 <= PICKUP_CONTEST_RADIUS_SQ) {
            contested = true;
            break;
          }
        }
        if (contested) continue;
        for (const bt of bots) {
          const d2 = (bt.x - pu.x) ** 2 + (bt.z - pu.z) ** 2;
          if (d2 <= PICKUP_RADIUS_SQ) {
            this.powerups.delete(pu.id);
            this.hub.botSim.applyBotPickup(room, bt.id, pu.kind);
            this.fanout(room, "putake", { id: pu.id, kind: pu.kind, by: bt.id });
            break; // this power-up is gone; move to the next one
          }
        }
      }
    }

    // ── Spawn cadence: one new power-up every ~SPAWN_INTERVAL, capped MAX_ACTIVE ──
    this.spawnCd -= dt;
    if (this.spawnCd <= 0) {
      this.spawnCd = SPAWN_INTERVAL;
      if (this.powerups.size < MAX_ACTIVE) this.spawnPowerUp(room);
    }

    // ── Crate cadence: a WAVE of CRATE_WAVE crates every CRATE_INTERVAL, each at
    //    a random spot, capped at CRATE_MAX total so they don't pile up forever ──
    this.crateCd -= dt;
    if (this.crateCd <= 0) {
      this.crateCd = CRATE_INTERVAL;
      const n = Math.min(CRATE_WAVE, CRATE_MAX - this.crates.size);
      for (let i = 0; i < n; i++) this.spawnCrate(room);
    }

    // ── Re-announce active power-ups + crates periodically (late joiners dedupe by id) ──
    this.reannounceCd -= dt;
    if (this.reannounceCd <= 0) {
      this.reannounceCd = REANNOUNCE_INTERVAL;
      for (const pu of this.powerups.values()) this.announce(room, pu);
      for (const cr of this.crates.values()) this.announceCrate(room, cr);
    }
  }

  /**
   * Active power-ups as {id,kind,x,z} for the bot AI to value + seek (NOT crates).
   * One-directional exposure: BotSim reads this ONCE per tick (not per bot) via
   * hub.powerupSim, so the combat sim never imports PowerUpSim types (no circular
   * import). Mirrors the read-only shape RoomHub.playerTargets exposes to bots.
   */
  botItemTargets(room: string): { id: string; kind: string; x: number; z: number }[] {
    if (room !== GAME_ROOM) return [];
    const out: { id: string; kind: string; x: number; z: number }[] = [];
    for (const pu of this.powerups.values()) {
      out.push({ id: pu.id, kind: pu.kind, x: pu.x, z: pu.z });
    }
    return out;
  }

  // ── Crates ──────────────────────────────────────────────────────────────

  /** True if `id` is an active crate (so the hit handler routes here, not applyHit). */
  hasCrate(room: string, id: string): boolean {
    return room === GAME_ROOM && this.crates.has(id);
  }

  /**
   * A player shot a crate. Decrement its HP; when it reaches 0 the crate bursts
   * (clients play the white voxel-smoke explosion) and scatters CRATE_DROPS
   * power-ups around its spot.
   */
  hitCrate(room: string, id: string) {
    if (room !== GAME_ROOM) return;
    const cr = this.crates.get(id);
    if (!cr) return;
    cr.hp -= 1;
    if (cr.hp > 0) return;
    this.crates.delete(id);
    this.fanout(room, "crexplode", { id: cr.id, x: cr.x, z: cr.z });
    // Expel power-ups from the burst spot (bypasses MAX_ACTIVE — it's a burst).
    // The puspawn carries the crate center (fx,fz) so clients animate each item
    // FLYING OUT of the smoke to its resting spot.
    for (let i = 0; i < CRATE_DROPS; i++) {
      const ang = rand() * Math.PI * 2;
      const r = 1.2 + rand() * CRATE_DROP_SPREAD;
      const pu: ServerPowerUp = {
        id: `srvpu_${this.seq++}`,
        kind: this.pickKind(),
        x: clampArena(cr.x + Math.cos(ang) * r),
        z: clampArena(cr.z + Math.sin(ang) * r),
      };
      this.powerups.set(pu.id, pu);
      this.fanout(room, "puspawn", {
        id: pu.id,
        kind: pu.kind,
        x: pu.x,
        z: pu.z,
        fx: cr.x,
        fz: cr.z,
      });
    }
  }

  private spawnCrate(room: string) {
    const id = `srvcr_${this.seq++}`;
    const pos = this.pickSpawn(room, "crate"); // crate zone = periphery (KIND_ZONE)
    const cr: ServerCrate = { id, x: pos.x, z: pos.z, hp: CRATE_HP };
    this.crates.set(id, cr);
    this.announceCrate(room, cr);
  }

  private announceCrate(room: string, cr: ServerCrate) {
    this.fanout(room, "crspawn", { id: cr.id, x: cr.x, z: cr.z });
  }
}
