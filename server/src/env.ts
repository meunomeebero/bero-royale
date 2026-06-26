import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Centralized, validated runtime environment.
 *
 * In non-production (e.g. `tsx watch` dev) we load the repo-root `.env` so
 * `DATABASE_URL` and friends are picked up automatically. In production the
 * environment is provided by the Shard Cloud run command, and the `.env` file
 * is typically absent — `dotenv.config` simply no-ops on a missing file, but
 * we only call it in the non-production branch to keep prod boot side-effect free.
 */
if (process.env.NODE_ENV !== "production") {
  dotenv.config({
    path: resolve(dirname(fileURLToPath(import.meta.url)), "../../.env"),
  });
}

/**
 * HTTP listen port. Honors the platform-injected `PORT` (Shard Cloud routes its
 * edge to it); falls back to 3000 — an UNPRIVILEGED port — matching the live,
 * working Shard Cloud node apps. We deliberately do NOT default to 80: a
 * non-root container can't bind 80 (EACCES), which the adapter swallows while
 * still firing the listen callback, leaving the edge with nothing to reach (502).
 */
export const PORT = Number(process.env.PORT) || 3000;

/**
 * Postgres connection string (optional). When unset the leaderboard layer is
 * disabled (see `db.ts`) rather than crashing boot — the WS/static server still
 * comes up so the game is playable without a database.
 */
export const DATABASE_URL: string | undefined = process.env.DATABASE_URL;

/**
 * When `true`, the managed Postgres cert is not in Node's trust store, so we
 * connect with `rejectUnauthorized: false` (see `db.ts`).
 */
export const PGSSL = process.env.PGSSL === "true";

/** Resolved runtime mode. */
export const NODE_ENV = process.env.NODE_ENV ?? "development";

/**
 * Shared secret for TURN REST credentials (the coturn `use-auth-secret`
 * scheme). Used by `turn.ts` to HMAC-sign time-limited usernames so the secret
 * never ships to the client. Optional — when unset, GET /api/turn returns only
 * the public STUN server (voice degrades to its pre-TURN, STUN-only behavior).
 */
export const TURN_SECRET: string | undefined = process.env.TURN_SECRET;

/**
 * Hostname (or IP) of the TURN server, used to build the `turn:`/`turns:` URLs
 * in `turn.ts`. Optional and paired with {@link TURN_SECRET}; if either is
 * missing the ICE list is STUN-only.
 */
export const TURN_HOST: string | undefined = process.env.TURN_HOST;

/**
 * Shared secret that gates the map editor (`/api/editor/auth` + `PUT /api/map`).
 * Checked SERVER-SIDE on every write — the client gate is cosmetic. Falls back to
 * a baked default for local dev; in prod set it via the Shard Cloud run command.
 */
export const MAP_EDITOR_PASSWORD = process.env.MAP_EDITOR_PASSWORD ?? "29981721";
