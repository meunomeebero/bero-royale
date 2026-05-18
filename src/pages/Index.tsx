import { useEffect, useRef, useState } from "react";
import {
  Pause,
  Play,
  Keyboard,
  MousePointer2,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Hexagon,
} from "lucide-react";
import { Game, type GameStats } from "@/game/Game";
import { Button } from "@/components/ui/button";
import { HudPanel } from "@/components/hud/HudPanel";
import { StatsBar } from "@/components/hud/StatsBar";
import { Crosshair } from "@/components/hud/Crosshair";

const INITIAL_STATS: GameStats = {
  elapsed: 0,
  topScore: 0,
  botCount: 0,
  health: 10,
  maxHealth: 10,
  isDead: false,
};

const Index = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [cursor, setCursor] = useState({ x: -100, y: -100 });
  const [paused, setPaused] = useState(false);
  const [stats, setStats] = useState<GameStats>(INITIAL_STATS);

  useEffect(() => {
    if (!containerRef.current) return;
    const game = new Game(containerRef.current);
    gameRef.current = game;
    game.setStatsListener((s) => setStats(s));
    game.start();

    const onMove = (e: MouseEvent) => {
      setCursor({ x: e.clientX, y: e.clientY });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape" || e.code === "KeyP") {
        e.preventDefault();
        const next = game.togglePause();
        setPaused(next);
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("keydown", onKey);
      game.setStatsListener(undefined);
      game.dispose();
      gameRef.current = null;
    };
  }, []);

  const handleTogglePause = () => {
    const game = gameRef.current;
    if (!game) return;
    setPaused(game.togglePause());
  };

  return (
    <div
      className={`relative w-screen h-screen overflow-hidden bg-game-bg ${
        paused ? "" : "cursor-none"
      }`}
    >
      {/* Game canvas */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* Vignette + scanlines overlay (visual depth) */}
      <div className="pointer-events-none absolute inset-0 vignette" />
      <div className="pointer-events-none absolute inset-0 scanlines opacity-50" />

      {/* TOP HUD */}
      <div className="absolute top-0 left-0 right-0 z-30 pointer-events-none">
        <div className="flex items-start justify-between gap-6 p-5">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <Hexagon
                className="w-9 h-9 text-game-accent animate-pulse-glow"
                strokeWidth={1.5}
              />
              <Hexagon
                className="absolute inset-0 m-auto w-4 h-4 text-game-accent-2"
                strokeWidth={2}
                fill="currentColor"
              />
            </div>
            <div className="flex flex-col leading-tight">
              <div className="font-mono text-[10px] tracking-[0.45em] uppercase text-game-muted">
                System
              </div>
              <div className="font-mono text-base tracking-[0.35em] uppercase text-game-accent">
                Voxel<span className="text-game-accent-2">Cube</span>
              </div>
            </div>
          </div>

          {/* Stats */}
          <StatsBar
            stats={stats}
            health={stats.health}
            maxHealth={stats.maxHealth}
          />

          {/* Pause */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleTogglePause}
            className="pointer-events-auto font-mono uppercase tracking-[0.3em] text-[10px] gap-2 bg-game-panel/80 border-game-accent/40 text-game-accent hover:bg-game-accent/15 hover:text-game-accent clip-hud-sm h-9 px-4"
          >
            {paused ? (
              <>
                <Play className="w-3 h-3" strokeWidth={2.5} />
                Resume
              </>
            ) : (
              <>
                <Pause className="w-3 h-3" strokeWidth={2.5} />
                Pause
              </>
            )}
          </Button>
        </div>
      </div>

      {/* BOTTOM HUD */}
      <div className="absolute bottom-0 left-0 right-0 z-30 pointer-events-none">
        <div className="flex items-end justify-between gap-6 p-5">
          {/* Controls left */}
          <HudPanel label="Movement" tone="muted">
            <div className="px-4 pt-5 pb-3 flex items-center gap-4">
              <div className="flex items-center gap-1.5 text-game-muted">
                <Keyboard className="w-4 h-4" />
                <span className="font-mono text-[10px] tracking-[0.25em] uppercase">
                  WASD
                </span>
              </div>
              <div className="w-px h-5 bg-game-accent/30" />
              <div className="grid grid-cols-3 grid-rows-2 gap-0.5">
                <div />
                <KeyCap>
                  <ArrowUp className="w-2.5 h-2.5" />
                </KeyCap>
                <div />
                <KeyCap>
                  <ArrowLeft className="w-2.5 h-2.5" />
                </KeyCap>
                <KeyCap>
                  <ArrowDown className="w-2.5 h-2.5" />
                </KeyCap>
                <KeyCap>
                  <ArrowRight className="w-2.5 h-2.5" />
                </KeyCap>
              </div>
            </div>
          </HudPanel>

          {/* Center hint */}
          <div className="font-mono text-[10px] tracking-[0.35em] uppercase text-game-muted/80 text-center">
            <span className="text-game-accent">Space</span> Jump
            <span className="mx-3 text-game-muted/40">/</span>
            <span className="text-game-accent">LMB</span> Fire
            <span className="mx-3 text-game-muted/40">/</span>
            <span className="text-game-accent">Esc</span> Pause
          </div>

          {/* Combat right */}
          <HudPanel label="Combat" tone="cyan">
            <div className="px-4 pt-5 pb-3 flex items-center gap-3">
              <div className="flex items-center gap-1.5 text-game-accent-2">
                <MousePointer2 className="w-4 h-4" />
                <span className="font-mono text-[10px] tracking-[0.25em] uppercase">
                  Fire
                </span>
              </div>
              <div className="w-px h-5 bg-game-accent/30" />
              <KeyCap tone="cyan">
                <span className="text-[9px] font-mono tracking-widest">LMB</span>
              </KeyCap>
              <KeyCap tone="accent">
                <span className="text-[9px] font-mono tracking-widest">SP</span>
              </KeyCap>
            </div>
          </HudPanel>
        </div>
      </div>

      {/* Death banner (transient) */}
      {stats.isDead && !paused && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
          <div className="relative">
            <div className="absolute -inset-10 bg-game-danger/10 blur-3xl rounded-full" />
            <HudPanel label="System" tone="danger" className="relative">
              <div className="px-10 py-8 flex flex-col items-center gap-2">
                <div className="font-mono text-3xl tracking-[0.4em] text-game-danger uppercase animate-blink-soft">
                  Terminated
                </div>
                <div className="font-mono text-[10px] tracking-[0.35em] text-game-muted uppercase">
                  Reinitializing run...
                </div>
              </div>
            </HudPanel>
          </div>
        </div>
      )}

      {/* Pause overlay */}
      {paused && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-game-bg/80 backdrop-blur-md">
          <div className="absolute inset-0 scanlines opacity-30 pointer-events-none" />
          <div className="relative flex flex-col items-center gap-8">
            <div className="relative">
              <div className="absolute -inset-12 bg-game-accent/10 blur-3xl rounded-full" />
              <HudPanel label="Standby" tone="accent" sweep className="relative">
                <div className="px-16 py-8 flex flex-col items-center gap-3">
                  <div className="font-mono text-4xl tracking-[0.5em] uppercase text-game-accent">
                    Paused
                  </div>
                  <div className="font-mono text-[10px] tracking-[0.35em] uppercase text-game-muted">
                    Simulation suspended
                  </div>
                </div>
              </HudPanel>
            </div>
            <Button
              type="button"
              onClick={handleTogglePause}
              className="font-mono uppercase tracking-[0.4em] text-xs gap-2 bg-game-accent text-game-bg hover:bg-game-accent/90 clip-hud-sm h-11 px-8"
            >
              <Play className="w-4 h-4" strokeWidth={2.5} />
              Resume
            </Button>
          </div>
        </div>
      )}

      {/* Crosshair (hidden when paused) */}
      {!paused && <Crosshair x={cursor.x} y={cursor.y} />}
    </div>
  );
};

interface KeyCapProps {
  children: React.ReactNode;
  tone?: "accent" | "cyan" | "muted";
}

const KeyCap = ({ children, tone = "muted" }: KeyCapProps) => {
  const colorClass =
    tone === "accent"
      ? "text-game-accent border-game-accent/50"
      : tone === "cyan"
        ? "text-game-accent-2 border-game-accent-2/50"
        : "text-game-muted border-game-muted/40";
  return (
    <div
      className={`w-5 h-5 flex items-center justify-center border bg-game-bg/60 clip-hud-sm ${colorClass}`}
    >
      {children}
    </div>
  );
};

export default Index;
