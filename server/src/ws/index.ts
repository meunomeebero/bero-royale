import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import type { ClientMsg, NetSnapshot, ServerMsg, Sock } from "./protocol";
import { parseClientMsg } from "./protocol";
import { RoomHub } from "./rooms";
import { BOT_TICK_MS, BOT_TICK_SECONDS, SUPER_DAMAGE } from "./bots";

/** Hard cap on concurrent sockets per room. */
const MAX_ROOM = 64;
/** Hard cap on concurrent sockets across all rooms (global back-pressure). */
const MAX_TOTAL = 512;
/** The only room names the client ever opens; anything else is rejected. */
const ALLOWED_ROOMS = new Set(["voxelcube-ffa", "voxelcube-voice"]);
/** Heartbeat interval: ping every connection, terminate the ones that went silent. */
const HEARTBEAT_MS = 30_000;
/**
 * If a socket has not produced a TCP-level pong within this window it is flagged
 * idle, and the server stops relaying its OWN (stale) "s" pose frames to peers so
 * observers don't dead-reckon a frozen avatar. Set well above HEARTBEAT_MS so a
 * healthy player (which pongs every ~30s at the network layer even when its tab is
 * backgrounded) is never flagged. Conservative: this NEVER disconnects a player.
 */
const IDLE_POSE_MS = 75_000;
/** Grace-sweep interval: remove expired grace-window players and broadcast presence. */
const SWEEP_MS = 1_000;

/**
 * Per-socket token bucket throttling for `broadcast` AND `hit` frames.
 * Shard Cloud will pause an app it flags for network abuse, so we silently
 * drop a client that exceeds ~80 such frames/sec rather than relay an
 * unbounded firehose.
 */
const BUCKET_CAPACITY = 80;
const BUCKET_REFILL_PER_SEC = 80;

interface Bucket {
  tokens: number;
  last: number;
}

function takeToken(b: Bucket): boolean {
  const now = Date.now();
  const elapsed = (now - b.last) / 1000;
  if (elapsed > 0) {
    b.tokens = Math.min(BUCKET_CAPACITY, b.tokens + elapsed * BUCKET_REFILL_PER_SEC);
    b.last = now;
  }
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

/**
 * Wire the same-origin `/ws?room=<name>&id=<clientId>` endpoint onto an existing
 * Node HTTP server. Signature is fixed: the bootstrap calls
 * `attachWebSocket(server)` after the HTTP server is created.
 */
export function attachWebSocket(server: Server): RoomHub {
  // Explicit `maxPayload` bounds per-frame parse work and closes a DoS gap: the
  // `ws` default is 100MB, but every legit frame (an "s" snapshot is ~286B, the
  // largest is a presence roster) is well under 32KB, so anything bigger is abuse.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 });
  const hub = new RoomHub();
  const buckets = new WeakMap<Sock, Bucket>();

  // @elysiajs/node wires crossws for Elysia's own `.ws()` support, which adds an
  // "upgrade" listener. We don't use Elysia .ws() — we own all WebSocket traffic
  // via the `ws` lib — and a stray adapter upgrade handler would race ours and
  // close freshly-upgraded sockets. Strip any pre-existing upgrade listeners so
  // ours is authoritative.
  const removed = server.listenerCount("upgrade");
  if (removed > 0) {
    server.removeAllListeners("upgrade");
    console.log("[ws] removed", removed, "pre-existing upgrade listener(s)");
  }

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }
    // Global concurrency cap: refuse the handshake under sustained load.
    if (wss.clients.size >= MAX_TOTAL) {
      socket.destroy();
      return;
    }
    // Reject any room name outside the fixed allowlist (attacker-controlled
    // query param would otherwise spawn unbounded rooms).
    const room = url.searchParams.get("room") || "";
    if (!ALLOWED_ROOMS.has(room)) {
      socket.destroy();
      return;
    }
    // Per-room capacity BEFORE the handshake (live sockets only), so a full
    // room costs a TCP reset instead of a complete WS upgrade.
    if (hub.liveSizeOf(room) >= MAX_ROOM) {
      socket.destroy();
      return;
    }
    const id = url.searchParams.get("id") || randomUUID();
    wss.handleUpgrade(req, socket, head, (client) => {
      wss.emit("connection", client, room, id);
    });
  });

  wss.on("connection", (ws: Sock, room: string, id: string) => {
    // Disable Nagle on the upgraded TCP socket (both directions — it's per-socket):
    // small `s`/shot/hit frames must not be held waiting for a delayed ACK, which
    // can stall them up to ~40ms per leg. This is the highest-leverage latency fix.
    const tcp = (ws as unknown as { _socket?: { setNoDelay?: (b: boolean) => void } })._socket;
    if (tcp && typeof tcp.setNoDelay === "function") tcp.setNoDelay(true);

    ws.id = id;
    ws.room = room;
    ws.meta = { id };
    ws.isAlive = true;
    ws.lastPong = Date.now();
    ws.idle = false;

    if (hub.liveSizeOf(room) >= MAX_ROOM) {
      ws.close(1013, "room full");
      return;
    }

    hub.join(room, ws);
    buckets.set(ws, { tokens: BUCKET_CAPACITY, last: Date.now() });
    // First player on an idle server: spin the 20Hz bot/power-up loop back up.
    startBotLoop();

    const welcome: ServerMsg = { t: "welcome", id, room, seed: hub.seedOf(room) };
    ws.send(JSON.stringify(welcome));
    // Authoritative roster sync: covers the joiner AND notifies existing members.
    hub.broadcastPresence(room);
    console.log("[ws] join", id, room, "size", hub.sizeOf(room));

    ws.on("message", (raw) => {
      // Cheap per-frame token-bucket check BEFORE the (now Buffer-direct) parse:
      // under a firehose this rejects the frame without ever paying for JSON.parse.
      // The bucket capacity (80 frames/s) comfortably exceeds a legit client's
      // total rate (~20 "s"/s + sporadic events + rare control frames), so no
      // ACCEPTED frame is affected — only abusive excess is dropped pre-parse.
      const bucket = buckets.get(ws);
      if (bucket && !takeToken(bucket)) return; // silently drop excess, no parse

      // Parse the raw frame DIRECTLY (no intermediate `raw.toString()` alloc).
      const m: ClientMsg | null = parseClientMsg(raw);
      if (!m) return;
      switch (m.t) {
        case "join": {
          if (m.meta) ws.meta = m.meta;
          hub.broadcastPresence(ws.room);
          break;
        }
        case "track": {
          ws.meta = m.meta;
          hub.broadcastPresence(ws.room);
          break;
        }
        case "broadcast": {
          // Throttling already applied at the top of this handler (pre-parse).

          // For "s" (state) frames: record the snapshot and OVERWRITE health/alive
          // from the server's authoritative Player record before fan-out. This makes
          // health/alive server-authoritative with zero additional frames.
          if (m.event === "s" && m.payload && typeof m.payload === "object") {
            const snap = m.payload as NetSnapshot;
            hub.recordState(ws.room, ws.id, snap);
            const p = hub.getPlayer(ws.room, ws.id);
            if (p) {
              // Overwrite client-reported health/alive with server values.
              (m.payload as Record<string, unknown>)["health"] = p.health;
              (m.payload as Record<string, unknown>)["alive"] = p.alive;
            }
            // Idle gate: a socket silent on the pong channel past IDLE_POSE_MS is
            // (almost certainly) a dead/half-open link emitting a frozen pose.
            // Flag it idle and SKIP relaying its own stale "s" so observers don't
            // dead-reckon a frozen avatar. Authoritative HP was already recorded
            // above; we never disconnect the socket on this signal.
            if (Date.now() - ws.lastPong > IDLE_POSE_MS) {
              ws.idle = true;
              break; // do not fan out this stale pose
            }
          }

          // A player's concentrated mega ("kamehit") is resolved server-side so it
          // shares ONE shield-first model with the bot super (no client owns the
          // damage). The beam visual already rode the "kame" event; the verbatim
          // "kamehit" relay below still reaches the victim for its impact-blast FX.
          //   - target is a SERVER BOT → drop the bot + emit its death.
          //   - target is a PLAYER    → apply SUPER_DAMAGE shield-first; on a kill
          //     emit "died" (NOT "kill": the killer's client credits the kill via
          //     the normal alive→dead + recentHits path, same as a normal shot).
          if (m.event === "kamehit" && m.payload && typeof m.payload === "object") {
            const target = (m.payload as { target?: unknown }).target;
            if (typeof target === "string" && hub.botSim.hasBot(ws.room, target)) {
              const res = hub.botSim.killBot(ws.room, target);
              if (res?.died) {
                hub.fanout(ws.room, {
                  t: "broadcast",
                  event: "died",
                  payload: { id: target, x: res.x, z: res.z, by: ws.id },
                  from: ws.id,
                });
              }
            } else if (typeof target === "string" && hub.isPlayer(ws.room, target)) {
              const res = hub.damagePlayerN(ws.room, target, ws.id, SUPER_DAMAGE);
              if (res?.died) {
                hub.fanout(ws.room, {
                  t: "broadcast",
                  event: "died",
                  payload: { id: target, x: res.x, z: res.z, by: ws.id },
                  from: ws.id,
                });
              }
            }
          }

          // A player's saber hit ("meleehit") on a SERVER BOT applies the stagger
          // authoritatively (server-owned durations). The verbatim relay below still
          // reaches every client for the knockback/FX cue; this just adds the bot's
          // stun/fire-lock/super-interrupt (which a relayed cue alone can't, since a
          // server bot has no client to honor it). Bot HP still drops via {t:"hit"}.
          if (m.event === "meleehit" && m.payload && typeof m.payload === "object") {
            const target = (m.payload as { target?: unknown }).target;
            if (typeof target === "string" && hub.botSim.hasBot(ws.room, target)) {
              hub.botSim.staggerBot(ws.room, target);
            }
          }

          const out: ServerMsg = {
            t: "broadcast",
            event: m.event,
            payload: m.payload,
            from: ws.id,
          };
          if (typeof m.to === "string") {
            hub.unicast(ws.room, m.to, out);
          } else {
            hub.fanout(ws.room, out, ws.id); // never echo to sender
          }
          break;
        }
        case "hit": {
          // Throttling already applied at the top of this handler (pre-parse).

          // Damage authority is PARTIAL, not full: the server is authoritative only
          // over HP — it gates to a LIVE target and applies exactly 1 damage — but it
          // trusts the client-supplied target id and aim with NO geometric rewind/
          // validation. So a forged frame can chip away at any live target it names,
          // i.e. falsifiable INCREMENTAL damage, NOT an arbitrary instant-kill. This
          // is a known cheat surface (fix: server-side lag compensation w/ rewind).

          // A shot at a destructible crate bursts it (server-owned) — not a
          // player/bot damage event.
          if (hub.powerupSim.hasCrate(ws.room, m.target)) {
            hub.powerupSim.hitCrate(ws.room, m.target);
            break;
          }

          const result = hub.applyHit(ws.room, m.target, ws.id);
          if (result?.died) {
            // Broadcast the existing "died" event so all observers run death FX.
            const diedMsg: ServerMsg = {
              t: "broadcast",
              event: "died",
              payload: { id: m.target, x: result.x, z: result.z, by: ws.id },
              from: ws.id,
            };
            hub.fanout(ws.room, diedMsg); // broadcast to ALL including shooter
          }
          break;
        }
        case "leave": {
          hub.gracefulLeave(ws);
          hub.broadcastPresence(ws.room);
          ws.close();
          break;
        }
        case "ping": {
          // Echo the client's timestamp so it can compute round-trip latency.
          const pong: ServerMsg = { t: "pong", ts: m.ts };
          ws.send(JSON.stringify(pong));
          break;
        }
      }
    });

    ws.on("pong", () => {
      ws.isAlive = true;
      // A live pong means the connection is healthy: refresh liveness + clear any
      // idle flag so this socket's pose relays resume.
      ws.lastPong = Date.now();
      ws.idle = false;
    });

    ws.on("close", () => {
      // Do NOT delete the player — start the grace countdown so the avatar lingers.
      hub.leave(ws);
      // Broadcast updated presence (present=false for this player's entry).
      hub.broadcastPresence(ws.room);
      console.log("[ws] leave (grace)", ws.id, ws.room, "size", hub.sizeOf(ws.room));
      // Last socket gone => stop the bot loop so an empty server idles at ~0 CPU.
      stopBotLoopIfIdle();
    });

    ws.on("error", () => {
      // Swallow: the close handler performs cleanup.
    });
  });

  // Heartbeat: ping every connection, terminate silent ones.
  const hb = setInterval(() => {
    for (const client of wss.clients) {
      const sock = client as Sock;
      if (!sock.isAlive) {
        sock.terminate();
        continue;
      }
      sock.isAlive = false;
      sock.ping();
    }
  }, HEARTBEAT_MS);

  // Grace-sweep: remove players whose TTL has expired and broadcast presence.
  // Runs every second (much faster than the 30s heartbeat) so disconnected
  // avatars are cleared promptly after GRACE_MS.
  const sweep = setInterval(() => {
    for (const room of hub.allRooms()) {
      const removed = hub.sweepExpired(room);
      if (removed.length > 0) {
        console.log("[ws] sweep removed", removed, "from", room);
        hub.broadcastPresence(room);
      }
    }
  }, SWEEP_MS);

  // Bot simulation: drive the server bots (movement + shooting) at 20 Hz and
  // stream them to every client as pseudo-players. The power-up sim rides the
  // SAME loop (spawn cadence + pickup detection are cheap; it self-paces off dt).
  //
  // The loop is GATED on player presence: an empty server has no bots to simulate
  // (bots only spawn while a real player is connected), so running this 20Hz timer
  // would just churn the event loop for nothing. We create it on the first join and
  // clear it once the last socket leaves all rooms, then restart it on the next join.
  let botLoop: ReturnType<typeof setInterval> | null = null;
  function startBotLoop(): void {
    if (botLoop) return;
    botLoop = setInterval(() => {
      const now = Date.now();
      for (const room of hub.allRooms()) {
        hub.botSim.tick(room, BOT_TICK_SECONDS);
        hub.powerupSim.tick(room, BOT_TICK_SECONDS);
        // Resolve scheduled hits whose visible tracer has now arrived, so damage
        // lands WITH the bullet the victim sees (netcode-hit-sync-plan.md, Phase 1).
        hub.drainPendingHits(room, now);
      }
    }, BOT_TICK_MS);
  }
  function stopBotLoopIfIdle(): void {
    if (!botLoop) return;
    // Count live OPEN sockets across all rooms (a socket mid-close is no longer
    // OPEN, so the just-closed socket doesn't keep the loop alive).
    let live = 0;
    for (const room of hub.allRooms()) live += hub.liveSizeOf(room);
    if (live === 0) {
      clearInterval(botLoop);
      botLoop = null;
    }
  }

  wss.on("close", () => {
    clearInterval(hb);
    clearInterval(sweep);
    if (botLoop) clearInterval(botLoop);
  });

  return hub;
}
