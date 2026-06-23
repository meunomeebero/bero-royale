import { memo } from "react";
import { Users } from "lucide-react";
import type { RosterEntry } from "@/game/Game";
import { cn } from "@/lib/utils";
import { GamePanel, HexBadge, HUD, INK, IconWell } from "./primitives";

/**
 * Online players list shown above the chat. Lists everyone in the room — live
 * players AND the backfill bots (random names) — so the lobby always feels
 * populated. Scrollable: ~5 rows are visible, scroll to see the rest.
 *
 * Game-HUD language: one cocoa-glass GamePanel (sage/success identity), a
 * header with a Users IconWell + a count HexBadge, and presence rows with a
 * sage online dot. The local player ("me") is highlighted in rose.
 */
const PlayersListImpl = ({
  players,
  isMobile = false,
  isBero = false,
}: {
  players: RosterEntry[];
  isMobile?: boolean;
  /** Admin view for the "bero" account: reveals which online users are bots. */
  isBero?: boolean;
}) => {
  if (!players.length) return null;

  const botCount = players.filter((p) => p.isBot).length;
  const realCount = players.length - botCount;

  return (
    <GamePanel
      accent={HUD.success}
      className={cn("pointer-events-auto overflow-hidden", isMobile ? "w-40" : "w-56")}
    >
      {/* Header: online icon + count emblem + label */}
      <div
        className={cn(
          "flex items-center",
          isMobile ? "gap-1.5 px-2 py-1.5" : "gap-2 px-3 py-2",
        )}
        style={{ borderBottom: `2px solid ${INK}` }}
      >
        <IconWell icon={Users} accent={HUD.success} size={isMobile ? 20 : 24} />
        <HexBadge
          accent={HUD.success}
          size={isMobile ? 20 : 24}
          value={players.length}
        />
        {isBero ? (
          <span className="hud-label" style={{ fontSize: isMobile ? 9 : 10 }}>
            {realCount} {realCount === 1 ? "real" : "reais"} · {botCount} bot
            {botCount === 1 ? "" : "s"}
          </span>
        ) : (
          <span className="hud-label">Online</span>
        )}
      </div>

      {/* ~5 rows tall, then scroll. Bottom fade = "scroll for more" (no mid-row cut). */}
      <div
        className={cn(
          "overflow-y-auto [mask-image:linear-gradient(to_bottom,#000_84%,transparent)] [-webkit-mask-image:linear-gradient(to_bottom,#000_84%,transparent)]",
          isMobile ? "max-h-[96px]" : "max-h-[136px]",
        )}
      >
        {players.map((p) => (
          <div
            key={p.id}
            className={cn(
              "flex items-center",
              isMobile ? "gap-1.5 px-2 py-1" : "gap-2 px-3 py-1",
            )}
            style={p.me ? { background: `${HUD.rose}26` } : undefined}
          >
            <span
              className="shrink-0"
              style={{
                width: isMobile ? 7 : 8,
                height: isMobile ? 7 : 8,
                borderRadius: "50%",
                background: p.me
                  ? HUD.rose
                  : isBero && p.isBot
                    ? HUD.honey
                    : HUD.success,
                border: `2px solid ${INK}`,
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.4)",
              }}
            />
            <span
              className={cn(
                "hud-text flex-1 truncate font-semibold",
                isMobile ? "text-[10px]" : "text-[12px]",
              )}
              style={p.me ? { color: HUD.rose } : undefined}
            >
              {p.name}
              {p.me && !isMobile ? " (você)" : ""}
            </span>
            {isBero && p.isBot && (
              <span
                className="hud-label shrink-0"
                style={{
                  fontSize: 8,
                  background: HUD.honey,
                  color: "#fff",
                  border: `2px solid ${INK}`,
                  borderRadius: 4,
                  padding: "0 4px",
                  letterSpacing: "0.06em",
                }}
              >
                BOT
              </span>
            )}
          </div>
        ))}
      </div>
    </GamePanel>
  );
};

/**
 * Memoized: bails out of a stats tick whenever the `players` array reference is
 * unchanged. (Full benefit lands once the engine caches a stable roster ref and
 * only swaps it when presence actually changes — see Game.buildRoster.)
 */
export const PlayersList = memo(PlayersListImpl);
