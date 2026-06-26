import { Elysia } from "elysia";
import { node } from "@elysiajs/node";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { join } from "node:path";

import { PORT } from "./env";
import { migrate } from "./db";
import { getLeaderboardHandler } from "./leaderboard";
import { getTurnCredentials } from "./turn";
import { attachWebSocket } from "./ws/index";
import { spaStatic } from "./static";

/**
 * Server bootstrap: HTTP API + SPA static + WebSocket relay on ONE Node port.
 *
 * We own the `http.Server` directly (rather than delegating to the Elysia node
 * adapter's `.listen()`): Shard Cloud's container injects PORT and the adapter's
 * listen did not reliably bind it (the raw server's `.address()` stayed null →
 * edge 502). A manual `createServer(...).listen(PORT, "0.0.0.0")` — the same
 * pattern the platform's other working node apps use — binds deterministically,
 * and the WebSocket server attaches to that exact server so they share the port.
 *
 * Requests are bridged to Elysia via its web-standard `handle(Request)`.
 *
 * A failed DB migration is logged but NEVER aborts boot: multiplayer + voice
 * (WS) and the static game must keep running even when Postgres is unreachable.
 * Migration runs fire-and-forget AFTER `server.listen()` so DB latency never
 * delays binding the port (which caused cold-start 502s).
 */

// A stray error in a request body stream or anywhere else must never take down
// the shared WebSocket server (it would kill every live multiplayer/voice
// session). Log and keep running.
process.on("uncaughtException", (e) =>
  console.error("[bero] uncaughtException:", e),
);
process.on("unhandledRejection", (e) =>
  console.error("[bero] unhandledRejection:", e),
);

// `/health` + `/api/*` register BEFORE the SPA static catch-all so it never
// shadows them. The SPA lives in ./public relative to CWD at runtime (the
// deploy root, where ./public exists).
// Live online count, wired to the WebSocket hub after it's attached below.
// Also doubles as a cheap RTT probe for the client's ping read-out.
let onlineCount = (): number => 0;

// GLOBAL token bucket for /api/turn (deliberately NOT per-IP). The only client-IP
// signal is `X-Forwarded-For`, which is attacker-controllable (the app can be hit
// directly and a spoofed XFF mints a fresh per-IP bucket every request), so a
// per-IP limiter is trivially bypassed. A single global bucket bounds total TURN-
// credential minting regardless of source and cannot be rotated around. Legit
// clients fetch /api/turn rarely (once per session + a ~24h TTL refresh), so this
// generous cap never affects real users. The real relay-abuse defense is coturn-
// side quotas (per-allocation bandwidth/time limits) — infra, see shardcloud.md.
const TURN_RL_CAP = 60,
  TURN_RL_REFILL_PER_SEC = 30; // 60 burst, 30/s sustained — global
const turnBucket = { tokens: TURN_RL_CAP, last: Date.now() };
function turnRateLimitOk(): boolean {
  const now = Date.now();
  turnBucket.tokens = Math.min(
    TURN_RL_CAP,
    turnBucket.tokens + ((now - turnBucket.last) / 1000) * TURN_RL_REFILL_PER_SEC,
  );
  turnBucket.last = now;
  if (turnBucket.tokens < 1) return false;
  turnBucket.tokens -= 1;
  return true;
}

const app = new Elysia({ adapter: node() })
  .get("/health", () => "ok")
  .get("/api/online", () => ({ count: onlineCount() }))
  .get("/api/leaderboard", ({ query }) =>
    getLeaderboardHandler(query as Record<string, string | undefined>),
  )
  .get("/api/turn", ({ set }) => {
    if (!turnRateLimitOk()) {
      set.status = 429;
      return { error: "rate limited" };
    }
    return getTurnCredentials();
  })
  .use(spaStatic(join(process.cwd(), "public")));

/** Bridge a Node request into a web-standard Request for Elysia.handle(). */
function toWebRequest(req: IncomingMessage): Request {
  const host = req.headers.host ?? "localhost";
  const url = `http://${host}${req.url ?? "/"}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  }
  const method = req.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  const init: RequestInit & { duplex?: "half" } = { method, headers };
  if (hasBody) {
    // `duplex: "half"` is required by Node's fetch when streaming a body.
    (init as Record<string, unknown>).body = Readable.toWeb(req);
    init.duplex = "half";
  }
  return new Request(url, init as RequestInit);
}

/**
 * Pipe a web-standard Response back out through the Node response. Awaits full
 * completion and tears the source stream down on error/disconnect, so a
 * mid-stream body error surfaces to the caller instead of crashing the process.
 */
async function writeResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  if (!response.body) {
    res.end();
    return;
  }
  const src = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
  res.on("close", () => src.destroy());
  await pipeline(src, res);
}

const server = createServer((req, res) => {
  app
    .handle(toWebRequest(req))
    .then((response) => writeResponse(res, response))
    .catch((e: NodeJS.ErrnoException) => {
      // Client disconnects mid-stream are expected, not failures — swallow them.
      if (e?.code === "EPIPE" || e?.code === "ECONNRESET") return;
      console.error("[bero] request error:", e);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end("Internal Server Error");
      }
    });
});

server.on("error", (e) => console.error("[bero] http server error:", e));

// WebSocket relay shares this exact server (one port). Keep the hub so the
// /api/online route can report the live FFA player count.
const hub = attachWebSocket(server);
onlineCount = () => hub.liveSizeOf("voxelcube-ffa");

// NOTE: listen WITHOUT a hostname (binds dual-stack `::`, accepting both IPv6
// and IPv4). Passing "0.0.0.0" binds IPv4-only, which the Shard Cloud edge
// (it proxies to the container over IPv6) cannot reach → 502. This matches the
// platform's other working node apps, which use `server.listen(PORT)`.
server.listen(PORT, () => {
  const addr = server.address();
  console.log(
    "[bero] listening (http + ws + static) | env.PORT=" +
      JSON.stringify(process.env.PORT) +
      " | bound=" +
      (typeof addr === "object" && addr ? addr.address + ":" + addr.port : String(addr)),
  );

  // Fire-and-forget AFTER listen: DB latency must never delay binding the port.
  migrate().catch((e) =>
    console.error(
      "[db] migrate failed (continuing so multiplayer/voice still work):",
      e,
    ),
  );
});
