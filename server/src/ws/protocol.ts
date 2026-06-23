import type { WebSocket } from "ws";

/**
 * WebSocket wire protocol — the single source of truth for the same-origin
 * `/ws?room=<name>&id=<clientId>` endpoint. The browser client (`ServerRoom` in
 * `src/game/net/Room.ts`) mirrors these exact shapes.
 *
 * Two logical rooms ride the same socket-per-room model (one socket per room
 * name, exactly like the two `createRoom()` calls today): `voxelcube-ffa`
 * (game) and `voxelcube-voice` (voice). All frames are JSON text. The server
 * NEVER echoes a sender's own message back to itself (matches the old Supabase
 * `broadcast:{self:false}` and LocalRoom's `d.from !== this.id`).
 */

/** A presence member: stable id + arbitrary meta (the client's `track()` payload). */
export interface Member {
  id: string;
  meta: Record<string, unknown>;
}

/**
 * The 11 movement fields from an "s" broadcast snapshot, stored server-side
 * so AFK/disconnected avatars can be re-emitted with the last known position.
 */
export interface NetSnapshot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  health: number;
  alive: boolean;
  state: string;
  name?: string;
  animal?: string;
}

/** Client → server frames. */
export type ClientMsg =
  // Sent immediately on socket open: registers presence + initial meta. Idempotent.
  | { t: "join"; id?: string; meta?: Record<string, unknown> }
  // Replace this client's presence meta (e.g. leaderboard PresenceInfo, or {id} for voice).
  | { t: "track"; meta: Record<string, unknown> }
  // Fire-and-forget. `to` present => unicast relay to that one peer (WebRTC sig);
  // absent => fan-out to all OTHERS in the room (game state "s").
  | { t: "broadcast"; event: string; payload: unknown; to?: string }
  // Server-authoritative hit: the shooter reports a hit to the server (damage authority).
  // Server applies damage to the target, never trusting the victim client.
  | { t: "hit"; target: string }
  // Optional graceful leave (socket close also triggers leave).
  | { t: "leave" }
  // Optional keepalive (server also runs ws-level ping/pong).
  | { t: "ping" };

/** Server → client frames. */
export type ServerMsg =
  // Once, right after join is accepted (join-ack => client emits onStatus("online")).
  // `seed` is the room's authoritative uint32 world seed, stable for the room's
  // lifetime: every client deterministically rebuilds the identical world from it.
  // The frame ENVELOPE is gated by a fixed 6-type allowlist (CLIENT_TYPES below:
  // join/track/broadcast/hit/leave/ping); anything else is dropped at parse. The
  // inner `broadcast` event name is still free-form and relayed as-is, EXCEPT that
  // the server intercepts two of them server-authoritatively before fan-out: an "s"
  // frame's health/alive is overwritten from the server Player record, and a
  // "kamehit" aimed at a server bot is resolved (bot killed + "died" emitted) by the
  // server. The "hit" envelope is likewise server-applied (1 dmg to a live target),
  // not relayed verbatim. So the seed is the only fully server-authoritative SHARED
  // state, but HP/alive and bot deaths are server-arbitrated on top of the relay.
  | { t: "welcome"; id: string; room: string; seed: number }
  // FULL roster of the room (incl. self). Sent to a joiner and to everyone on any change.
  | { t: "presence"; members: Member[] }
  // A relayed broadcast from another member; `from` is the sender's server-known id.
  | { t: "broadcast"; event: string; payload: unknown; from: string }
  | { t: "pong" };

/** A connected socket augmented with room/identity/presence + heartbeat state. */
export type Sock = WebSocket & {
  id: string;
  room: string;
  meta: Record<string, unknown>;
  isAlive: boolean;
  /** Wall-clock of the last TCP-level pong (heartbeat liveness, ms). */
  lastPong: number;
  /**
   * Set when the socket has gone silent on the pong channel past a threshold:
   * the server stops relaying this socket's OWN (now stale) "s" pose frames. A
   * conservative flag only — the socket is NEVER kicked off this signal.
   */
  idle: boolean;
};

const CLIENT_TYPES = new Set(["join", "track", "broadcast", "hit", "leave", "ping"]);

/**
 * Parse + validate a raw WS frame into a ClientMsg, or null if malformed.
 *
 * Accepts the `ws` library's `RawData` (Buffer | ArrayBuffer | Buffer[]) or a
 * string, so the caller can hand the frame straight through WITHOUT a redundant
 * `raw.toString()` on its hot path. A single UTF-8 decode happens here (the one
 * `JSON.parse` needs anyway) — anything that isn't text/bytes is rejected.
 */
export function parseClientMsg(raw: unknown): ClientMsg | null {
  let text: string;
  if (typeof raw === "string") {
    text = raw;
  } else if (Buffer.isBuffer(raw)) {
    text = raw.toString();
  } else if (raw instanceof ArrayBuffer) {
    text = Buffer.from(raw).toString();
  } else if (Array.isArray(raw)) {
    text = Buffer.concat(raw as Buffer[]).toString();
  } else {
    return null; // not a text/bytes frame
  }
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const t = (v as { t?: unknown }).t;
  if (typeof t !== "string" || !CLIENT_TYPES.has(t)) return null;
  return v as ClientMsg;
}
