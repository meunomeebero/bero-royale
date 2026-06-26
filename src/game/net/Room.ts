/**
 * Transport seam for multiplayer + voice. Two interchangeable backends:
 *
 * - **LocalRoom** (BroadcastChannel): zero-config, same-origin, same-browser.
 *   Two `localhost` tabs find each other instantly — used for local testing
 *   with no server (opt in with `?local=1`). Presence is a lightweight
 *   heartbeat roster.
 * - **ServerRoom** (same-origin WebSocket): real cross-machine online over the
 *   bundled Elysia backend at `/ws?room=<name>&id=<clientId>`. Mirrors the wire
 *   contract in `server/src/ws/protocol.ts` exactly (ClientMsg / ServerMsg).
 *
 * `createRoom()` picks the backend automatically, so the game code never knows
 * which transport carries its presence + broadcast messages.
 *
 * Wave 2 additions:
 * - `sendHit(target)`: typed path for the server-authoritative hit model
 *   ({t:"hit";target}) — replaces the old broadcast "hit" fan-out.
 * - `present` field in presence meta: true = live socket, false = grace window.
 * - LocalRoom emulates applyHit + grace + present in-process so ?local=1
 *   two-tab damage / persistence testing still works.
 */

import { hashStringToUint32 } from "../rng";

export type RoomStatus = "connecting" | "online" | "error";
export type RoomKind = "local" | "online";
export type RoomMeta = Record<string, unknown>;

export interface RoomHandlers {
  /** Full member roster (id → presence meta) whenever it changes. */
  onPresence?: (members: Map<string, RoomMeta>) => void;
  /** Per-event broadcast handlers, keyed by event name. */
  onMessage?: Record<string, (payload: unknown) => void>;
  onStatus?: (status: RoomStatus) => void;
  /**
   * The room's authoritative world seed, delivered once on join. `decor` is the
   * active authored map's prop list (map editor v1) sent alongside the seed, or
   * undefined when there is no active map. It is RAW/untrusted here — the consumer
   * re-validates it (via `validateMapDef`) before building the world.
   */
  onSeed?: (seed: number, decor?: unknown) => void;
}

export interface Room {
  readonly id: string;
  readonly kind: RoomKind;
  connect(handlers: RoomHandlers): void;
  track(meta: RoomMeta): void;
  broadcast(event: string, payload: unknown): void;
  /**
   * Server-authoritative hit: report that this client shot `targetId`.
   * On ServerRoom this sends {t:"hit",target} directly to the server (bypasses
   * the fan-out so the server is damage authority). On LocalRoom this runs
   * applyHit in-process and emits "died" via BroadcastChannel if the target dies.
   */
  sendHit(targetId: string): void;
  /** Round-trip latency to the server in ms, or null if unknown / local room. */
  getPing(): number | null;
  dispose(): void;
}

export function createRoom(name: string, id: string): Room {
  const forceLocal =
    typeof location !== "undefined" && new URLSearchParams(location.search).has("local");
  return forceLocal ? new LocalRoom(id, name) : new ServerRoom(id, name);
}

// ---------------------------------------------------------------------------

class ServerRoom implements Room {
  readonly kind = "online" as const;
  private ws: WebSocket | null = null;
  private handlers: RoomHandlers = {};
  private meta: RoomMeta;
  private disposed = false;
  private reconnectTimer = 0;
  private reconnectPending = false;
  private backoff = 500;
  /** First close after a clean connection reconnects immediately (no delay). */
  private firstReconnect = true;
  /** Latest round-trip latency (ms) from the app-level ping/pong; null = unknown. */
  private lastPing: number | null = null;
  private pingTimer = 0;

  constructor(readonly id: string, private name: string) {
    this.meta = { id };
  }

  connect(h: RoomHandlers) {
    this.handlers = h;
    h.onStatus?.("connecting");
    this.open();
  }

  private open() {
    if (this.disposed) return;
    // Detach the previous socket's handlers so late events from the dead
    // socket can't re-enter (e.g. a delayed onclose doubling the backoff).
    if (this.ws) {
      this.ws.onopen = this.ws.onclose = this.ws.onerror = this.ws.onmessage = null;
    }
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const url =
      proto +
      "://" +
      location.host +
      "/ws?room=" +
      encodeURIComponent(this.name) +
      "&id=" +
      encodeURIComponent(this.id);
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.backoff = 500;
      // A clean connection re-arms the immediate-reconnect path: the FIRST drop
      // after we were online retries with zero delay (cuts dead time on a
      // transient blip), backing off only on repeated failures.
      this.firstReconnect = true;
      this.send({ t: "join", id: this.id, meta: this.meta });
      this.startPing();
    };

    ws.onmessage = (e) => {
      let msg: any;
      try {
        msg = JSON.parse(e.data as string);
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object") return;
      switch (msg.t) {
        case "welcome":
          this.handlers.onStatus?.("online");
          this.send({ t: "track", meta: this.meta }); // re-assert meta
          if (typeof msg.seed === "number") this.handlers.onSeed?.(msg.seed, msg.decor);
          break;
        case "presence": {
          const m = new Map<string, RoomMeta>();
          for (const member of msg.members ?? []) {
            const meta: RoomMeta = member.meta ?? { id: member.id };
            m.set((meta.id as string) ?? member.id, meta);
          }
          this.handlers.onPresence?.(m);
          break;
        }
        case "broadcast":
          this.handlers.onMessage?.[msg.event]?.(msg.payload);
          break;
        case "pong":
          if (typeof msg.ts === "number") {
            this.lastPing = Math.max(0, Math.round(Date.now() - msg.ts));
          }
          break;
      }
    };

    ws.onclose = (e) => {
      this.stopPing();
      this.lastPing = null; // latency unknown while disconnected
      this.handlers.onStatus?.("error");
      // Policy / capacity rejections (room full): retry slowly (~15s) instead
      // of hammering at the 2s cap. 1013 = "try again later", 1008 = policy violation.
      if (e.code === 1013 || e.code === 1008) {
        this.backoff = Math.max(this.backoff, 15000);
      }
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      this.handlers.onStatus?.("error");
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    // Guard against error+close both scheduling a reconnect for the same
    // failure (which would double the backoff per failure).
    if (this.disposed || this.reconnectPending) return;
    this.reconnectPending = true;
    // First drop after a clean connection: retry IMMEDIATELY (0ms) so a
    // transient blip doesn't cost a full backoff window. Policy/capacity
    // rejections (room full) already pushed backoff to ~15s above, which must
    // win over the immediate path — so only fast-path when backoff is small.
    const delay = this.firstReconnect && this.backoff <= 500 ? 0 : this.backoff;
    this.firstReconnect = false;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectPending = false;
      this.open();
    }, delay);
    this.backoff = Math.min(this.backoff * 2, 2000);
  }

  private send(obj: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  track(meta: RoomMeta) {
    this.meta = meta;
    this.send({ t: "track", meta });
  }

  broadcast(event: string, payload: unknown) {
    const env: any = { t: "broadcast", event, payload };
    // Lift a WebRTC "sig" payload's `to` up to the envelope so the server
    // unicasts to that peer; "s" has no `to` → fan-out to all others.
    if (payload && typeof payload === "object" && "to" in (payload as any)) {
      env.to = (payload as any).to;
    }
    this.send(env);
  }

  /**
   * Send a server-authoritative hit notification. The server applies damage
   * and broadcasts "died" if the target reaches 0 HP. Never echoed back to
   * the shooter, and throttled server-side by the same token bucket as broadcast.
   */
  sendHit(targetId: string) {
    this.send({ t: "hit", target: targetId });
  }

  /** App-level RTT probe: timestamped ping every 1s; pong echoes `ts` back. */
  private startPing() {
    this.stopPing();
    const probe = () => this.send({ t: "ping", ts: Date.now() });
    probe();
    this.pingTimer = window.setInterval(probe, 1000);
  }

  private stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = 0;
    }
  }

  getPing(): number | null {
    return this.lastPing;
  }

  dispose() {
    this.disposed = true;
    this.stopPing();
    clearTimeout(this.reconnectTimer);
    this.send({ t: "leave" });
    // Detach handlers before closing so a dispose-triggered onclose/onerror
    // can't fire onStatus("error") after we've torn down.
    if (this.ws) {
      this.ws.onopen = this.ws.onclose = this.ws.onerror = this.ws.onmessage = null;
      this.ws.close();
    }
    this.ws = null;
  }
}

// ---------------------------------------------------------------------------

interface LocalMsg {
  t: "hello" | "pres" | "bye" | "msg" | "hit";
  id?: string;
  meta?: RoomMeta;
  from?: string;
  event?: string;
  payload?: unknown;
  /** For "hit" messages: the target player id. */
  target?: string;
}

const HEARTBEAT_MS = 2000;
const STALE_MS = 6000;
/** Grace window for LocalRoom (mirrors server GRACE_MS, shorter for testing). */
const LOCAL_GRACE_MS = 10_000;
const LOCAL_MAX_HEALTH = 10;

interface LocalPlayer {
  meta: RoomMeta;
  seen: number;
  health: number;
  alive: boolean;
  deadAt: number;
  /** Timestamp after which the player is removed (Infinity = connected). */
  graceUntil: number;
  /** True = live heartbeat recently seen. */
  present: boolean;
}

class LocalRoom implements Room {
  readonly kind = "local" as const;
  private bc: BroadcastChannel | null = null;
  private meta: RoomMeta;
  private members = new Map<string, LocalPlayer>();
  private handlers: RoomHandlers = {};
  private heartbeat = 0;

  constructor(readonly id: string, private name: string) {
    this.meta = { id };
  }

  connect(h: RoomHandlers) {
    this.handlers = h;
    this.members.set(this.id, {
      meta: this.meta,
      seen: Date.now(),
      health: LOCAL_MAX_HEALTH,
      alive: true,
      deadAt: 0,
      graceUntil: Infinity,
      present: true,
    });
    h.onStatus?.("online");
    // Deterministic name-derived seed so two same-browser tabs build the
    // identical world (mirrors the server's per-room authoritative seed).
    h.onSeed?.(hashStringToUint32(this.name));
    if (typeof BroadcastChannel === "undefined") {
      this.emit(); // solo fallback (very old browser)
      return;
    }
    this.bc = new BroadcastChannel(`voxelcube:${this.name}`);
    this.bc.onmessage = (e) => this.onMsg(e.data as LocalMsg);
    this.post({ t: "hello", id: this.id });
    this.post({ t: "pres", id: this.id, meta: this.meta });
    this.heartbeat = window.setInterval(() => {
      this.post({ t: "pres", id: this.id, meta: this.meta });
      const now = Date.now();
      let changed = false;
      for (const [k, v] of this.members) {
        if (k === this.id) continue;
        // Mark as not-present if stale heartbeat.
        if (now - v.seen > STALE_MS && v.present) {
          v.present = false;
          v.graceUntil = now + LOCAL_GRACE_MS;
          changed = true;
        }
        // Remove after grace + dead TTL.
        if (v.graceUntil < now) {
          this.members.delete(k);
          changed = true;
        }
      }
      if (changed) this.emit();
    }, HEARTBEAT_MS);
    this.emit();
  }

  private onMsg(d: LocalMsg) {
    if (!d || d.id === this.id) return;
    if (d.t === "hello") {
      this.post({ t: "pres", id: this.id, meta: this.meta });
      return;
    }
    if (d.t === "pres" && d.id) {
      const existing = this.members.get(d.id);
      if (existing) {
        existing.meta = d.meta ?? { id: d.id };
        existing.seen = Date.now();
        existing.present = true;
        existing.graceUntil = Infinity;
      } else {
        this.members.set(d.id, {
          meta: d.meta ?? { id: d.id },
          seen: Date.now(),
          health: LOCAL_MAX_HEALTH,
          alive: true,
          deadAt: 0,
          graceUntil: Infinity,
          present: true,
        });
      }
      this.emit();
      return;
    }
    if (d.t === "bye" && d.id) {
      const p = this.members.get(d.id);
      if (p) {
        // Graceful leave: expire immediately.
        p.present = false;
        p.graceUntil = Date.now();
        this.emit();
      }
      return;
    }
    if (d.t === "hit" && d.from && d.from !== this.id && d.target) {
      // Emulate server applyHit in-process.
      const target = this.members.get(d.target);
      if (target && target.alive) {
        target.health = Math.max(0, target.health - 1);
        if (target.health <= 0) {
          target.alive = false;
          target.deadAt = Date.now();
          // Emit "died" as a broadcast message so Game.ts handles it identically.
          this.handlers.onMessage?.["died"]?.({
            id: d.target,
            x: 0,
            z: 0,
            by: d.from,
          });
        }
      }
      return;
    }
    if (d.t === "msg" && d.from !== this.id && d.event) {
      this.handlers.onMessage?.[d.event]?.(d.payload);
    }
  }

  track(meta: RoomMeta) {
    this.meta = meta;
    const p = this.members.get(this.id);
    if (p) {
      p.meta = meta;
      p.seen = Date.now();
    }
    this.post({ t: "pres", id: this.id, meta });
    this.emit();
  }

  broadcast(event: string, payload: unknown) {
    this.post({ t: "msg", from: this.id, event, payload });
  }

  /**
   * Emulate the server-authoritative hit: post a "hit" message to the
   * BroadcastChannel so the OTHER tab's LocalRoom.onMsg applies damage.
   */
  sendHit(targetId: string) {
    this.post({ t: "hit", from: this.id, id: this.id, target: targetId });
  }

  private emit() {
    if (!this.handlers.onPresence) return;
    const m = new Map<string, RoomMeta>();
    for (const [k, v] of this.members) {
      m.set(k, { ...v.meta, present: v.present });
    }
    this.handlers.onPresence(m);
  }

  private post(d: LocalMsg) {
    this.bc?.postMessage(d);
  }

  /** No server round-trip in local mode. */
  getPing(): number | null {
    return null;
  }

  dispose() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.post({ t: "bye", id: this.id });
    this.bc?.close();
    this.bc = null;
    this.members.clear();
  }
}
