import { getTop, insertRun } from "./db";

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
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
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

/** Result of a score submission: the persisted row, or a validation/db error. */
export type PostScoreResult =
  | { ok: true; row: LeaderRowOut }
  | { ok: false; error: string; kind: "validation" | "db" };

/**
 * POST /api/leaderboard — submit a finished run. The body is fully validated
 * and sanitized here (never trust the client): control chars stripped from the
 * username, numeric fields floored + clamped, and a sane fallback `endedAt`.
 */
export async function postScoreHandler(body: unknown): Promise<PostScoreResult> {
  const raw = body as {
    username?: unknown;
    aliveSeconds?: unknown;
    kills?: unknown;
    endedAt?: unknown;
  } | null;

  const username =
    String(raw?.username ?? "")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
      .slice(0, 24) || "Anon";

  const aliveSecondsNum = Number(raw?.aliveSeconds);
  if (Number.isNaN(aliveSecondsNum)) {
    return { ok: false, error: "invalid aliveSeconds", kind: "validation" };
  }
  const aliveSeconds = clamp(Math.floor(aliveSecondsNum), 0, 86400);
  const killsNum = Number(raw?.kills);
  const kills = Number.isFinite(killsNum)
    ? clamp(Math.floor(killsNum), 0, 10000)
    : 0;

  let endedAt = raw?.endedAt ? new Date(Number(raw.endedAt)) : new Date();
  if (Number.isNaN(endedAt.getTime())) {
    endedAt = new Date();
  }

  try {
    await insertRun({ username, aliveSeconds, kills, endedAt });
    return {
      ok: true,
      row: {
        username,
        aliveSeconds,
        kills,
        endedAt: endedAt.toISOString(),
      },
    };
  } catch {
    return { ok: false, error: "db error", kind: "db" };
  }
}
