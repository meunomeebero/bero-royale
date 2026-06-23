import postgres from "postgres";
import { DATABASE_URL, PGSSL } from "./env";

/**
 * Shared postgres.js client.
 *
 * Shard Cloud's managed Postgres presents a cert that is not in Node's trust
 * store, so when `PGSSL=true` we connect with `rejectUnauthorized: false`
 * (encrypted, but no cert chain verification). Otherwise we fall back to
 * `"require"`, which negotiates TLS using Node's default trust store.
 */
export const sql: postgres.Sql | null = DATABASE_URL
  ? postgres(DATABASE_URL, {
      ssl: PGSSL ? { rejectUnauthorized: false } : "require",
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
    })
  : null;

/** A leaderboard row as returned by the DB (snake_case, Date/number typed). */
export interface LeaderboardRow {
  username: string;
  alive_seconds: number;
  kills: number;
  ended_at: Date;
}

/**
 * Create the leaderboard table + indexes and collapse the board to one (best)
 * row per username. Idempotent and safe to run on every boot; no-ops cleanly
 * when no database is configured. Each statement runs separately and in order
 * so later statements reference the table/state established by earlier ones.
 */
export async function migrate(): Promise<void> {
  if (!sql) {
    console.log("[db] no DATABASE_URL — leaderboard disabled");
    return;
  }

  await sql`
    CREATE TABLE IF NOT EXISTS leaderboard (
      id BIGSERIAL PRIMARY KEY,
      username TEXT NOT NULL,
      alive_seconds INTEGER NOT NULL CHECK (alive_seconds >= 0),
      kills INTEGER NOT NULL DEFAULT 0 CHECK (kills >= 0),
      ended_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  // Collapse any pre-existing duplicates to each username's best run before the
  // unique index is created (keep the most kills; tie-break on longer survival,
  // then lower id).
  await sql`
    DELETE FROM leaderboard a
    USING leaderboard b
    WHERE a.username = b.username
      AND (
        a.kills < b.kills
        OR (a.kills = b.kills AND a.alive_seconds < b.alive_seconds)
        OR (a.kills = b.kills AND a.alive_seconds = b.alive_seconds AND a.id < b.id)
      )
  `;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS leaderboard_username_uidx
      ON leaderboard (username)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS leaderboard_alive_seconds_idx
      ON leaderboard (alive_seconds DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS leaderboard_kills_idx
      ON leaderboard (kills DESC)
  `;

  // Composite index matching getTop()'s exact ORDER BY so the leaderboard query
  // is a backward index scan instead of a full sort. HTTP-only impact; the WS hot
  // path never touches Postgres.
  await sql`
    CREATE INDEX IF NOT EXISTS leaderboard_rank_idx
      ON leaderboard (kills DESC, alive_seconds DESC, ended_at DESC)
  `;
}

/**
 * Top runs ordered by kills (most kills first), then by survival time, then
 * most recent. `limit` is clamped to 1..100 to bound the result set regardless
 * of caller input. Throws if no database is configured (callers catch and
 * degrade gracefully).
 */
export async function getTop(limit = 20): Promise<LeaderboardRow[]> {
  if (!sql) throw new Error("leaderboard disabled: no DATABASE_URL");
  const lim = Math.min(100, Math.max(1, Math.floor(limit)));
  const rows = await sql<LeaderboardRow[]>`
    SELECT username, alive_seconds, kills, ended_at
    FROM leaderboard
    ORDER BY kills DESC, alive_seconds DESC, ended_at DESC
    LIMIT ${lim}
  `;
  return rows;
}

/**
 * Upsert a finished run, keeping only each username's best result ranked by
 * kills (most kills wins). On a kills tie, keep the longer survival time.
 * The `alive_seconds` column is retained for historical display; it is NOT the
 * primary ranking criterion anymore. Throws if no database is configured
 * (callers catch and degrade).
 */
export async function insertRun(r: {
  username: string;
  aliveSeconds: number;
  kills: number;
  endedAt: Date;
}): Promise<void> {
  if (!sql) throw new Error("leaderboard disabled: no DATABASE_URL");
  await sql`
    INSERT INTO leaderboard (username, alive_seconds, kills, ended_at)
    VALUES (${r.username}, ${r.aliveSeconds}, ${r.kills}, ${r.endedAt})
    ON CONFLICT (username) DO UPDATE SET
      alive_seconds = EXCLUDED.alive_seconds,
      kills = EXCLUDED.kills,
      ended_at = EXCLUDED.ended_at
    WHERE
      EXCLUDED.kills > leaderboard.kills
      OR (EXCLUDED.kills = leaderboard.kills AND EXCLUDED.alive_seconds > leaderboard.alive_seconds)
  `;
}
