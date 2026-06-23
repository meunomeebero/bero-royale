import { memo } from "react";
import { Heart, Skull, Timer, Trophy, Users } from "lucide-react";
import type { GameMode } from "@/game/Game";
import { cn } from "@/lib/utils";
import {
  GamePanel,
  HexBadge,
  HEX,
  HUD,
  INK,
  IconWell,
  RibbonStrip,
  SegBar,
} from "./primitives";

/**
 * Top-center match stats — redesigned to the "game HUD" language (GLM 5.2):
 * hexagon emblems for combat counts, a honey ribbon timer, a dark cocoa-glass
 * HP strip with a segmented bar + sage shield hex-pips. No parchment cards.
 *
 * Narrowed props (not the whole GameStats) so React.memo bails on ticks where
 * none of these scalars changed. HP/shield change on discrete events, never
 * per-frame, so plain React state here is perf-safe.
 */
interface StatsBarProps {
  elapsed: number;
  topScore: number;
  botCount: number;
  kills: number;
  shield: number;
  mode: GameMode;
  health: number;
  maxHealth: number;
  isMobile?: boolean;
}

const formatTime = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
};

/** Accumulated shield charges as sage hexagons (distinct SHAPE from HP rectangles
 *  → colorblind-safe). */
const ShieldHexes = ({ n, isMobile }: { n: number; isMobile: boolean }) => {
  const count = Math.min(Math.max(0, n), 10);
  if (count <= 0) return null;
  const d = isMobile ? 9 : 8;
  return (
    <div className="flex items-center" style={{ gap: 3 }}>
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          style={{
            width: d,
            height: d,
            clipPath: HEX,
            background: HUD.success,
            outline: `2px solid ${INK}`,
          }}
        />
      ))}
    </div>
  );
};

const StatsBarImpl = ({
  elapsed,
  topScore,
  botCount,
  kills,
  shield,
  mode,
  health,
  maxHealth,
  isMobile = false,
}: StatsBarProps) => {
  const isNewRecord = elapsed > 0 && elapsed >= topScore && topScore > 0;

  // HP as a capped, proportional segmented bar (buffed max stays proportional).
  const pips = Math.min(maxHealth, isMobile ? 10 : 12);
  const ratio = maxHealth > 0 ? Math.max(0, health) / maxHealth : 0;
  const filled = Math.ceil(ratio * pips);
  const low = ratio <= 0.3;

  const hexSize = isMobile ? 34 : 46;
  const capSize = isMobile ? 26 : 32;
  const timerFont = isMobile ? 15 : 22;

  return (
    <div className={cn("flex items-center", isMobile ? "gap-1.5" : "gap-2.5")}>
      {/* Kills (combat emblem) */}
      <HexBadge accent={HUD.rose} size={hexSize} icon={Skull} value={kills} />

      {/* Enemies remaining (combat emblem) */}
      <HexBadge
        accent={HUD.terracotta}
        size={hexSize}
        icon={Users}
        value={botCount}
      />

      {/* Timer ribbon (temporal headline) */}
      <RibbonStrip accent={HUD.honey} icon={Timer} isMobile={isMobile}>
        <span className="hud-num leading-none" style={{ fontSize: timerFont }}>
          {formatTime(elapsed)}
        </span>
      </RibbonStrip>

      {/* HP + shield strip */}
      <GamePanel
        accent={HUD.rose}
        className="flex items-center"
        style={{
          gap: isMobile ? 6 : 8,
          padding: isMobile ? "5px 8px" : "7px 10px",
        }}
      >
        <HexBadge accent={HUD.rose} size={capSize} icon={Heart} />
        <div className="flex flex-col" style={{ gap: 4 }}>
          <SegBar
            segments={pips}
            filled={filled}
            accent={HUD.rose}
            low={low}
            isMobile={isMobile}
          />
          <ShieldHexes n={shield} isMobile={isMobile} />
        </div>
      </GamePanel>

      {/* Survival record — local only (online ranks by kills in the leaderboard) */}
      {mode !== "multiplayer" && (
        <div className="relative">
          <GamePanel
            accent={HUD.honey}
            className="flex items-center"
            style={{
              gap: isMobile ? 5 : 7,
              padding: isMobile ? "5px 8px" : "7px 10px",
            }}
          >
            <IconWell icon={Trophy} accent={HUD.honey} size={isMobile ? 22 : 26} />
            <span
              className="hud-num leading-none"
              style={{ fontSize: isMobile ? 14 : 19 }}
            >
              {formatTime(topScore)}
            </span>
          </GamePanel>
          {isNewRecord && (
            <span
              className="hud-label absolute -top-2 right-1 rounded-[4px] px-1.5 py-0.5 text-[8px]"
              style={{ background: HUD.success, border: `2px solid ${INK}`, color: "#fff" }}
            >
              Recorde
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export const StatsBar = memo(StatsBarImpl);
