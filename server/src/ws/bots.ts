import type { RoomHub } from "./rooms";
import type { ServerMsg } from "./protocol";

/**
 * Server-driven bots.
 *
 * Bots are simulated on the SERVER (one shared set per room) and broadcast as
 * pseudo-players: they appear in presence (so every client renders them as
 * remote avatars, counts them, and lists them) and the server streams their
 * movement/shooting. This makes the lobby feel alive and CONSISTENT across all
 * clients — unlike the old client-local bots, everyone sees the same bots.
 *
 * Simplifications (the candy-meadow arena is flat, 60×60, no lava):
 *  - movement is XZ on a flat plane; vertical motion is a real (server-side)
 *    gravity arc for JUMPS so the client renders an airborne squash + lands SFX.
 *  - shooting is hitscan with an accuracy roll (no server bullet simulation);
 *    a "shot" tracer is broadcast for the visuals.
 *  - damage routing: bot→player reuses the server hit path (+ a "hit" cue so the
 *    victim predicts); bot→bot is resolved here. Player→bot rides the existing
 *    client hit relay (bots are remotes → bullets hit them → {t:"hit"}).
 *
 * AI behaviour (tuned to read as skilled players, not bullet-sponges):
 *  - smooth acceleration toward a desired velocity (no instant snapping);
 *  - CIRCLE-STRAFE around the target at engagement range instead of standing
 *    still, with a per-bot strafe direction so they don't all orbit identically;
 *  - JUMP to dodge when recently shot / low HP, to chase, or just for life;
 *  - DASH to dodge incoming fire, close a big gap, or retreat when low HP;
 *  - aim leads the target slightly using its velocity; fire cadence varies;
 *  - bots spread out from each other (a gentle separation push).
 */

// Arena is PLATFORM_GRID(180) * BLOCK_SIZE(0.5) = 90 wide → half 45; keep a margin.
const ARENA_HALF = 42;
// Flat ground root height: surfaceY(0.5) + RemotePlayer HALF_HEIGHT(0.25).
const GROUND_Y = 0.75;
const MUZZLE_Y = GROUND_Y + 0.3;

const MAX_HEALTH = 10;
const MOVE_SPEED = 4.6; // base ground speed (bots are a touch slower than players on purpose)
const ACCEL = 22; // how fast vx/vz chase the desired velocity (units/s²-ish) → smooth, not snappy
const ENGAGE_DIST = 5.2; // hold around this range from the target (tighter orbit → more pressure)
const ENGAGE_BAND = 1.2; // dead-band around ENGAGE_DIST where the bot circle-strafes
const SHOOT_RANGE = 10; // = 2 × hearing radius (matches bullet reach)
const SHOOT_CD_MIN = 0.55; // gentler: a touch slower trigger than the old 0.4
const SHOOT_CD_RND = 0.5; // + cadence variety
const ACCURACY = 0.3; // gentler: fewer shots connect (was 0.42) → readable pressure, not a wall
const LEAD_FACTOR = 0.12; // how far ahead of a moving target the bot aims (seconds of lead)
const RETARGET_CD = 0.6; // re-pick nearest enemy this often
const RESPAWN_MS = 5000;
const WANDER_CD = 2.5;

// ── Vertical physics (mirrors the player feel in src/game/consts.ts) ─────────
const GRAVITY = 18.0;
const JUMP_VELOCITY = 6.0;

// ── Jump tuning ──────────────────────────────────────────────────────────────
const JUMP_CD_MIN = 1.8; // shortest gap between a bot's jumps
const JUMP_CD_RND = 2.6; // + random spread (so jumps don't sync across bots)
const JUMP_IDLE_CHANCE = 0.08; // per eligible tick: a liveliness hop while just moving
const JUMP_DODGE_CHANCE = 0.55; // per eligible tick: hop when recently shot at / low HP

// ── Dash tuning ──────────────────────────────────────────────────────────────
const DASH_CD_MIN = 2.4; // shortest gap between a bot's dashes
const DASH_CD_RND = 2.6; // + random spread
const DASH_SPEED = 14; // initial dash impulse speed (decays each tick)
const DASH_DECAY = 7; // exponential decay rate of the dash impulse (per second)
const DASH_DURATION = 0.42; // how long the impulse is tracked before it's considered spent
const DASH_DODGE_CHANCE = 0.5; // per eligible tick: dash when recently shot at
const DASH_GAP_DIST = 13; // beyond this range a bot may dash to close the gap
const DASH_RETREAT_HP = 3; // at/below this HP a bot favours dashing away to kite

// ── "Recently shot at" memory (drives dodge urgency) ─────────────────────────
const THREAT_DECAY = 1.4; // seconds the threat flag lingers after taking fire

// ── SUPER (telegraphed kamehameha) ───────────────────────────────────────────
// A dodgeable, server-resolved mega beam. The bot commits to a ~1.2s wind-up
// (driving the client charge glow via the "s" snapshot's charging/chargeT), then
// fires a lethal hitscan along the aim — a player who dashed/jumped clear takes 0.
const SUPER_RANGE = 9; // only enter/fire within this range of the target
const SUPER_ABORT_RANGE = 11; // mid-charge: abort if the target slips past this
const SUPER_CONE_HALF_WIDTH = 1.4; // point-to-ray half-width (≈14° cone) for the hit test
const SUPER_CHARGE = 1.2; // wind-up duration (product-locked telegraph)
const SUPER_CHARGE_SPEED = 1.0; // capped move speed while charging (drifts, not frozen)
const SUPER_REARM = 2.5; // short re-arm after an aborted (wasted) charge
const SUPER_CD_MIN = 14; // cooldown floor after firing (gentler: supers ~half as frequent)
const SUPER_CD_MAX = 22; // cooldown ceiling after firing (random in [MIN,MAX])
/** Concentrated-super damage — soaked shield-first then HP, 3 of a 10-bar →
 *  ~4 unshielded hits to kill. Shared by the bot super (here) AND the player
 *  super (index.ts resolves a "kamehit" on a player with this same amount), so
 *  both paths use one shield-first model. Mirror of the client headline. */
export const SUPER_DAMAGE = 3;
/**
 * Fixed reveal delay for a super's damage. The kame beam is near-instant VISUALLY
 * (a beam, not a BULLET_SPEED point projectile), so its damage lands a short fixed
 * time after the beam/blast FX appears — NOT dist/BULLET_SPEED. Scheduled via the
 * impact-tick queue so the victim sees the beam before taking it. The dodge gate
 * still resolves at FIRE time (the locked dash/jump dodge promise). Phase 4 of
 * docs/systems/netcode-hit-sync-plan.md.
 */
const SUPER_REVEAL_MS = 120;
const SUPER_MIN_HP = 2; // below this a bot won't telegraph / aborts mid-charge

// ── Saber stagger (a player's melee hit on a server bot) — canonical, server-side ──
// Mirrors the client saber stagger (src/game/Game.ts). Applied authoritatively by
// staggerBot() when a "meleehit" targets a server bot; durations are server-owned
// (the client cue is NOT trusted for values), so a forged meleehit can't over-stun.
const MELEE_STUN_T = 0.25; // brief full-action freeze (no steering/fire/super)
const MELEE_FIRE_LOCK_T = 1.0; // constant-fire lockout (no shots) after the stun
const MELEE_SUPER_REARM = 1.0; // an interrupted super can't re-wind for this long
const MELEE_STAGGER_FREE_MS = 500; // guaranteed un-staggerable window after each stagger

// ── Engager cap (anti-dogpile, owner-locked) ─────────────────────────────────
// In a lopsided fight (1 human vs N bots) every bot would otherwise lock onto the
// lone player, close in, and fire — an unfair ~6 hits/sec wall plus overlapping
// super telegraphs. To keep the pressure fair, only the NEAREST few bots per
// player are "engagers" (allowed to fire / close / telegraph a super); the rest
// hang back at a loose orbit (no fire, no super), so the player faces a readable
// front line instead of a swarm. Ranking is by distance² → fully deterministic.
const MAX_ENGAGERS_PER_PLAYER = 3; // nearest bots that may fire/close on a player (gentler: was 4)
// At most ONE bot may charge a super per player (the per-player super slot below);
// this is product-locked, so it's enforced by a single-holder map, not a tunable.
const STANDOFF_DIST = 9; // non-engagers loosely orbit at ~this range (back of the line)
const STANDOFF_BAND = 1.5; // dead-band around STANDOFF_DIST before a non-engager re-closes

// ── Aggression / engagement tune (owner-locked) ──────────────────────────────
// Tighter orbit + snappier, more accurate fire than the original baseline, so a
// fight reads as pressure without turning bots into snipers (TTK still a couple
// seconds at MAX_HEALTH=10 with the varied cadence).
const ENGAGE_LEASH = 12; // an enemy within this keeps/forces ENGAGE (SEEK→ENGAGE trigger radius)
const AGGRO_BREAK_DIST = 7; // any enemy this close cancels item-seek (no pacifism)
const LOW_HP = 4; // gates desperation heal/shield-seek (above DASH_RETREAT_HP so the kite bias is intact)
// Target stickiness: only switch once the new pick is at least this much closer (anti-flicker).
const TARGET_SWITCH_HYSTERESIS = 1.5;

// ── Target commitment (anti-ping-pong) ───────────────────────────────────────
// After acquiring a NEW target id, a bot holds it for commitT seconds before
// re-evaluating. Skill ranges 0..1 → commitT 0.8..1.6s (weaker bots are stickier).
const COMMIT_MIN = 0.8, COMMIT_SPAN = 0.8; // commitT = COMMIT_MIN + (1-skill)*COMMIT_SPAN → 0.8..1.6s

// ── HUNT center gravitation (owner-locked) ───────────────────────────────────
// Idle bots drift to a jittered RING around origin (where the rare/strong items
// — super/shield/rapid — spawn) instead of stacking on (0,0), so 10 bots ring
// the item-rich center and the arena reads as a contested hotspot. A minority
// still scatter so the periphery (heals) isn't a dead zone.
const CENTER_RING_MIN = 4; // inner radius of the idle ring
const CENTER_RING_MAX = 12; // outer radius of the idle ring
const CENTER_BIAS_CHANCE = 0.65; // fraction of HUNT wander points placed on the ring

// ── Item seeking + pickup (Slice 2) ──────────────────────────────────────────
// Bots opportunistically walk over map power-ups when not under pressure. The
// pickup itself is resolved authoritatively in powerups.ts (PICKUP_RADIUS); this
// layer only decides WHERE a bot wants to be and applies the granted effect.
const SEEK_RADIUS = 22; // only chase items within this range (a reasonable detour)
const HEAL_SEEK_RADIUS = 30; // a hurt bot reaches further for a heal/shield
const SEEK_MIN_VALUE = 3; // ignore items whose net value falls below this
const DIST_PENALTY = 0.35; // item valuation: subtract per unit of distance
const DETOUR_PENALTY = 3; // item valuation: subtract per (angle/π) of backtrack
const ITEM_REPICK_CD = 0.5; // re-evaluate the chosen item this often (it may be taken/expire)
const BOT_MAX_SHIELD = 2; // shield/super pickups grant up to this many charges (soaked before HP)
const HEAL_AMOUNT = 5; // a grabbed heal restores half-health (cap MAX_HEALTH)
const RAPID_DUR = 6; // rapid pickup: ~2× fire rate for this long
const SPEED_DUR = 6; // speed pickup: +25% move speed for this long
const SPEED_MULT = 1.25; // transient move-speed multiplier while speedT>0 (4.6→~5.75, still < player 6.5)

// Per-kind base valuation for item seeking. heal is contextual (see valueItem).
const ITEM_BASE_VALUE: Record<string, number> = {
  super: 10,
  shield: 9,
  rapid: 7,
  speed: 4,
  dash: 4,
  heal: 2, // overridden to 10 when the bot is hurt (HP<=LOW_HP)
};

export const BOT_TICK_MS = 50; // 20 Hz, matches the client snapshot rate
export const BOT_TICK_SECONDS = BOT_TICK_MS / 1000;

/** The only room bots populate. */
const GAME_ROOM = "voxelcube-ffa";
/** Hard cap on bots per room. */
const MAX_BOTS = 6;

const BULLET_COLOR = "#ff5e6c";
/**
 * Visible-bullet travel speed. **MUST stay in sync with `BULLET_SPEED` in
 * `src/game/Bullets.ts`** — the server schedules damage to land `dist/BULLET_SPEED`
 * after the shot so it coincides with the tracer the client renders at that same
 * speed. Duplicated (not shared via a module) on purpose: the server (tsup) and
 * client (vite) builds don't share a source today. See netcode-hit-sync-plan.md.
 */
const BULLET_SPEED = 22;
/**
 * Floor on a scheduled hit's travel time so point-blank shots (dist→0) still show
 * a brief visible tracer before the damage lands — no close-range instant-death.
 */
const MIN_TRAVEL_MS = 90;

// Mirrors the client ANIMAL_NAMES (ModelLibrary) + BOT_NAMES so bots read as
// real players with valid avatars.
const ANIMAL_NAMES = [
  "bear", "bunny", "cat", "chicken", "crocodile", "dog", "fox", "frog",
  "mouse", "panda", "piglet",
];
const PT_NOUN = ["destruidor", "mlk", "quebrada", "mundos", "lenda", "monstro", "treta", "capeta", "demonio", "bicho", "fera"];
const PT_CONN = ["de", "do", "da", "das"];
const ANIME = ["sasuke", "goku", "naruto", "itachi", "kakashi", "zoro", "luffy", "void", "ghost", "shadow", "reaper", "slayer", "dark", "neo", "kira"];
const PRO = ["pro", "god", "king", "master", "op", "gg", "no1", "real"];
const NUM3 = [420, 69, 777, 666, 1337, 7, 99, 13];
const pick = <T,>(a: T[]): T => a[Math.floor(rand() * a.length)];
const bigNum = () => Math.floor(rand() * 90000) + 100;      // 3–5 digits, NOT only round
const num2 = () => String(Math.floor(rand() * 100)).padStart(2, "0");
const maybeLeet = (s: string) =>
  rand() < 0.3 ? s.replace(/[aeios]/g, (c) => (rand() < 0.6 ? ({ a: "4", e: "3", i: "1", o: "0", s: "5" } as Record<string, string>)[c] : c)) : s;

/** A procedural gamer handle, distinct from every name in `taken`. Spawn-only. */
function genHandle(taken: Set<string>): string {
  for (let attempt = 0; attempt < 10; attempt++) {
    const r = rand();
    let name: string;
    let skipLeet = false;
    if (r < 0.35) {
      // PLAIN: bare single word, no number, no leet — ~35% weight with leet skipped
      // yields genuinely-plain handles in the ~30–40% target band.
      name = rand() < 0.5 ? pick(ANIME) : pick(PT_NOUN);
      skipLeet = true;
    } else if (r < 0.5) {
      name = `${pick(PT_NOUN)}_${pick(PT_CONN)}_${pick(PT_NOUN)}${bigNum()}`;
    } else if (r < 0.65) {
      name = `xX${pick(ANIME)}_${pick(PRO)}Xx`;
    } else if (r < 0.8) {
      name = `${pick(PT_NOUN)}_${pick(PT_CONN)}_${pick(PT_NOUN)}${num2()}`;
    } else if (r < 0.92) {
      name = `${pick(ANIME)}${pick(NUM3)}`;
    } else {
      name = `${pick(ANIME)}${pick(PRO)}${rand() < 0.5 ? num2() : ""}`;
    }
    if (!skipLeet) name = maybeLeet(name);
    const stem = name.replace(/[0-9]/g, "");
    // Reject if the full name OR its digit-stripped stem already exists (no near-dupes).
    if (!taken.has(name) && ![...taken].some((t) => t.replace(/[0-9]/g, "") === stem)) return name;
  }
  // Bounded final fallback: guaranteed distinct via a counter so taken is never matched.
  let fbIdx = Math.floor(rand() * 1e6);
  while (taken.has(`player_${fbIdx}`)) fbIdx = (fbIdx + 1) % 1e6;
  return `player_${fbIdx}`;
}

interface ServerBot {
  id: string;
  name: string;
  animal: string;
  x: number;
  z: number;
  yaw: number;
  vx: number;
  vz: number;
  // ── Vertical physics (jump arc) ──
  y: number; // current root height (GROUND_Y on the ground, higher mid-jump)
  vy: number; // vertical velocity (set to JUMP_VELOCITY on takeoff, gravity each tick)
  grounded: boolean; // true on the ground → drives client airborne squash + land SFX
  // ── Dash impulse (decaying XZ lunge layered on top of normal movement) ──
  dashVx: number;
  dashVz: number;
  dashT: number; // remaining dash-impulse time (0 = no active dash)
  health: number;
  alive: boolean;
  deadAt: number;
  targetId: string | null;
  lastAttacker: string | null; // id of whoever last damaged this bot (retaliation snap-target)
  shootCd: number;
  retargetCd: number;
  wanderCd: number;
  wanderX: number;
  wanderZ: number;
  jumpCd: number; // cooldown before this bot may jump again
  dashCd: number; // cooldown before this bot may dash again
  threat: number; // >0 = recently shot at (dodge urgency), decays over time
  strafeDir: number; // +1 / -1 circle-strafe orbit direction (flips occasionally)
  strafeCd: number; // when this hits 0, the strafe direction may flip
  // ── SUPER (telegraphed kamehameha) ──
  superCd: number; // cooldown before this bot may begin a super wind-up
  kameCharging: boolean; // true while winding up the super (drives the client glow)
  kameChargeT: number; // wind-up progress 0→1 (seconds elapsed / SUPER_CHARGE)
  superTargetId: string | null; // the player committed to at charge start
  // ── Item seeking + transient buffs (Slice 2) ──
  seekItemId: string | null; // the power-up this bot is currently walking toward (null = none)
  itemRepickCd: number; // when this hits 0 the bot re-evaluates which item to seek
  shield: number; // BR-style charges, soaked BEFORE health in damageBot (shield/super pickups)
  rapidT: number; // >0 = rapid-fire buff active (halved shoot cooldown), decays each tick
  speedT: number; // >0 = speed buff active (×SPEED_MULT move speed), decays each tick
  // ── Saber stagger (player melee) ──
  stunT: number; // >0 = full-action freeze (no steer/fire/super), decays each tick
  fireLockT: number; // >0 = constant-fire lockout (no shots), outlives the stun
  staggerOkAt: number; // epoch ms; the next stagger is only honored at/after this (anti-spam)
  // ── Per-bot identity (persistent skill → accuracy/cadence/aim-lead) ──
  skill: number;      // 0..1, rolled once, PRESERVED across respawn (a person keeps their rep)
  accEff: number;     // cached effective accuracy (derived from skill)
  cadenceMul: number; // cached fire-cadence multiplier (derived)
  leadMul: number;    // cached aim-lead multiplier (derived)
  // ── Target commitment (anti-ping-pong) ──
  commitT: number;    // seconds remaining in the current target commitment (0 = free to repick)
}

interface Target {
  id: string;
  x: number;
  z: number;
  vx: number;
  vz: number;
}

/** Result of damaging any entity (player or bot). */
export interface HitResult {
  died: boolean;
  x: number;
  z: number;
  byId: string;
  victimName: string;
}

const rand = () => Math.random();
const randPos = () => (rand() * 2 - 1) * ARENA_HALF;
const clampArena = (v: number) => (v < -ARENA_HALF ? -ARENA_HALF : v > ARENA_HALF ? ARENA_HALF : v);

// Seed a fresh super cooldown so a wave of just-spawned bots doesn't co-fire:
// half the floor + a full random spread staggers their first telegraphs.
const seedSuperCd = () => SUPER_CD_MIN * 0.5 + rand() * (SUPER_CD_MAX - SUPER_CD_MIN);

export class BotSim {
  private bots = new Map<string, ServerBot>(); // GAME_ROOM only
  private seq = 0;
  private killSeq = 0;
  /**
   * Monotonic per-shot id, stamped on every "shot" tracer and carried through to
   * its scheduled "hit"/"died" so a client can correlate the visible bullet with
   * the damage it causes (impact gate, Phase 3). Globally unique within the sim,
   * so {from,seq} or just seq identifies a shot. See netcode-hit-sync-plan.md.
   */
  private shotSeq = 0;
  /**
   * Per-target velocity estimate for aim-leading. The hub exposes only player
   * positions, so we differentiate them across bot ticks: id → {x,z,vx,vz}.
   * Rebuilt each tick from the current player set (stale ids fall off).
   */
  private targetVel = new Map<string, { x: number; z: number; vx: number; vz: number }>();
  private targetBotCount = 0;

  constructor(private hub: RoomHub) {}

  /** Presence members for the bots (so clients render + count + list them). */
  rosterMembers(room: string): { id: string; meta: Record<string, unknown> }[] {
    if (room !== GAME_ROOM) return [];
    const out: { id: string; meta: Record<string, unknown> }[] = [];
    for (const b of this.bots.values()) {
      out.push({
        id: b.id,
        meta: {
          id: b.id,
          name: b.name,
          animal: b.animal,
          kills: 0,
          aliveSince: 0,
          alive: b.alive,
          present: true,
          isBot: true,
        },
      });
    }
    return out;
  }

  /** Apply one point of damage to a bot (player→bot via {t:"hit"}, or bot→bot). */
  damageBot(room: string, targetId: string, byId: string): HitResult | null {
    if (room !== GAME_ROOM) return null;
    const b = this.bots.get(targetId);
    if (!b || !b.alive) return null;
    // Taking fire spikes the dodge urgency so the bot reacts (jump / dash away).
    b.threat = THREAT_DECAY;
    // Remember the shooter so the per-tick retaliation snap re-engages them
    // instantly (overrides target stickiness while threatened).
    b.lastAttacker = byId;
    // Shield charges (from shield/super pickups) soak the hit BEFORE health,
    // mirroring the player armor in RoomHub.damagePlayer. hub.addShield is
    // players-only, so bot shields live here and are consumed here.
    if (b.shield > 0) {
      b.shield -= 1;
      return { died: false, x: b.x, z: b.z, byId, victimName: b.name };
    }
    b.health -= 1;
    if (b.health <= 0) {
      b.alive = false;
      b.deadAt = Date.now();
      return { died: true, x: b.x, z: b.z, byId, victimName: b.name };
    }
    return { died: false, x: b.x, z: b.z, byId, victimName: b.name };
  }

  /**
   * Apply a saber stagger to a server bot AUTHORITATIVELY (a player's "meleehit"
   * targeted it). Durations are server-owned canonical constants — the client cue
   * is trusted only as a "this happened" signal, never for its values — so a forged
   * meleehit can't over-stun. Brief action freeze + a constant-fire lockout, and an
   * interrupt of any in-progress super wind-up (with a re-arm penalty). Idempotent-ish
   * via max-merge; returns true if a live bot was staggered. */
  staggerBot(room: string, targetId: string): boolean {
    if (room !== GAME_ROOM) return false;
    const b = this.bots.get(targetId);
    if (!b || !b.alive) return false;
    // Rate-limit: only honor the next stagger once the previous effect has fully
    // expired + a free window. Without this a client spamming "meleehit" for a bot
    // could refresh these timers every packet and freeze it forever.
    const now = Date.now();
    if (now < b.staggerOkAt) return false;
    b.stunT = MELEE_STUN_T;
    b.fireLockT = MELEE_FIRE_LOCK_T;
    if (b.kameCharging) {
      this.abortSuper(b);
      b.superCd = Math.max(b.superCd, MELEE_SUPER_REARM);
    }
    b.staggerOkAt =
      now + Math.max(MELEE_STUN_T, MELEE_FIRE_LOCK_T) * 1000 + MELEE_STAGGER_FREE_MS;
    return true;
  }

  /** Drain a bot to death from a player's concentrated mega ("kamehit"). */
  killBot(room: string, targetId: string): HitResult | null {
    if (room !== GAME_ROOM) return null;
    const b = this.bots.get(targetId);
    if (!b || !b.alive) return null;
    b.health = 0;
    b.alive = false;
    b.deadAt = Date.now();
    return { died: true, x: b.x, z: b.z, byId: "", victimName: b.name };
  }

  hasBot(room: string, id: string): boolean {
    return room === GAME_ROOM && this.bots.has(id);
  }

  /**
   * Positions of alive bots — the pickup input for PowerUpSim (mirrors
   * RoomHub.playerTargets). One-directional read so the combat sim never imports
   * PowerUpSim types (avoids a circular import); PowerUpSim reaches this via
   * hub.botSim once per tick.
   */
  botTargets(room: string): { id: string; x: number; z: number }[] {
    if (room !== GAME_ROOM) return [];
    const out: { id: string; x: number; z: number }[] = [];
    for (const b of this.bots.values()) {
      if (b.alive) out.push({ id: b.id, x: b.x, z: b.z });
    }
    return out;
  }

  /**
   * Apply a power-up effect to a bot AUTHORITATIVELY (called by PowerUpSim when a
   * bot walks over an item). The visual removal is handled by the "putake" fanout
   * in PowerUpSim; this just grants the gameplay effect server-side. Mirrors the
   * client's applyPowerup, adapted to the bot's transient-buff model.
   */
  applyBotPickup(room: string, botId: string, kind: string) {
    if (room !== GAME_ROOM) return;
    const b = this.bots.get(botId);
    if (!b || !b.alive) return;
    switch (kind) {
      case "heal":
        b.health = Math.min(MAX_HEALTH, b.health + HEAL_AMOUNT);
        break;
      case "rapid":
        b.rapidT = RAPID_DUR;
        break;
      case "speed":
        b.speedT = SPEED_DUR;
        break;
      case "dash":
        b.dashCd = 0; // ready to dash immediately
        break;
      case "shield":
      case "super":
        // hub.addShield is players-only; bot armor lives on the bot + is soaked
        // in damageBot. Cap at BOT_MAX_SHIELD.
        b.shield = Math.min(b.shield + 1, BOT_MAX_SHIELD);
        break;
    }
  }

  /** Drop all bots (room emptied). */
  clearRoom(room: string) {
    if (room === GAME_ROOM) { this.bots.clear(); this.targetBotCount = 0; }
  }

  // ---------------------------------------------------------------------------

  private spawnBot(room: string) {
    const id = `srvbot_${this.seq++}`;
    const taken = new Set([...this.bots.values()].map((b) => b.name));
    const name = genHandle(taken);
    const usedAnimals = new Set([...this.bots.values()].map((b) => b.animal));
    const freeAnimals = ANIMAL_NAMES.filter((a) => !usedAnimals.has(a));
    const animal = pick(freeAnimals.length ? freeAnimals : ANIMAL_NAMES); // dedupe avatars in a 3–6 lobby
    const pos = this.pickFarSpawn(room);
    this.bots.set(id, {
      id, name, animal,
      x: pos.x, z: pos.z, yaw: 0, vx: 0, vz: 0,
      y: GROUND_Y, vy: 0, grounded: true,
      dashVx: 0, dashVz: 0, dashT: 0,
      health: MAX_HEALTH, alive: true, deadAt: 0,
      targetId: null, lastAttacker: null, shootCd: rand(), retargetCd: 0,
      wanderCd: 0, wanderX: randPos(), wanderZ: randPos(),
      jumpCd: JUMP_CD_MIN + rand() * JUMP_CD_RND,
      dashCd: DASH_CD_MIN + rand() * DASH_CD_RND,
      threat: 0,
      strafeDir: rand() < 0.5 ? 1 : -1,
      strafeCd: 2 + rand() * 3,
      superCd: seedSuperCd(),
      kameCharging: false,
      kameChargeT: 0,
      superTargetId: null,
      seekItemId: null,
      itemRepickCd: 0,
      shield: 0,
      rapidT: 0,
      speedT: 0,
      stunT: 0,
      fireLockT: 0,
      staggerOkAt: 0,
      skill: 0, accEff: 0, cadenceMul: 0, leadMul: 0,
      commitT: 0,
    });
    const b = this.bots.get(id)!;
    b.skill = (rand() + rand()) / 2; // center-biased: most mid, few sharp, few free
    this.deriveSkill(b);
  }

  private respawn(b: ServerBot, room: string) {
    const pos = this.pickFarSpawn(room, b.id);
    b.x = pos.x;
    b.z = pos.z;
    b.vx = 0;
    b.vz = 0;
    b.y = GROUND_Y;
    b.vy = 0;
    b.grounded = true;
    b.dashVx = 0;
    b.dashVz = 0;
    b.dashT = 0;
    b.health = MAX_HEALTH;
    b.alive = true;
    b.deadAt = 0;
    b.targetId = null;
    b.lastAttacker = null;
    b.shootCd = rand();
    b.jumpCd = JUMP_CD_MIN + rand() * JUMP_CD_RND;
    b.dashCd = DASH_CD_MIN + rand() * DASH_CD_RND;
    b.threat = 0;
    b.strafeDir = rand() < 0.5 ? 1 : -1;
    b.strafeCd = 2 + rand() * 3;
    b.superCd = seedSuperCd();
    b.kameCharging = false;
    b.kameChargeT = 0;
    b.superTargetId = null;
    b.seekItemId = null;
    b.itemRepickCd = 0;
    b.shield = 0;
    b.rapidT = 0;
    b.speedT = 0;
    b.stunT = 0;
    b.fireLockT = 0;
    b.staggerOkAt = 0;
    b.commitT = 0;
    this.deriveSkill(b); // re-derive caches; skill itself is PRESERVED (a person keeps their rep)
  }

  /** A spawn point far from every other combatant (players + other bots). */
  private pickFarSpawn(room: string, excludeId?: string): { x: number; z: number } {
    const enemies: { x: number; z: number }[] = this.hub
      .playerTargets(room)
      .map((p) => ({ x: p.x, z: p.z }));
    for (const o of this.bots.values()) {
      if (o.alive && o.id !== excludeId) enemies.push({ x: o.x, z: o.z });
    }
    let bx = randPos();
    let bz = randPos();
    let bestD = -1;
    for (let i = 0; i < 16; i++) {
      const cx = randPos();
      const cz = randPos();
      let minD = Infinity;
      for (const e of enemies) {
        const d = (cx - e.x) ** 2 + (cz - e.z) ** 2;
        if (d < minD) minD = d;
      }
      const score = enemies.length === 0 ? rand() : minD;
      if (score > bestD) {
        bestD = score;
        bx = cx;
        bz = cz;
      }
    }
    return { x: bx, z: bz };
  }

  /**
   * Clamp a bot's proposed position on one axis to the arena, and — if it hit the
   * wall — zero BOTH that axis's steering velocity and its dash impulse so the
   * snapshot reports no outward motion. Without this the client dead-reckons the
   * bot through the wall (the "s" vx/vz still pointed outward) then snaps it back
   * next tick → visible edge jitter. Inward motion next to the wall is untouched.
   */
  private zeroOnWall(b: ServerBot, proposed: number, axis: "x" | "z"): number {
    if (proposed < -ARENA_HALF) {
      // Hit the -wall: kill only outward (negative) velocity, keep inward motion.
      if (axis === "x") { if (b.vx < 0) b.vx = 0; if (b.dashVx < 0) b.dashVx = 0; }
      else { if (b.vz < 0) b.vz = 0; if (b.dashVz < 0) b.dashVz = 0; }
    } else if (proposed > ARENA_HALF) {
      // Hit the +wall: kill only outward (positive) velocity, keep inward motion.
      if (axis === "x") { if (b.vx > 0) b.vx = 0; if (b.dashVx > 0) b.dashVx = 0; }
      else { if (b.vz > 0) b.vz = 0; if (b.dashVz > 0) b.dashVz = 0; }
    }
    return clampArena(proposed);
  }

  /** Build the broadcast snapshot for a bot (NetState shape the client expects). */
  private snapshot(b: ServerBot): Record<string, unknown> {
    // Report the FULL horizontal velocity (steering + active dash impulse) so the
    // client's dead-reckoning extrapolates in the right direction during a dash.
    return {
      id: b.id, name: b.name, animal: b.animal,
      x: b.x, y: b.y, z: b.z, yaw: b.yaw,
      health: b.health, alive: b.alive,
      vx: b.vx + b.dashVx, vz: b.vz + b.dashVz, vy: b.vy, grounded: b.grounded,
      state: b.alive ? "alive" : "dead",
      // Drives the client's remote charge-orb glow (Game.ts ~1457): set while the
      // bot is winding up its telegraphed super, cleared on release/abort/death.
      charging: b.kameCharging, chargeT: b.kameChargeT, present: true,
    };
  }

  private fanout(room: string, event: string, payload: unknown, from: string) {
    const msg: ServerMsg = { t: "broadcast", event, payload, from };
    this.hub.fanout(room, msg);
  }

  /**
   * Begin a jump: launch the vertical arc and fan a one-shot "jump" event so the
   * client plays the squash juice. The arc itself rides the "s" stream (y/vy/
   * grounded), which is what the client interpolates + uses for airborne squash
   * and the inferred land SFX on touchdown.
   */
  private startJump(room: string, b: ServerBot) {
    if (!b.grounded) return;
    b.vy = JUMP_VELOCITY;
    b.grounded = false;
    b.jumpCd = JUMP_CD_MIN + rand() * JUMP_CD_RND;
    this.fanout(room, "jump", { id: b.id }, b.id);
  }

  /**
   * Begin a dash in `dirX,dirZ` (must be ~unit): apply a decaying XZ impulse so
   * the bot visibly lunges in the "s" stream, and fan a one-shot "dash" event so
   * the client plays the stretch juice. The impulse is clamped to the dash
   * direction's yaw for the event.
   */
  private startDash(room: string, b: ServerBot, dirX: number, dirZ: number) {
    const len = Math.hypot(dirX, dirZ) || 1;
    const nx = dirX / len;
    const nz = dirZ / len;
    b.dashVx = nx * DASH_SPEED;
    b.dashVz = nz * DASH_SPEED;
    b.dashT = DASH_DURATION;
    b.dashCd = DASH_CD_MIN + rand() * DASH_CD_RND;
    b.yaw = Math.atan2(nz, nx); // face the lunge
    this.fanout(room, "dash", { id: b.id, dir: b.yaw }, b.id);
  }

  /**
   * Advance all bots by `dt`, maintain the population against the live player
   * count, and broadcast their state + actions. Driven by index.ts at 20 Hz.
   */
  tick(room: string, dt: number) {
    if (room !== GAME_ROOM) return;

    // Maintain the population: hold a random [3,6] target for the room lifetime,
    // rolled once on first activation (when live > 0) and reset on clearRoom.
    const live = this.hub.liveSizeOf(room);
    if (live > 0 && this.targetBotCount === 0) {
      this.targetBotCount = 3 + Math.floor(rand() * 4); // held [3,6] for the room lifetime
    }
    const desired = live > 0 ? Math.min(MAX_BOTS, this.targetBotCount) : 0;
    let changed = false;
    while (this.bots.size < desired) {
      this.spawnBot(room);
      changed = true;
    }
    while (this.bots.size > desired) {
      const firstId = this.bots.keys().next().value as string | undefined;
      if (firstId === undefined) break;
      this.bots.delete(firstId);
      changed = true;
    }
    if (changed) this.hub.broadcastPresence(room);
    if (this.bots.size === 0) return;

    // Gather all targets: live players (from their last snapshot) + alive bots.
    const players = this.hub.playerTargets(room);
    const now = Date.now();

    // Estimate each player's velocity by differentiating its position across
    // ticks (the hub doesn't expose velocity). Used purely for aim-leading.
    const seen = new Set<string>();
    for (const p of players) {
      seen.add(p.id);
      const prev = this.targetVel.get(p.id);
      if (prev) {
        // dt is the bot tick (constant); a light smoothing tames snapshot jitter.
        const nvx = (p.x - prev.x) / dt;
        const nvz = (p.z - prev.z) / dt;
        prev.vx += (nvx - prev.vx) * 0.5;
        prev.vz += (nvz - prev.vz) * 0.5;
        prev.x = p.x;
        prev.z = p.z;
      } else {
        this.targetVel.set(p.id, { x: p.x, z: p.z, vx: 0, vz: 0 });
      }
    }
    // Drop stale tracks (players who left / died this tick).
    for (const id of this.targetVel.keys()) {
      if (!seen.has(id)) this.targetVel.delete(id);
    }

    // Active power-ups, read ONCE per tick (not per bot) so item-seeking is cheap
    // for 10 bots. One-directional coupling: PowerUpSim exposes positions only,
    // so this combat sim never imports PowerUpSim types (no circular import).
    const items = this.hub.powerupSim.botItemTargets(room);

    // ── ENGAGER CAP pre-pass (anti-dogpile) ────────────────────────────────────
    // For every live player, rank all ALIVE bots by distance² and let only the
    // nearest MAX_ENGAGERS_PER_PLAYER be "engagers" (may fire/close/super on that
    // player); the closest among them owns the single per-player super slot. The
    // ranking is purely positional → deterministic, no RNG, no order dependence.
    // Maps are keyed by bot id (a bot can only target one player at a time, so a
    // bot appears under at most one player below — it's an engager iff it's near
    // ITS target). Bot-vs-bot fights (no human) are uncapped (handled as before).
    const engagersByPlayer = new Map<string, Set<string>>(); // playerId → nearest bot ids
    const superHolder = new Map<string, string>(); // playerId → the one bot id that may super
    if (players.length > 0) {
      for (const p of players) {
        const ranked: { id: string; d2: number }[] = [];
        for (const o of this.bots.values()) {
          if (!o.alive) continue;
          ranked.push({ id: o.id, d2: (o.x - p.x) ** 2 + (o.z - p.z) ** 2 });
        }
        ranked.sort((a, c) => a.d2 - c.d2);
        const near = new Set<string>();
        for (let i = 0; i < ranked.length && i < MAX_ENGAGERS_PER_PLAYER; i++) {
          near.add(ranked[i].id);
        }
        engagersByPlayer.set(p.id, near);
        // The single super slot (one charging super per player). Priority:
        //   1. a bot already mid-telegraph against this player (never strip a
        //      committed charge),
        //   2. otherwise the nearest ENGAGER that is off-cooldown + ready to commit
        //      (so the slot isn't wasted on a bot that can't fire it yet).
        // Exactly one holder per player; one telegraph per player is product-locked.
        let holder: string | null = null;
        for (let i = 0; i < ranked.length && i < MAX_ENGAGERS_PER_PLAYER; i++) {
          const ob = this.bots.get(ranked[i].id);
          if (ob && ob.kameCharging && ob.superTargetId === p.id) { holder = ob.id; break; }
        }
        if (!holder) {
          for (let i = 0; i < ranked.length && i < MAX_ENGAGERS_PER_PLAYER; i++) {
            const ob = this.bots.get(ranked[i].id);
            if (ob && ob.superCd <= 0 && ob.health > SUPER_MIN_HP) { holder = ob.id; break; }
          }
        }
        if (holder) superHolder.set(p.id, holder);
      }
    }

    for (const b of this.bots.values()) {
      if (!b.alive) {
        if (now - b.deadAt >= RESPAWN_MS) this.respawn(b, room);
        this.fanout(room, "s", this.snapshot(b), b.id);
        continue;
      }

      // Decay the "recently shot at" threat flag.
      if (b.threat > 0) b.threat = Math.max(0, b.threat - dt);
      // Decay the transient pickup buffs (rapid fire / move speed).
      if (b.rapidT > 0) b.rapidT = Math.max(0, b.rapidT - dt);
      if (b.speedT > 0) b.speedT = Math.max(0, b.speedT - dt);
      // Decay the saber stagger timers (freeze + fire-lock from a player's melee).
      if (b.stunT > 0) b.stunT = Math.max(0, b.stunT - dt);
      if (b.fireLockT > 0) b.fireLockT = Math.max(0, b.fireLockT - dt);

      // ── CHARGE_SUPER: while winding up the telegraphed super, the bot COMMITS
      // (this short-circuits all normal combat below so a player gets a clean
      // ~1.2s window to dash/jump out of the beam). The super cooldown only ticks
      // down when NOT charging. Separation + steering + the "s" fanout still run.
      if (b.kameCharging) {
        // tickSuperCharge returns false while still winding up → hold + fan only.
        // It returns true once the charge resolves (released/aborted); we then
        // fall through to normal AI so the bot keeps moving/fanning this tick.
        if (!this.tickSuperCharge(room, b, dt)) {
          this.integrateCharging(room, b, dt);
          continue;
        }
      } else if (b.superCd > 0) {
        b.superCd = Math.max(0, b.superCd - dt);
      }

      // Candidate enemies = everyone except self. Player velocities come from the
      // per-tick position-delta estimate (for aim leading); bots are treated as
      // stationary aim-wise (vx/vz=0) since they juke unpredictably anyway.
      const enemies: Target[] = [];
      for (const p of players) {
        const est = this.targetVel.get(p.id);
        enemies.push({ id: p.id, x: p.x, z: p.z, vx: est?.vx ?? 0, vz: est?.vz ?? 0 });
      }
      for (const other of this.bots.values()) {
        if (other.id !== b.id && other.alive) {
          enemies.push({ id: other.id, x: other.x, z: other.z, vx: 0, vz: 0 });
        }
      }

      // ── TARGET SELECTION (pure nearest-enemy, committed) ──────────────────────
      // Players and bots are identical "enemies"; nearest wins. commitT keeps a bot
      // on its current fight (no equidistant ping-pong); a vanished target force-breaks
      // it. The post-pass below is the SOLE player-attention floor guarantee.
      b.retargetCd -= dt;
      if (b.commitT > 0) b.commitT = Math.max(0, b.commitT - dt);
      const curTgt = b.targetId ? enemies.find((e) => e.id === b.targetId) ?? null : null;
      const curInRange = !!curTgt &&
        (curTgt.x - b.x) ** 2 + (curTgt.z - b.z) ** 2 <= (SHOOT_RANGE + ENGAGE_LEASH) ** 2;
      const holdCommit = b.commitT > 0 && !!curTgt && curInRange; // null/out-of-range curTgt force-breaks

      if (!holdCommit && (b.retargetCd <= 0 || !curTgt)) {
        b.retargetCd = RETARGET_CD;
        let best: Target | null = null, bestEff = Infinity;
        for (const e of enemies) {
          const d = Math.hypot(e.x - b.x, e.z - b.z);
          if (d < bestEff) { bestEff = d; best = e; }
        }
        const prev = b.targetId;
        if (best && curTgt && best.id !== curTgt.id) {
          // same-distance tiebreak: only switch if clearly closer (anti-flicker)
          const curD = Math.hypot(curTgt.x - b.x, curTgt.z - b.z);
          b.targetId = bestEff < curD - TARGET_SWITCH_HYSTERESIS ? best.id : curTgt.id;
        } else {
          b.targetId = best ? best.id : null;
        }
        if (b.targetId && b.targetId !== prev) {
          b.commitT = COMMIT_MIN + (1 - b.skill) * COMMIT_SPAN; // re-seed on a genuine id CHANGE only
        }
      }

      // RETALIATION: being shot re-aims at the shooter (player OR bot), overriding commit.
      if (b.threat > 0 && b.lastAttacker && b.lastAttacker !== b.targetId) {
        const atk = enemies.find((e) => e.id === b.lastAttacker);
        if (atk) {
          const ad2 = (atk.x - b.x) ** 2 + (atk.z - b.z) ** 2;
          if (ad2 <= (SHOOT_RANGE + 2) * (SHOOT_RANGE + 2)) {
            b.targetId = atk.id;
            b.commitT = COMMIT_MIN + (1 - b.skill) * COMMIT_SPAN; // bind commit to the new id
          }
        }
      }

      const tgt = enemies.find((e) => e.id === b.targetId) ?? null;

      // ── ENGAGER GATE ───────────────────────────────────────────────────────────
      // A bot is a full engager iff its target is a PLAYER and it's among that
      // player's nearest MAX_ENGAGERS_PER_PLAYER bots (the pre-pass). Non-engagers
      // still navigate/orbit but hold at STANDOFF range and suppress fire/super —
      // turning a dogpile into a readable front line. Bot-vs-bot fights (target is
      // a bot, never in engagersByPlayer) are always full engagers (uncapped).
      const tgtIsPlayer = !!tgt && players.some((p) => p.id === tgt!.id);
      const isEngager =
        !tgtIsPlayer || (engagersByPlayer.get(tgt!.id)?.has(b.id) ?? false);
      const maySuper = tgtIsPlayer && superHolder.get(tgt!.id) === b.id;

      // Desired XZ movement direction (unit-ish); combat / seek / wander fills it in.
      let mvx = 0;
      let mvz = 0;

      // ── NAV ARBITER: ENGAGE vs SEEK_ITEM vs HUNT ──────────────────────────────
      // Item-seeking is OPPORTUNISTIC and never pacifist: a bot only walks toward a
      // pickup in a lull (no enemy within ENGAGE_LEASH and not under fire), or in
      // desperation (low HP + a nearby heal/shield). The instant an enemy closes in
      // or shoots, it drops the item and fights (handled by the conditions below).
      b.itemRepickCd -= dt;
      // Distance² to the nearest enemy (drives the lull / aggro-break test).
      let nearestEnemyD2 = Infinity;
      for (const e of enemies) {
        const d2 = (e.x - b.x) ** 2 + (e.z - b.z) ** 2;
        if (d2 < nearestEnemyD2) nearestEnemyD2 = d2;
      }
      const enemyInLeash = nearestEnemyD2 <= ENGAGE_LEASH * ENGAGE_LEASH;
      const enemyAggroBreak = nearestEnemyD2 <= AGGRO_BREAK_DIST * AGGRO_BREAK_DIST;
      // FIGHT takes priority: a valid target with an enemy in leash, under fire, or
      // a player in shoot range. Otherwise the bot is free to consider seeking.
      const mustFight =
        !!tgt &&
        (enemyInLeash ||
          b.threat > 0 ||
          (this.hub.isPlayer(room, tgt.id) &&
            (tgt.x - b.x) ** 2 + (tgt.z - b.z) ** 2 <= SHOOT_RANGE * SHOOT_RANGE));

      // Pick / refresh the item to seek when allowed to (re-evaluated every
      // ITEM_REPICK_CD since the chosen item may be taken or expire). The
      // desperation heal case (low HP) is allowed to seek even with an enemy
      // around, as long as no enemy is point-blank (aggro-break).
      let seekItem: { id: string; kind: string; x: number; z: number } | null = null;
      const canSeek = !mustFight && !enemyAggroBreak && items.length > 0;
      if (canSeek) {
        if (b.itemRepickCd <= 0 || !b.seekItemId || !items.some((it) => it.id === b.seekItemId)) {
          b.itemRepickCd = ITEM_REPICK_CD;
          const chosen = this.pickSeekItem(b, items);
          b.seekItemId = chosen ? chosen.id : null;
        }
        if (b.seekItemId) seekItem = items.find((it) => it.id === b.seekItemId) ?? null;
      } else {
        b.seekItemId = null;
      }

      if (seekItem) {
        // ── SEEK_ITEM: steer toward the chosen pickup at full speed with a faint
        // perpendicular wobble; face travel; allow idle hops + gap-closing dashes.
        // The pickup itself is resolved server-side in powerups.ts (PICKUP_RADIUS).
        const dx = seekItem.x - b.x;
        const dz = seekItem.z - b.z;
        const dist = Math.hypot(dx, dz) || 1;
        const ux = dx / dist;
        const uz = dz / dist;
        // Faint sideways wobble so the path isn't a dead-straight line.
        mvx = ux + -uz * b.strafeDir * 0.15;
        mvz = uz + ux * b.strafeDir * 0.15;
        b.yaw = Math.atan2(dz, dx);

        // Close a big gap to the item with a dash (reuse the safe-dash helper).
        b.dashCd -= dt;
        if (b.dashCd <= 0 && b.grounded && b.stunT <= 0 && dist > DASH_GAP_DIST && rand() < DASH_DODGE_CHANCE) {
          this.dashSafely(room, b, ux, uz);
        }
        // Idle hop so a travelling bot doesn't look frozen.
        b.jumpCd -= dt;
        if (b.jumpCd <= 0 && b.grounded && b.stunT <= 0 && rand() < JUMP_IDLE_CHANCE) {
          this.startJump(room, b);
        }
      } else if (tgt) {
        const dx = tgt.x - b.x;
        const dz = tgt.z - b.z;
        const dist = Math.hypot(dx, dz) || 1;
        const ux = dx / dist;
        const uz = dz / dist;
        b.yaw = Math.atan2(dz, dx);

        // Engagers press to ENGAGE_DIST; non-engagers (capped out by the pre-pass)
        // loosely orbit at the looser STANDOFF range so they form the back of the
        // line instead of piling onto the player.
        const refDist = isEngager ? ENGAGE_DIST : STANDOFF_DIST;
        const refBand = isEngager ? ENGAGE_BAND : STANDOFF_BAND;

        // Approach / retreat / circle-strafe around the engagement band.
        if (dist > refDist + refBand) {
          // Too far: close in (with a slight strafe so the approach isn't a straight line).
          mvx = ux * 0.85 - uz * b.strafeDir * 0.5;
          mvz = uz * 0.85 + ux * b.strafeDir * 0.5;
        } else if (dist < refDist - refBand) {
          // Too close: back off while strafing (kite).
          mvx = -ux * 0.7 - uz * b.strafeDir * 0.6;
          mvz = -uz * 0.7 + ux * b.strafeDir * 0.6;
        } else {
          // In the band: orbit the target (perpendicular = circle-strafe).
          mvx = -uz * b.strafeDir;
          mvz = ux * b.strafeDir;
        }

        // Low HP: bias the whole vector away from the target (retreat / kite).
        if (b.health <= DASH_RETREAT_HP) {
          mvx = mvx * 0.4 - ux * 0.8;
          mvz = mvz * 0.4 - uz * 0.8;
        }

        // Occasionally flip the orbit direction so fights don't look mechanical.
        b.strafeCd -= dt;
        if (b.strafeCd <= 0) {
          b.strafeCd = 2 + rand() * 3;
          if (rand() < 0.5) b.strafeDir = -b.strafeDir;
        }

        // ── Shoot (with slight aim leading + varied cadence) ──
        // Only ENGAGERS fire: the nearest few bots per player keep the heat fair
        // (capping the dogpile at ~MAX_ENGAGERS_PER_PLAYER guns instead of N).
        b.shootCd -= dt;
        if (
          isEngager &&
          b.shootCd <= 0 &&
          dist <= SHOOT_RANGE &&
          b.grounded &&
          b.stunT <= 0 &&
          b.fireLockT <= 0 // saber lockout suppresses constant fire
        ) {
          // Rapid pickup ~halves the cadence while its buff is active.
          const rapidMult = b.rapidT > 0 ? 0.5 : 1;
          b.shootCd = (SHOOT_CD_MIN + rand() * SHOOT_CD_RND) * b.cadenceMul * rapidMult;
          this.fire(room, b, tgt);
        }

        // ── DASH decisions ── (suppressed while saber-stunned)
        b.dashCd -= dt;
        if (b.dashCd <= 0 && b.grounded && b.stunT <= 0) {
          if (b.health <= DASH_RETREAT_HP && rand() < DASH_DODGE_CHANCE) {
            // Low HP: lunge AWAY from the target to break the engagement.
            this.dashSafely(room, b, -ux, -uz);
          } else if (b.threat > 0 && rand() < DASH_DODGE_CHANCE) {
            // Under fire: juke sideways (perpendicular) to dodge the next shot.
            this.dashSafely(room, b, -uz * b.strafeDir, ux * b.strafeDir);
          } else if (dist > DASH_GAP_DIST && rand() < DASH_DODGE_CHANCE) {
            // Big gap: dash toward the target to close it quickly.
            this.dashSafely(room, b, ux, uz);
          }
        }

        // ── JUMP decisions ── (suppressed while saber-stunned)
        b.jumpCd -= dt;
        if (b.jumpCd <= 0 && b.grounded && b.stunT <= 0) {
          const urgent = b.threat > 0 || b.health <= DASH_RETREAT_HP;
          if (urgent && rand() < JUMP_DODGE_CHANCE) {
            this.startJump(room, b); // bob to throw off the shooter's aim
          } else if (rand() < JUMP_IDLE_CHANCE) {
            this.startJump(room, b); // liveliness hop
          }
        }

        // ── SUPER entry gate ──
        // Begin a telegraphed mega only against a PLAYER, off-cooldown, in close
        // range, grounded, and healthy enough to commit. From the NEXT tick the
        // CHARGE_SUPER branch above takes over (movement/fire suppressed) until the
        // wind-up completes (fire) or the target escapes (abort). The `maySuper`
        // gate enforces ONE charging super per player (the per-player super slot)
        // so a lone player never faces overlapping telegraphs.
        if (
          maySuper &&
          b.superCd <= 0 &&
          b.grounded &&
          b.stunT <= 0 && // a saber stagger blocks starting a super wind-up
          b.health > SUPER_MIN_HP &&
          dist <= SUPER_RANGE &&
          this.hub.isPlayer(room, tgt.id)
        ) {
          b.kameCharging = true;
          b.kameChargeT = 0;
          b.superTargetId = tgt.id;
        }
      } else {
        // ── HUNT (center-biased idle) ──
        // Pick the roaming point with a center bias: most points land on a
        // jittered RING around origin (where super/shield/rapid spawn) so 10 idle
        // bots ring the item-rich center instead of stacking on (0,0); the rest
        // scatter anywhere so the periphery (heals) isn't a dead zone.
        b.wanderCd -= dt;
        if (b.wanderCd <= 0) {
          b.wanderCd = WANDER_CD + rand() * 2;
          if (rand() < CENTER_BIAS_CHANCE) {
            const ang = rand() * Math.PI * 2;
            const r = CENTER_RING_MIN + rand() * (CENTER_RING_MAX - CENTER_RING_MIN);
            b.wanderX = Math.cos(ang) * r;
            b.wanderZ = Math.sin(ang) * r;
          } else {
            b.wanderX = randPos();
            b.wanderZ = randPos();
          }
        }
        const dx = b.wanderX - b.x;
        const dz = b.wanderZ - b.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.6) { mvx = dx / d; mvz = dz / d; b.yaw = Math.atan2(dz, dx); }

        // The odd idle hop keeps wandering bots from looking frozen.
        b.jumpCd -= dt;
        if (b.jumpCd <= 0 && b.grounded && b.stunT <= 0 && rand() < JUMP_IDLE_CHANCE) {
          this.startJump(room, b);
        }
      }

      // ── Separation: gently push away from nearby bots so they don't clump ──
      let sepX = 0;
      let sepZ = 0;
      for (const other of this.bots.values()) {
        if (other.id === b.id || !other.alive) continue;
        const ox = b.x - other.x;
        const oz = b.z - other.z;
        const od2 = ox * ox + oz * oz;
        if (od2 > 0.0001 && od2 < 9) {
          const od = Math.sqrt(od2);
          const push = (3 - od) / 3; // stronger the closer they are
          sepX += (ox / od) * push;
          sepZ += (oz / od) * push;
        }
      }
      mvx += sepX * 0.6;
      mvz += sepZ * 0.6;

      // ── Smooth horizontal steering: accelerate toward the desired velocity ──
      // (No instant snapping — vx/vz chase the target velocity at ACCEL.)
      // The speed pickup nudges the effective move speed up by SPEED_MULT while
      // its buff is active (still kept below the player base speed of 6.5).
      const moveSpeed = b.speedT > 0 ? MOVE_SPEED * SPEED_MULT : MOVE_SPEED;
      const mlen = Math.hypot(mvx, mvz);
      // A saber stagger freezes self-propelled movement (vx/vz decay toward 0);
      // only an active dash impulse still carries the bot during the brief stun.
      const desVx = b.stunT <= 0 && mlen > 0.001 ? (mvx / mlen) * moveSpeed : 0;
      const desVz = b.stunT <= 0 && mlen > 0.001 ? (mvz / mlen) * moveSpeed : 0;
      const accelStep = Math.min(1, ACCEL * dt);
      b.vx += (desVx - b.vx) * accelStep;
      b.vz += (desVz - b.vz) * accelStep;

      // ── Decay the active dash impulse (exponential) ──
      if (b.dashT > 0) {
        b.dashT -= dt;
        const k = Math.exp(-DASH_DECAY * dt);
        b.dashVx *= k;
        b.dashVz *= k;
        if (b.dashT <= 0 || (Math.abs(b.dashVx) < 0.05 && Math.abs(b.dashVz) < 0.05)) {
          b.dashVx = 0;
          b.dashVz = 0;
          b.dashT = 0;
        }
      }

      // ── Integrate horizontal position (steering + dash impulse) ──
      // Zero the velocity component on any axis that hit the arena wall BEFORE the
      // snapshot fanout: otherwise the "s" still reports outward velocity, the
      // client dead-reckons the bot past the wall, then snaps it back next tick
      // (edge jitter). zeroOnWall both clamps and stops the wall-bound axis.
      b.x = this.zeroOnWall(b, b.x + (b.vx + b.dashVx) * dt, "x");
      b.z = this.zeroOnWall(b, b.z + (b.vz + b.dashVz) * dt, "z");

      // ── Integrate the vertical jump arc (gravity) ──
      if (!b.grounded) {
        b.vy -= GRAVITY * dt;
        b.y += b.vy * dt;
        if (b.y <= GROUND_Y) {
          // Touchdown: the grounded false→true edge makes the client play the
          // land SFX + dust automatically (inferred from the "s" stream).
          b.y = GROUND_Y;
          b.vy = 0;
          b.grounded = true;
        }
      }

      this.fanout(room, "s", this.snapshot(b), b.id);
    }

    // ── PLAYER-ATTENTION FLOOR (post-pass — authoritative guarantee) ──────────
    // This is the SOLE mechanism that ensures every player is targeted by at least
    // one bot. Pure nearest-enemy selection (above) gives no such guarantee on its
    // own; this pass runs once per tick AFTER all per-bot selection is done and
    // assigns the nearest free bot to any neglected player. Effect lands next tick
    // (~50 ms), which is imperceptible.
    //
    // "Free" bot = commitT <= 0 (strictly uncommitted — single consistent definition).
    // STEAL-GUARD: skip a free bot that is the SOLE targeter of another player (to
    // avoid leaving that player orphaned). When a bot IS reassigned away from
    // player B, decrement B's live count immediately so B can be rescued in this
    // same pass if needed. Counts are maintained live as assignments are made.
    if (players.length > 0) {
      // Build live targeter counts (players only; updated as we reassign below).
      const liveCount = new Map<string, number>();
      for (const b of this.bots.values()) {
        if (b.alive && b.targetId && players.some((p) => p.id === b.targetId)) {
          liveCount.set(b.targetId, (liveCount.get(b.targetId) ?? 0) + 1);
        }
      }
      for (const p of players) {
        if ((liveCount.get(p.id) ?? 0) > 0) continue; // already has a targeter
        let best: ServerBot | null = null, bestD2 = Infinity;
        for (const b of this.bots.values()) {
          if (!b.alive || b.commitT > 0) continue; // only strictly free bots
          // STEAL-GUARD: don't take the sole guardian of another player.
          if (b.targetId && players.some((pp) => pp.id === b.targetId)) {
            if ((liveCount.get(b.targetId) ?? 0) <= 1) continue;
          }
          const d2 = (b.x - p.x) ** 2 + (b.z - p.z) ** 2;
          if (d2 < bestD2) { bestD2 = d2; best = b; }
        }
        if (best) {
          // Decrement the previous player's count so it can be rescued this pass.
          if (best.targetId && players.some((pp) => pp.id === best!.targetId)) {
            liveCount.set(best.targetId, (liveCount.get(best.targetId) ?? 1) - 1);
          }
          best.targetId = p.id;
          best.commitT = COMMIT_MIN + (1 - best.skill) * COMMIT_SPAN;
          liveCount.set(p.id, 1);
        }
      }
    }
  }

  /** Live position (+ grounded) of a player id, or null if absent/dead this tick. */
  private playerPos(
    room: string,
    id: string,
  ): { x: number; z: number; grounded: boolean } | null {
    for (const p of this.hub.playerTargets(room)) {
      if (p.id === id) return { x: p.x, z: p.z, grounded: p.grounded };
    }
    return null;
  }

  /**
   * Advance a super wind-up by `dt`. Returns true once the charge RESOLVES this
   * tick (released or aborted) — the caller then clears `kameCharging` is already
   * done here, and falls through to normal AI. Returns false while still charging.
   *
   * ABORT (no emit, no damage, short re-arm) if the committed target is gone/dead,
   * has slipped past SUPER_ABORT_RANGE, or the bot itself is now too hurt to commit.
   * RELEASE at chargeT>=1: emit the visual "kame" and server-resolve the lethal hit.
   */
  private tickSuperCharge(room: string, b: ServerBot, dt: number): boolean {
    const tid = b.superTargetId;
    const tpos = tid ? this.playerPos(room, tid) : null;

    // Abort: target gone/dead, out of abort range, or the bot is too hurt now.
    if (!tpos || b.health <= SUPER_MIN_HP) {
      this.abortSuper(b);
      return true;
    }
    const adx = tpos.x - b.x;
    const adz = tpos.z - b.z;
    if (Math.hypot(adx, adz) > SUPER_ABORT_RANGE) {
      this.abortSuper(b);
      return true;
    }

    // Advance the wind-up.
    b.kameChargeT = Math.min(1, b.kameChargeT + dt / SUPER_CHARGE);
    if (b.kameChargeT < 1) return false; // keep charging

    // Ready → release (visual + server-resolved damage), then go back on cooldown.
    this.fireSuper(room, b, tpos);
    b.kameCharging = false;
    b.kameChargeT = 0;
    b.superTargetId = null;
    b.superCd = SUPER_CD_MIN + rand() * (SUPER_CD_MAX - SUPER_CD_MIN);
    return true;
  }

  /** Cancel a wind-up cleanly: no emit, no damage, short re-arm so a wasted tell
   *  isn't punished forever. The cleared flags ride the NEXT "s" so the client
   *  drops the orb. */
  private abortSuper(b: ServerBot) {
    b.kameCharging = false;
    b.kameChargeT = 0;
    b.superTargetId = null;
    b.superCd = SUPER_REARM;
  }

  /**
   * Hold-in-place movement + snapshot fan for a STILL-charging bot: drift at a
   * capped speed (not frozen), hard-face the committed target, and apply only
   * bot-bot separation. Suppresses fire/dash/jump (the commitment is the player's
   * counterplay window). Integrates gravity in case the bot is mid-air on entry.
   */
  private integrateCharging(room: string, b: ServerBot, dt: number) {
    const tpos = b.superTargetId ? this.playerPos(room, b.superTargetId) : null;
    if (tpos) b.yaw = Math.atan2(tpos.z - b.z, tpos.x - b.x); // hard-face the target

    // Separation push only (so charging bots don't stack), at the capped speed.
    let sepX = 0;
    let sepZ = 0;
    for (const other of this.bots.values()) {
      if (other.id === b.id || !other.alive) continue;
      const ox = b.x - other.x;
      const oz = b.z - other.z;
      const od2 = ox * ox + oz * oz;
      if (od2 > 0.0001 && od2 < 9) {
        const od = Math.sqrt(od2);
        const push = (3 - od) / 3;
        sepX += (ox / od) * push;
        sepZ += (oz / od) * push;
      }
    }
    const slen = Math.hypot(sepX, sepZ);
    const desVx = slen > 0.001 ? (sepX / slen) * SUPER_CHARGE_SPEED : 0;
    const desVz = slen > 0.001 ? (sepZ / slen) * SUPER_CHARGE_SPEED : 0;
    const accelStep = Math.min(1, ACCEL * dt);
    b.vx += (desVx - b.vx) * accelStep;
    b.vz += (desVz - b.vz) * accelStep;

    // Decay any leftover dash impulse from before the charge started.
    if (b.dashT > 0) {
      b.dashT -= dt;
      const k = Math.exp(-DASH_DECAY * dt);
      b.dashVx *= k;
      b.dashVz *= k;
      if (b.dashT <= 0 || (Math.abs(b.dashVx) < 0.05 && Math.abs(b.dashVz) < 0.05)) {
        b.dashVx = 0;
        b.dashVz = 0;
        b.dashT = 0;
      }
    }

    // Same wall-zeroing as the main integrate so a charging bot drifting into the
    // wall doesn't report outward velocity → no client dead-reckon overshoot.
    b.x = this.zeroOnWall(b, b.x + (b.vx + b.dashVx) * dt, "x");
    b.z = this.zeroOnWall(b, b.z + (b.vz + b.dashVz) * dt, "z");

    // Settle any in-flight jump arc (the bot can't jump again while charging).
    if (!b.grounded) {
      b.vy -= GRAVITY * dt;
      b.y += b.vy * dt;
      if (b.y <= GROUND_Y) {
        b.y = GROUND_Y;
        b.vy = 0;
        b.grounded = true;
      }
    }

    this.fanout(room, "s", this.snapshot(b), b.id);
  }

  /**
   * Release the super: emit the VISUAL-ONLY "kame" beam (clients render it but
   * resolve NO damage — see Game.ts setKameHandler → kame.fire(...,false)), then
   * resolve the lethal hitscan HERE on the server. The aim leads the target's
   * CURRENT position with the same LEAD_FACTOR as a normal shot, so a player who
   * dashed/jumped out of the beam during the telegraph takes ZERO.
   */
  private fireSuper(
    room: string,
    b: ServerBot,
    tpos: { x: number; z: number; grounded: boolean },
  ) {
    const tid = b.superTargetId;
    if (!tid) return;
    const est = this.targetVel.get(tid);
    const aimX = tpos.x + (est?.vx ?? 0) * LEAD_FACTOR * b.leadMul;
    const aimZ = tpos.z + (est?.vz ?? 0) * LEAD_FACTOR * b.leadMul;
    const ddx = aimX - b.x;
    const ddz = aimZ - b.z;
    const dlen = Math.hypot(ddx, ddz) || 1;
    const dir = { x: ddx / dlen, y: 0, z: ddz / dlen };

    const seq = this.shotSeq++;
    // (1) VISUAL: matches the player KameEvent shape {id, origin, dir}. The client
    // renders the beam from the remote's rendered muzzle, damaging=false. `seq`
    // correlates the beam with its scheduled damage (impact gate, Phase 3).
    this.fanout(room, "kame", {
      id: b.id,
      origin: { x: b.x, y: MUZZLE_Y, z: b.z },
      dir,
      seq,
    }, b.id);

    // (2) DODGE GATE (resolved NOW, at fire time — preserves the locked dash/jump
    // dodge promise): only if the target is still a live, GROUNDED player within
    // SUPER_RANGE AND within the beam half-width of the aim ray (≈14° cone).
    if (!this.hub.isPlayer(room, tid)) return;
    // An airborne target is above the low horizontal beam, so a player who JUMPED
    // (or dashed) in reaction to the ~1.2s telegraph takes ZERO. The server has no
    // terrain model, so the snapshot's grounded flag is the dodge signal.
    if (!tpos.grounded) return;
    const px = tpos.x - b.x;
    const pz = tpos.z - b.z;
    const along = px * dir.x + pz * dir.z; // projection onto the aim ray
    if (along <= 0 || along > SUPER_RANGE) return; // behind the bot or out of range
    const perp = Math.abs(px * dir.z - pz * dir.x); // perpendicular distance to the ray
    if (perp > SUPER_CONE_HALF_WIDTH) return; // outside the beam → missed

    // (3) DAMAGE: scheduled to land with the beam's blast FX (SUPER_REVEAL_MS),
    // not synchronously — so the victim sees the beam before taking it.
    this.hub.enqueueHit(room, {
      applyAt: Date.now() + SUPER_REVEAL_MS,
      resolve: () => this.resolveSuper(room, b, tid, seq),
    });
  }

  /**
   * Apply a scheduled super hit (shield-first up to SUPER_DAMAGE) at beam-reveal
   * time. Mirrors the old synchronous tail of fireSuper(); damagePlayer null-guards
   * a target that died/dodged-out meanwhile.
   */
  private resolveSuper(room: string, b: ServerBot, tid: string, seq: number) {
    // Drain through any shields then HP: each damagePlayer soaks 1 shield or 1 HP.
    let res: HitResult | null = null;
    for (let i = 0; i < SUPER_DAMAGE; i++) {
      const r = this.hub.damagePlayer(room, tid, b.id);
      if (!r) break; // target vanished mid-loop
      res = r;
      if (r.died) break;
    }
    if (!res) return;

    // Victim cue so the player predicts the damage locally (mirrors fire()).
    this.fanout(room, "hit", { target: tid, from: b.id, fromName: b.name, seq }, b.id);

    if (res.died) {
      this.fanout(room, "died", { id: tid, x: res.x, z: res.z, by: b.id, seq }, b.id);
      this.fanout(room, "kill", {
        id: `srvk_${this.killSeq++}`,
        killer: b.name,
        victim: res.victimName,
        streak: 0,
      }, b.id);
    }
  }

  /**
   * Dash in a direction but bail to a safer heading if the lunge would carry the
   * bot off the arena (never dash into a wall). Tries the requested direction,
   * then its mirror, then toward arena center — whichever lands in bounds.
   */
  private dashSafely(room: string, b: ServerBot, dirX: number, dirZ: number) {
    const reach = DASH_SPEED / DASH_DECAY; // ≈ how far the decaying impulse travels
    const candidates: [number, number][] = [
      [dirX, dirZ],
      [-dirX, -dirZ],
      [-b.x, -b.z], // toward arena center
    ];
    for (const [cx, cz] of candidates) {
      const len = Math.hypot(cx, cz) || 1;
      const nx = cx / len;
      const nz = cz / len;
      const ex = b.x + nx * reach;
      const ez = b.z + nz * reach;
      if (Math.abs(ex) <= ARENA_HALF && Math.abs(ez) <= ARENA_HALF) {
        this.startDash(room, b, nx, nz);
        return;
      }
    }
    // Every heading leaves the arena (cornered) → skip this dash, keep the cooldown.
    b.dashCd = DASH_CD_MIN + rand() * DASH_CD_RND;
  }

  /**
   * Choose the best power-up for `b` to walk toward, or null if none is worth it.
   * Higher value wins: base-by-kind (heal is contextual — worth a lot only when
   * hurt) minus a distance penalty minus a backtrack/detour penalty (an item
   * behind the bot is a worse pickup than one ahead). Only items inside the seek
   * radius (a wider radius for a HURT bot reaching for a heal/shield) and above
   * SEEK_MIN_VALUE qualify. Scans the shared `items` array — allocates nothing.
   */
  private pickSeekItem(
    b: ServerBot,
    items: { id: string; kind: string; x: number; z: number }[],
  ): { id: string; kind: string; x: number; z: number } | null {
    const hurt = b.health <= LOW_HP;
    // Current facing as a unit vector, for the detour (backtrack) penalty.
    const fx = Math.cos(b.yaw);
    const fz = Math.sin(b.yaw);
    let best: { id: string; kind: string; x: number; z: number } | null = null;
    let bestVal = -Infinity;
    for (const it of items) {
      const dx = it.x - b.x;
      const dz = it.z - b.z;
      const dist = Math.hypot(dx, dz) || 0.0001;
      // A hurt bot may reach further for restoratives (heal/shield/super-as-shield).
      const restorative = it.kind === "heal" || it.kind === "shield" || it.kind === "super";
      const radius = hurt && restorative ? HEAL_SEEK_RADIUS : SEEK_RADIUS;
      if (dist > radius) continue;
      // heal is only valuable when the bot is actually hurt; everything else uses
      // its fixed base. Unknown kinds score 0 (won't clear SEEK_MIN_VALUE).
      let base = ITEM_BASE_VALUE[it.kind] ?? 0;
      if (it.kind === "heal" && hurt) base = 10;
      // Angle between current facing and the item heading (0 = straight ahead,
      // π = directly behind) → a backtrack penalty.
      const dot = (fx * dx + fz * dz) / dist; // cos(angle), clamped below
      const ang = Math.acos(Math.max(-1, Math.min(1, dot)));
      const value = base - dist * DIST_PENALTY - (ang / Math.PI) * DETOUR_PENALTY;
      if (value >= SEEK_MIN_VALUE && value > bestVal) {
        bestVal = value;
        best = it;
      }
    }
    return best;
  }

  /**
   * Fire a normal shot at `tgt`: broadcast the tracer NOW, but SCHEDULE the
   * damage to land when the visible bullet arrives (`dist/BULLET_SPEED` later)
   * instead of applying it synchronously — so the victim SEES the shot before
   * taking it. The accuracy roll is decided now (deterministic); only the
   * application is deferred. See netcode-hit-sync-plan.md (Phase 1).
   */
  private fire(room: string, b: ServerBot, tgt: Target) {
    // Lead the aim slightly toward where a MOVING target is heading — this is the
    // COSMETIC tracer direction for OBSERVERS. Bots are treated as stationary
    // (vx/vz=0) so this only bites on real players.
    const aimX = tgt.x + tgt.vx * LEAD_FACTOR * b.leadMul;
    const aimZ = tgt.z + tgt.vz * LEAD_FACTOR * b.leadMul;
    const dx = aimX - b.x;
    const dz = aimZ - b.z;
    const leadDist = Math.hypot(dx, dz) || 1;
    const dir = { x: dx / leadDist, y: 0, z: dz / leadDist };
    const seq = this.shotSeq++;
    // Accuracy decided NOW (deterministic); damage applied ON ARRIVAL.
    const hits = rand() <= b.accEff;
    const hitsPlayer = hits && this.hub.isPlayer(room, tgt.id);
    // Visual tracer. A shot that WILL hit a PLAYER carries `targetId` so that
    // victim's client anchors the tracer to this absolute origin and aims it AT
    // itself — the bullet visibly crosses the player (Phase 2). Misses + shots at
    // bots keep the lead-aimed cosmetic tracer. `seq` correlates tracer↔damage.
    this.fanout(room, "shot", {
      id: b.id,
      origin: { x: b.x, y: MUZZLE_Y, z: b.z },
      dir,
      color: BULLET_COLOR,
      seq,
      ...(hitsPlayer ? { targetId: tgt.id } : {}),
    }, b.id);

    if (!hits) return;
    const targetId = tgt.id;
    // Schedule using the distance to the ACTUAL target (what the victim's
    // aim-at-self tracer traverses), floored for point-blank readability.
    const tdx = tgt.x - b.x;
    const tdz = tgt.z - b.z;
    const targetDist = Math.hypot(tdx, tdz) || 1;
    const applyAt = Date.now() + Math.max(MIN_TRAVEL_MS, (targetDist / BULLET_SPEED) * 1000);
    this.hub.enqueueHit(room, {
      applyAt,
      resolve: () => this.resolveShot(room, b, targetId, seq),
    });
  }

  /**
   * Apply a scheduled normal-shot hit (damage + cues) at the bullet's arrival
   * time. Mirrors the old synchronous tail of `fire()`. `damagePlayer`/
   * `damageBot` null-guard a target that died in the ~0.3s flight, so a late
   * bullet landing on a corpse simply no-ops (correct: the bullet was real).
   */
  private resolveShot(room: string, b: ServerBot, targetId: string, seq: number) {
    const res =
      this.hub.damagePlayer(room, targetId, b.id) ?? this.damageBot(room, targetId, b.id);
    if (!res) return;

    // Player victim: send a "hit" cue so the victim predicts the damage locally
    // (its own health is client-side; the server independently enforces it).
    if (this.hub.isPlayer(room, targetId)) {
      this.fanout(room, "hit", { target: targetId, from: b.id, fromName: b.name, seq }, b.id);
    }

    if (res.died) {
      this.fanout(room, "died", { id: targetId, x: res.x, z: res.z, by: b.id, seq }, b.id);
      // Bots are the killer here → the SERVER owns this feed line (player-killers
      // are surfaced client-side). Everyone sees it.
      this.fanout(room, "kill", {
        id: `srvk_${this.killSeq++}`,
        killer: b.name,
        victim: res.victimName,
        streak: 0,
      }, b.id);
    }
  }

  /** Recompute the cached feel values from b.skill. Variance spreads AROUND the
   *  owner-locked means: E[accEff]=ACCURACY, E[cadenceMul]=E[leadMul]=1 at E[skill]=0.5.
   *  No clamp — raw accEff range [0.21,0.39] is already valid at ACCURACY=0.3. */
  private deriveSkill(b: ServerBot): void {
    b.accEff = ACCURACY * (0.7 + 0.6 * b.skill);
    b.cadenceMul = 1.25 - 0.5 * b.skill;
    b.leadMul = 0.5 + b.skill;
  }

  /** TEST-ONLY read of internal bot state (no allocation in tick path). */
  inspect(room: string): Record<string, unknown>[] {
    if (room !== GAME_ROOM) return [];
    return [...this.bots.values()].map((b) => ({
      id: b.id, name: b.name, animal: b.animal, x: b.x, z: b.z, yaw: b.yaw,
      health: b.health, alive: b.alive, skill: b.skill, accEff: b.accEff,
      cadenceMul: b.cadenceMul, leadMul: b.leadMul, targetId: b.targetId,
      pendingTargetId: (b as any).pendingTargetId ?? null, commitT: (b as any).commitT ?? 0,
      reactT: (b as any).reactT ?? 0, superHesitateT: (b as any).superHesitateT ?? 0,
      kameCharging: b.kameCharging, kills: (b as any).kills ?? 0, streak: (b as any).streak ?? 0,
    }));
  }
}
