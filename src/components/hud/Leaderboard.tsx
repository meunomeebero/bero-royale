import { memo } from "react";
import { Trophy } from "lucide-react";
import type { LeaderboardEntry, GameMode } from "@/game/Game";
import type { LeaderRow } from "@/game/net/LeaderboardClient";
import { cn } from "@/lib/utils";
import { GamePanel, HexBadge, HUD, INK, IconWell } from "./primitives";

const fmt = (seconds: number) => {
  const t = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

/** Top-3 left-edge accent bars: honey / terracotta / success for rank 1/2/3. */
const EDGE = [HUD.honey, HUD.terracotta, HUD.success];

/**
 * Side leaderboard (game-HUD language: one honey cocoa-glass panel, no parchment).
 * - Online (multiplayer): ranks players by kills (highest first); value column
 *   is a rose kills HexBadge.
 * - Offline (local): live-player panel is hidden; only the all-time bestRuns
 *   records panel is shown, ranked by survival time (tabular numeral).
 */
const LeaderboardImpl = ({
  bestRuns,
  mode = "local",
  isMobile = false,
}: {
  /** Live current-room entries — no longer rendered (kept for API compat). */
  entries?: LeaderboardEntry[];
  bestRuns?: LeaderRow[];
  mode?: GameMode;
  isMobile?: boolean;
}) => {
  const isOnline = mode === "multiplayer";
  const records = (bestRuns ?? []).slice(0, 20);

  // Single panel: the records list (online: top players by kills; local: best
  // survival times). The live current-room "Kills" panel was removed per design.
  const showRecordsPanel = records.length > 0;
  if (!showRecordsPanel) return null;

  // On mobile landscape: narrower, smaller font, safe-area aware
  const containerClass = isMobile
    ? "pointer-events-none absolute z-30 w-36"
    : "pointer-events-none absolute right-5 top-24 z-30 w-56";
  const containerStyle = isMobile
    ? {
        right: "max(env(safe-area-inset-right, 0px) + 4px, 4px)",
        top: "max(env(safe-area-inset-top, 0px) + 4px, 4px)",
      }
    : undefined;
  const rowClass = isMobile
    ? "relative flex items-center gap-1.5 py-1 pr-2 pl-2.5 text-[10px]"
    : "relative flex items-center gap-2 py-1.5 pr-4 pl-4 text-[12px]";
  const headerClass = isMobile
    ? "flex items-center gap-1.5 border-b-2 px-2 py-1.5"
    : "flex items-center gap-2 border-b-2 px-3 py-2";

  return (
    <div className={containerClass} style={containerStyle}>
      <GamePanel accent={HUD.honey} className="overflow-hidden">
        <div
          className={headerClass}
          style={{ borderColor: `${INK}` }}
        >
          <IconWell icon={Trophy} accent={HUD.honey} size={isMobile ? 20 : 24} />
          <span className="hud-label">
            {isOnline ? "Recordes" : "Melhores tempos"}
          </span>
        </div>
        <div
          className={cn(
            "relative flex flex-col overflow-y-auto pointer-events-auto",
            // Fade the bottom edge so an overflowing last row reads as "scroll for
            // more" instead of being sliced mid-glyph.
            "[mask-image:linear-gradient(to_bottom,#000_84%,transparent)] [-webkit-mask-image:linear-gradient(to_bottom,#000_84%,transparent)]",
            isMobile ? "max-h-[112px]" : "max-h-[164px]",
          )}
        >
          {records.map((r, i) => (
            <div
              key={`${r.username}-${i}`}
              className={cn(
                rowClass,
                i < records.length - 1 && "border-b",
              )}
              style={{
                borderColor: "rgba(255,255,255,0.10)",
                // Top-3 get a chunky left-edge identity bar.
                boxShadow: i < 3 ? `inset 3px 0 0 ${EDGE[i]}` : undefined,
              }}
            >
              <span
                className={cn(
                  "hud-num hud-num-sm shrink-0 tabular-nums text-center",
                  isMobile ? "w-3.5" : "w-4",
                )}
                style={{ fontSize: isMobile ? 11 : 13 }}
              >
                {i + 1}
              </span>
              <span className="hud-text flex-1 truncate font-semibold">
                {r.username}
              </span>
              {isOnline ? (
                <HexBadge accent={HUD.rose} size={22} value={r.kills} />
              ) : (
                <span
                  className="hud-num hud-num-sm tabular-nums"
                  style={{ fontSize: isMobile ? 11 : 13 }}
                >
                  {fmt(r.aliveSeconds)}
                </span>
              )}
            </div>
          ))}
        </div>
      </GamePanel>
    </div>
  );
};

/**
 * Memoized: `bestRuns` is a stable array reference (only swapped every ~20s by
 * the periodic refresh), so this bails out of every stats tick in between.
 */
export const Leaderboard = memo(LeaderboardImpl);
