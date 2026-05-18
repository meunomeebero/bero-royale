import { Timer, Trophy, Users, Activity } from "lucide-react";
import type { GameStats } from "@/game/Game";
import { HudPanel } from "./HudPanel";

interface StatsBarProps {
  stats: GameStats;
  health: number;
  maxHealth: number;
}

const formatTime = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
};

export const StatsBar = ({ stats, health, maxHealth }: StatsBarProps) => {
  const isNewRecord =
    stats.elapsed > 0 && stats.elapsed >= stats.topScore && stats.topScore > 0;
  const healthPct = Math.max(0, Math.min(100, (health / maxHealth) * 100));
  const healthTone =
    healthPct > 60
      ? "bg-game-accent"
      : healthPct > 30
        ? "bg-game-accent-2"
        : "bg-game-danger";

  return (
    <div className="flex items-stretch gap-3">
      {/* Timer */}
      <HudPanel label="Run Time" tone="accent" sweep className="min-w-[150px]">
        <div className="px-4 pt-5 pb-3 flex items-center gap-2">
          <Timer
            className="w-4 h-4 text-game-accent animate-pulse-glow"
            strokeWidth={2.5}
          />
          <div className="font-mono text-2xl tracking-widest text-game-accent tabular-nums leading-none">
            {formatTime(stats.elapsed)}
          </div>
        </div>
      </HudPanel>

      {/* Top score */}
      <HudPanel label="Top Score" tone="cyan" className="min-w-[140px]">
        <div className="px-4 pt-5 pb-3 flex items-center gap-2">
          <Trophy
            className="w-4 h-4 text-game-accent-2"
            strokeWidth={2.5}
          />
          <div className="font-mono text-2xl tracking-widest text-game-accent-2 tabular-nums leading-none">
            {formatTime(stats.topScore)}
          </div>
        </div>
        {isNewRecord && (
          <div className="absolute -top-2 right-2 font-mono text-[8px] tracking-[0.3em] uppercase text-game-success animate-blink-soft">
            New
          </div>
        )}
      </HudPanel>

      {/* Hostiles */}
      <HudPanel label="Hostiles" tone="danger" className="min-w-[110px]">
        <div className="px-4 pt-5 pb-3 flex items-center gap-2">
          <Users className="w-4 h-4 text-game-danger" strokeWidth={2.5} />
          <div className="font-mono text-2xl tracking-widest text-game-danger tabular-nums leading-none">
            {stats.botCount.toString().padStart(2, "0")}
          </div>
        </div>
      </HudPanel>

      {/* Health */}
      <HudPanel label="Integrity" tone="muted" className="min-w-[170px]">
        <div className="px-4 pt-5 pb-3 flex items-center gap-2">
          <Activity
            className="w-4 h-4 text-game-muted"
            strokeWidth={2.5}
          />
          <div className="flex-1">
            <div className="relative h-2 bg-game-bg/80 overflow-hidden clip-hud-sm border border-game-muted/30">
              <div
                className={`absolute inset-y-0 left-0 ${healthTone} transition-all duration-200`}
                style={{ width: `${healthPct}%` }}
              />
              <div className="absolute inset-0 scanlines opacity-60" />
            </div>
            <div className="mt-1 font-mono text-[10px] tracking-widest text-game-muted tabular-nums">
              {Math.ceil(health)}/{maxHealth}
            </div>
          </div>
        </div>
      </HudPanel>
    </div>
  );
};
