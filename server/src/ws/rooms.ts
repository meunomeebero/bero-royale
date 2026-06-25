import { WebSocket } from "ws";
import type { Member, NetSnapshot, ServerMsg, Sock } from "./protocol";
import { BotSim, type HitResult } from "./bots";
import { PowerUpSim } from "./powerups";

/**
 * In-memory presence registry + fan-out helper.
 *
 * A pure data structure: it knows nothing about the `WebSocketServer` or the
 * HTTP upgrade dance, so it can be unit-tested with fake sockets. It owns the
 * mapping of room name -> id -> socket and the rules for relaying frames
 * between them.
 *
 * Wave 2: players now OUTLIVE their socket — a per-room `Player` record carries
 * authoritative health/alive and persists through a GRACE_MS window after
 * disconnect so AFK avatars stay killable. Health and alive are server-owned;
 * the client's reported values are advisory only.
 */

/**
 * Backpressure cap for the high-frequency, stale-superseded "s" snapshot stream.
 * A socket whose send queue already exceeds this many bytes is skipped for the
 * NEXT "s" frame (the one we'd drop is immediately superseded by the following
 * tick anyway), which bounds server memory under a slow client. Reliable one-shot
 * events (shot/dash/jump/died/kill/chat/kame/presence/handshake) are NEVER dropped
 * — only the snapshot channel is droppable.
 */
const SNAPSHOT_BACKPRESSURE_BYTES = 64 * 1024;

/** How long a disconnected player's avatar lingers before the server drops it. */
const GRACE_MS = 45_000;
/** A dead player with no socket is removed after this short TTL. */
const DEAD_TTL = 5_000;
/** Starting health for every player. */
const MAX_HEALTH = 10;
/** BR-style shield charges absorbed before health (mirrors the client). */
const MAX_SHIELD = 10;
/**
 * Safety window after a server-applied death within which an owner's alive=true
 * frame is IGNORED unless the death was acknowledged. Blocks the kill-race where
 * the victim's in-flight alive=true snapshots arrive after applyHit marked it
 * dead but before its client registered the kill (which would instantly revive a
 * just-killed player and erase the kill). Longer than any plausible RTT, shorter
 * than the client respawn delay so a stuck/unacked death still self-heals.
 */
const REVIVE_FALLBACK_MS = 3_000;

/** Per-room, per-player server-authoritative state. */
export interface Player {
  id: string;
  /** Live socket; null when disconnected (grace period). */
  sock: Sock | null;
  /** Presence meta (for leaderboard / roster). */
  meta: Record<string, unknown>;
  /** Last movement snapshot received from this player's "s" frame. */
  lastS: NetSnapshot | null;
  health: number;
  /** Accumulated shield charges — soaked BEFORE health (BR-style armor). */
  shield: number;
  alive: boolean;
  /** Timestamp of death (0 if alive). */
  deadAt: number;
  /**
   * Deadline after which the server removes the player from the room.
   * Infinity while socket is connected; now+GRACE_MS on disconnect;
   * now on graceful leave (immediate removal).
   */
  graceUntil: number;
  /** Timestamp of last "s" frame (used for presence-removal ordering). */
  lastSeen: number;
  /**
   * True once the owner has acknowledged its current death (broadcast alive=false
   * since dying). False from the moment applyHit marks the player dead until that
   * ack. Gates owner-respawn so an in-flight pre-death frame can't revive a
   * just-killed player. Irrelevant (and reset) while alive.
   */
  acked: boolean;
}

/**
 * A damage event scheduled to resolve when its visible projectile is DUE to
 * arrive (`applyAt`), so the damage + its "hit"/"died" cues land WITH the tracer
 * the victim sees — not 0.3-0.4s before it ("die to an invisible shot"). Drained
 * each room tick. See `docs/systems/netcode-hit-sync-plan.md` (Phase 1).
 */
export interface PendingHit {
  /** Server clock (ms) at/after which the hit resolves. */
  applyAt: number;
  /** Apply the damage + fan out its cues. Idempotent vs a dead/gone target. */
  resolve: () => void;
}

export class RoomHub {
  /**
   * One authoritative uint32 world seed per live room, generated when the room
   * is first created and stable for its lifetime so late joiners build the
   * identical world. Dropped when the room empties (next cohort gets a fresh
   * arena).
   */
  private seeds = new Map<string, number>();

  /**
   * Per-room queue of damage events scheduled to land WHEN their visible tracer
   * arrives (impact-tick scheduler). Drained by `drainPendingHits` on the bot
   * loop. Replaces synchronous bot damage so a player never dies before seeing
   * the shot. See `docs/systems/netcode-hit-sync-plan.md`.
   */
  private pendingHits = new Map<string, PendingHit[]>();

  /**
   * Per-room player registry that outlives individual sockets.
   * Outer key = room name; inner key = player id.
   */
  private players = new Map<string, Map<string, Player>>();

  /** Server-driven bots (one shared set per game room), broadcast as pseudo-players. */
  readonly botSim = new BotSim(this);

  /** Server-driven power-ups (one shared set per game room), broadcast as events. */
  readonly powerupSim = new PowerUpSim(this);

  // ---------------------------------------------------------------------------
  // Room lifecycle
  // ---------------------------------------------------------------------------

  private getOrCreateRoom(room: string): Map<string, Player> {
    let inner = this.players.get(room);
    if (!inner) {
      inner = new Map<string, Player>();
      this.players.set(room, inner);
      this.seeds.set(room, (Math.floor(Math.random() * 0x100000000)) >>> 0);
    }
    return inner;
  }

  /**
   * Add a socket to a room. If the player already has a grace-window record
   * (reconnect), reuse health/alive/lastS and just rebind the socket.
   * If a different socket with the same id is already live, terminate it first.
   */
  join(room: string, s: Sock): void {
    const inner = this.getOrCreateRoom(room);
    const existing = inner.get(s.id);

    if (existing) {
      // Terminate any old live socket (reconnect / duplicate tab).
      if (existing.sock && existing.sock !== s) {
        existing.sock.terminate();
      }
      // Rebind socket and lift grace (connected = immortal TTL).
      existing.sock = s;
      existing.graceUntil = Infinity;
      existing.meta = s.meta;
    } else {
      // Fresh player.
      inner.set(s.id, {
        id: s.id,
        sock: s,
        meta: s.meta,
        lastS: null,
        health: MAX_HEALTH,
        shield: 0,
        alive: true,
        deadAt: 0,
        graceUntil: Infinity,
        lastSeen: Date.now(),
        acked: false,
      });
    }
  }

  /**
   * Called on socket close (NOT on graceful leave). Does NOT delete the player;
   * instead sets sock=null and starts the grace countdown so the avatar lingers.
   * The identity guard prevents a stale socket's close handler from stomping a
   * freshly-joined reconnect.
   */
  leave(s: Sock): void {
    const inner = this.players.get(s.room);
    const p = inner?.get(s.id);
    if (!p || p.sock !== s) return; // stale handler — ignore
    p.sock = null;
    p.graceUntil = Date.now() + GRACE_MS;
  }

  /**
   * Graceful leave (explicit {t:"leave"} message). Sets grace to now so the
   * sweep removes the player on its very next tick.
   */
  gracefulLeave(s: Sock): void {
    const inner = this.players.get(s.room);
    const p = inner?.get(s.id);
    if (!p || p.sock !== s) return;
    p.sock = null;
    p.graceUntil = Date.now(); // expire immediately
  }

  // ---------------------------------------------------------------------------
  // Authoritative game state
  // ---------------------------------------------------------------------------

  /**
   * Store the latest movement snapshot from a player's "s" frame.
   * Health/alive are NOT taken from the snapshot — the server owns those.
   */
  recordState(room: string, id: string, snap: NetSnapshot): void {
    const p = this.players.get(room)?.get(id);
    if (!p) return;
    p.lastS = snap;
    p.lastSeen = Date.now();

    if (snap.alive === false) {
      // Owner reports its OWN death (fell off the arena, lava, a kamehameha, or it
      // just registered the killing shots). Honor it — a client can always kill
      // itself — and treat it as the ACK of any pending server-applied death.
      // Honoring self-death here is also what makes fall/lava/kamehameha deaths
      // visible to everyone: the "s" relay (index.ts) overwrites alive from this
      // record, so without this those deaths would be reverted to alive=true.
      if (p.alive) {
        p.alive = false;
        p.health = 0;
        p.shield = 0;
        p.deadAt = Date.now();
      }
      p.acked = true;
    } else if (!p.alive) {
      // Owner asserts alive again => a respawn request. Trust-bounded (only the
      // owner revives itself), but ONLY once the death is acknowledged (the owner
      // broadcast alive=false since dying) or a safety window has elapsed. This is
      // the kill-race fix: a victim's in-flight alive=true frames that land right
      // after applyHit marked it dead would otherwise instantly revive it and
      // erase the kill (no death seen by the killer => no credit / feed / board).
      if (p.acked || Date.now() - p.deadAt > REVIVE_FALLBACK_MS) {
        p.health = MAX_HEALTH;
        p.shield = 0; // shields are lost on death (respawn fresh)
        p.alive = true;
        p.deadAt = 0;
        p.acked = false;
        this.syncOwnerHP(p); // HUD snaps back to full on the authoritative respawn
      }
    }
  }

  /**
   * Apply one point of damage to ANY target — a player or a server bot. Returns
   * the result so the caller can broadcast a "died" event, or null if unknown.
   */
  applyHit(room: string, targetId: string, byId: string): HitResult | null {
    return (
      this.damagePlayer(room, targetId, byId) ??
      this.botSim.damageBot(room, targetId, byId)
    );
  }

  /**
   * Apply one point of damage to a PLAYER (works even when the socket is null
   * during the grace window). Public so the bot sim can hit players too.
   *
   * Every mutation echoes the new authoritative health+shield back to the
   * victim's OWN socket (the "honest HUD" sync): the owner never receives its
   * own relayed "s" frame, so without this its HP bar is a pure local guess that
   * drifts from server truth — the root cause of "died at full HP/shield". With
   * the echo, a victim whose client under-predicts (e.g. a 5-dmg super cued as a
   * single "hit") reconciles to the real value within one RTT.
   */
  damagePlayer(room: string, targetId: string, byId: string): HitResult | null {
    const p = this.players.get(room)?.get(targetId);
    if (!p || !p.alive) return null;
    const victimName = (p.meta?.["name"] as string) ?? "Alguém";

    // Shield charges (BR armor) soak the hit before health.
    if (p.shield > 0) {
      p.shield -= 1;
      this.syncOwnerHP(p);
      return { died: false, x: p.lastS?.x ?? 0, z: p.lastS?.z ?? 0, byId, victimName };
    }
    p.health = Math.max(0, p.health - 1);
    this.syncOwnerHP(p);
    if (p.health <= 0 && p.alive) {
      p.alive = false;
      p.deadAt = Date.now();
      p.acked = false; // not acknowledged until the victim broadcasts alive=false
      return { died: true, x: p.lastS?.x ?? 0, z: p.lastS?.z ?? 0, byId, victimName };
    }
    return { died: false, x: p.lastS?.x ?? 0, z: p.lastS?.z ?? 0, byId, victimName };
  }

  /**
   * Apply up to `n` points of damage to a player in one resolution (shield-first
   * via repeated damagePlayer), stopping the instant it kills. Used by any
   * multi-point hit — the concentrated super (player AND bot) — so both share the
   * exact same shield-first model and the same per-point HUD echo. Returns the
   * final HitResult (whichever point landed last), or null if the target vanished.
   */
  damagePlayerN(room: string, targetId: string, byId: string, n: number): HitResult | null {
    let res: HitResult | null = null;
    for (let i = 0; i < n; i++) {
      const r = this.damagePlayer(room, targetId, byId);
      if (!r) break; // target vanished / already dead
      res = r;
      if (r.died) break;
    }
    return res;
  }

  // ---------------------------------------------------------------------------
  // Impact-tick scheduler (damage-on-arrival) — see netcode-hit-sync-plan.md
  // ---------------------------------------------------------------------------

  /** Schedule a hit to resolve at `hit.applyAt` (drained on the room tick). */
  enqueueHit(room: string, hit: PendingHit): void {
    let q = this.pendingHits.get(room);
    if (!q) {
      q = [];
      this.pendingHits.set(room, q);
    }
    q.push(hit);
    // Defensive cap: a runaway producer can never grow the queue unbounded.
    if (q.length > 512) q.splice(0, q.length - 512);
  }

  /**
   * Resolve every pending hit whose `applyAt` has passed; keep the rest
   * (compacted in place — no per-tick allocation). Called once per room tick
   * from the bot loop. Resolution order = insertion order among the due entries;
   * `damagePlayer`/`damageBot` null-guard a target that already died, so a late
   * bullet landing on a corpse simply no-ops.
   */
  drainPendingHits(room: string, now: number): void {
    const q = this.pendingHits.get(room);
    if (!q || q.length === 0) return;
    let w = 0;
    for (let r = 0; r < q.length; r++) {
      const e = q[r];
      if (e.applyAt <= now) e.resolve();
      else q[w++] = e;
    }
    q.length = w;
  }

  /**
   * Echo a player's authoritative health+shield to its OWN socket so its HUD
   * tracks server truth (see damagePlayer). A one-way unicast on the same
   * `broadcast` envelope the client already routes by event name; no-op while the
   * socket is gone (grace window) — the values re-sync on reconnect via "s".
   */
  private syncOwnerHP(p: Player): void {
    if (!p.sock || p.sock.readyState !== WebSocket.OPEN) return;
    const msg: ServerMsg = {
      t: "broadcast",
      event: "hp",
      payload: { health: p.health, shield: p.shield },
      from: "",
    };
    p.sock.send(JSON.stringify(msg));
  }

  /** True if `id` is a live player record in `room` (vs a bot or unknown). */
  isPlayer(room: string, id: string): boolean {
    return !!this.players.get(room)?.has(id);
  }

  /** Grant one shield charge to a player (BR armor), capped — on shield pickup. */
  addShield(room: string, id: string): void {
    const p = this.players.get(room)?.get(id);
    if (!p || !p.alive) return;
    p.shield = Math.min(p.shield + 1, MAX_SHIELD);
    this.syncOwnerHP(p);
  }

  /**
   * Restore a player to full health — on a "heal" pickup. Server-AUTHORITATIVE
   * (mirrors addShield) so the "hp" echo carries the healed value: without this
   * the heal was client-only and the very next damagePlayer synced the un-healed
   * server health back, reverting the heal ("heal didn't stick" bug). Clamped to
   * the server's flat MAX_HEALTH (no boss multiplier here — keep server the cap).
   */
  healPlayer(room: string, id: string): void {
    const p = this.players.get(room)?.get(id);
    if (!p || !p.alive) return;
    p.health = MAX_HEALTH;
    this.syncOwnerHP(p);
  }

  /** Positions of alive players (with a last snapshot) — bot targeting input.
   *  `grounded` rides along so the bot super can let an airborne (jumped) target
   *  dodge the low horizontal beam (the server has no terrain model, so the
   *  snapshot's own grounded flag is the terrain-independent dodge signal). */
  playerTargets(
    room: string,
  ): { id: string; x: number; z: number; grounded: boolean }[] {
    const inner = this.players.get(room);
    if (!inner) return [];
    const out: { id: string; x: number; z: number; grounded: boolean }[] = [];
    for (const p of inner.values()) {
      if (p.alive && p.lastS)
        out.push({ id: p.id, x: p.lastS.x, z: p.lastS.z, grounded: p.lastS.grounded });
    }
    return out;
  }

  /**
   * Remove players whose grace window has expired. Returns the ids of removed
   * players so the caller can broadcast presence.
   * Also removes dead players with no socket who have exceeded DEAD_TTL.
   */
  sweepExpired(room: string): string[] {
    const inner = this.players.get(room);
    if (!inner) return [];
    const now = Date.now();
    const removed: string[] = [];
    for (const [id, p] of inner) {
      const graceExpired = p.graceUntil < now;
      const deadNoSocket = !p.sock && !p.alive && now - p.deadAt > DEAD_TTL;
      if (graceExpired || deadNoSocket) {
        inner.delete(id);
        removed.push(id);
      }
    }
    // Drop empty rooms (also clears any server bots + power-ups for that room).
    if (inner.size === 0) {
      this.players.delete(room);
      this.seeds.delete(room);
      this.pendingHits.delete(room);
      this.botSim.clearRoom(room);
      this.powerupSim.clearRoom(room);
    }
    return removed;
  }

  /**
   * Get all room names that have at least one player (live or grace).
   */
  allRooms(): string[] {
    return [...this.players.keys()];
  }

  // ---------------------------------------------------------------------------
  // Presence / roster helpers
  // ---------------------------------------------------------------------------

  /** The authoritative world seed for a room (0 if the room is unknown). */
  seedOf(room: string): number {
    return this.seeds.get(room) ?? 0;
  }

  /**
   * Full roster as presence members. `meta` is augmented with a `present`
   * boolean (true = live socket, false = grace window) so clients can render
   * disconnected avatars as still/frozen.
   */
  roster(room: string): Member[] {
    const inner = this.players.get(room);
    const members: Member[] = inner
      ? [...inner.values()].map((p) => ({
          id: p.id,
          meta: {
            ...p.meta,
            present: p.sock !== null && p.sock.readyState === WebSocket.OPEN,
            isBot: false,
          },
        }))
      : [];
    // Server bots are presence members too (so clients render + count + list them).
    return [...members, ...this.botSim.rosterMembers(room)];
  }

  /** Number of players (live + grace) currently in a room. */
  sizeOf(room: string): number {
    return this.players.get(room)?.size ?? 0;
  }

  /** Number of players with a live OPEN socket in a room (for capacity checks). */
  liveSizeOf(room: string): number {
    const inner = this.players.get(room);
    if (!inner) return 0;
    let count = 0;
    for (const p of inner.values()) {
      if (p.sock && p.sock.readyState === WebSocket.OPEN) count++;
    }
    return count;
  }

  /**
   * Get the authoritative Player record for a given id (used by index.ts to
   * overwrite health/alive on "s" relays).
   */
  getPlayer(room: string, id: string): Player | undefined {
    return this.players.get(room)?.get(id);
  }

  // ---------------------------------------------------------------------------
  // Fan-out helpers (same interface as before)
  // ---------------------------------------------------------------------------

  /**
   * Send the authoritative full roster to EVERY open socket in the room,
   * including the socket the change originated from. Serialized once.
   */
  broadcastPresence(room: string): void {
    const inner = this.players.get(room);
    if (!inner) return;
    const msg: ServerMsg = { t: "presence", members: this.roster(room) };
    const data = JSON.stringify(msg);
    for (const p of inner.values()) {
      if (p.sock && p.sock.readyState === WebSocket.OPEN) p.sock.send(data);
    }
  }

  /**
   * Relay a frame to all open sockets in the room except the one whose id
   * matches `exceptId` (used to avoid echoing a broadcast back to its sender).
   *
   * Backpressure: only the high-frequency "s" snapshot stream is droppable — a
   * socket whose send queue already exceeds SNAPSHOT_BACKPRESSURE_BYTES is skipped
   * for THIS frame (the next tick's snapshot supersedes it anyway), which bounds
   * server memory under a slow client. Reliable one-shot events
   * (shot/dash/jump/died/kill/chat/kame/handshake) are ALWAYS sent.
   */
  fanout(room: string, msg: ServerMsg, exceptId?: string): void {
    const inner = this.players.get(room);
    if (!inner) return;
    const droppable = msg.t === "broadcast" && msg.event === "s";
    const data = JSON.stringify(msg);
    for (const p of inner.values()) {
      if (p.id === exceptId) continue;
      const sock = p.sock;
      if (!sock || sock.readyState !== WebSocket.OPEN) continue;
      // Skip a backlogged socket's snapshot — but never a reliable event.
      if (droppable && sock.bufferedAmount > SNAPSHOT_BACKPRESSURE_BYTES) continue;
      sock.send(data);
    }
  }

  /** Deliver a frame to the single open socket in the room with id === toId. */
  unicast(room: string, toId: string, msg: ServerMsg): void {
    const p = this.players.get(room)?.get(toId);
    if (p?.sock && p.sock.readyState === WebSocket.OPEN) {
      p.sock.send(JSON.stringify(msg));
    }
  }
}
