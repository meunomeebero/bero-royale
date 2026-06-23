/**
 * Tiny REST client for the persisted leaderboard, served by the same-origin
 * Elysia backend (`GET /api/leaderboard`, `POST /api/score`). Works in dev via
 * the Vite proxy and in prod where the server serves the SPA itself, so URLs
 * are always same-origin and need no configuration.
 */

/** A finished survival run, submitted on death. */
export interface ScoreRun {
  username: string;
  aliveSeconds: number;
  kills: number;
  endedAt?: number; // epoch ms; server defaults to now() if omitted
}

/** A persisted leaderboard row returned by the server (best survival runs). */
export interface LeaderRow {
  username: string;
  aliveSeconds: number;
  kills: number;
  endedAt: string; // ISO timestamp
}

/**
 * Fire-and-forget: persist a finished run. `keepalive` lets the request survive
 * a tab close on death. Best-effort — all failures are swallowed.
 */
export function submitScore(run: ScoreRun): void {
  try {
    void fetch("/api/score", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(run),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* best-effort; leaderboard persistence never blocks gameplay */
  }
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
