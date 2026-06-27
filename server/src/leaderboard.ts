import { getTop } from "./db";

/**
 * Framework-light leaderboard handlers consumed by the bootstrap
 * (`server/src/index.ts`). These deal in plain JSON-friendly shapes
 * (camelCase, ISO date strings) so the bootstrap can serialize them directly.
 */

/** A leaderboard entry as sent over the wire (camelCase, ISO `endedAt`). */
export interface LeaderRowOut {
  username: string;
  aliveSeconds: number;
  kills: number;
  endedAt: string;
}

/** Clamp `n` into the inclusive range [lo, hi]. */
export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Strip control chars (U+0000–U+001F, U+007F), trim, cap 24 chars; fall back to "Anon". */
export function sanitizeUsername(raw: unknown): string {
  // eslint-disable-next-line no-control-regex
  return String(raw ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 24) || "Anon";
}

/**
 * GET /api/leaderboard — top runs. `query.limit` is parsed and clamped to
 * 1..100 (defaulting to 20 on missing/invalid input).
 */
export async function getLeaderboardHandler(
  query: Record<string, string | undefined>,
): Promise<LeaderRowOut[]> {
  const limit = clamp(parseInt(query.limit ?? "20", 10) || 20, 1, 100);
  const rows = await getTop(limit);
  return rows.map((row) => ({
    username: row.username,
    aliveSeconds: row.alive_seconds,
    kills: row.kills,
    endedAt: (row.ended_at as Date).toISOString(),
  }));
}
