/**
 * Tiny REST client for the persisted leaderboard, served by the same-origin
 * Elysia backend (`GET /api/leaderboard`). Works in dev via the Vite proxy and
 * in prod where the server serves the SPA itself, so URLs are always same-origin
 * and need no configuration.
 *
 * Score submission is now server-authoritative: the server writes a run on every
 * player death (via `finalizeRun` in rooms.ts). The client never POSTs a score.
 */

/** A persisted leaderboard row returned by the server (best survival runs). */
export interface LeaderRow {
  username: string;
  aliveSeconds: number;
  kills: number;
  endedAt: string; // ISO timestamp
}

/** Fetch the top persisted runs (longest survival first). Returns [] on failure. */
export async function fetchTop(limit = 20): Promise<LeaderRow[]> {
  try {
    const res = await fetch(
      `/api/leaderboard?limit=${encodeURIComponent(String(limit))}`,
    );
    if (!res.ok) return [];
    const data: unknown = await res.json();
    return Array.isArray(data) ? (data as LeaderRow[]) : [];
  } catch {
    return [];
  }
}
