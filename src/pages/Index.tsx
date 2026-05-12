import { useEffect, useRef, useState } from "react";
import { Pause, Play, Timer, Trophy, Users } from "lucide-react";
import { Game, type GameStats } from "@/game/Game";
import { Button } from "@/components/ui/button";

const formatTime = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
};

const Index = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [cursor, setCursor] = useState({ x: -100, y: -100 });
  const [paused, setPaused] = useState(false);
  const [stats, setStats] = useState<GameStats>({
    elapsed: 0,
    topScore: 0,
    botCount: 0,
  });

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
      <div ref={containerRef} className="absolute inset-0" />

      {/* HUD overlay */}
      <div className="absolute inset-0 flex flex-col pointer-events-none">
        <div className="flex items-start justify-between px-6 py-4 gap-4">
          <div className="flex flex-col gap-2">
            <div className="font-mono text-game-accent text-xs tracking-widest uppercase">
              Voxel Cube
            </div>
            <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-widest">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-game-bg/70 border border-game-accent/30 text-game-accent">
                <Timer className="w-3.5 h-3.5" />
                <span className="tabular-nums">{formatTime(stats.elapsed)}</span>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-game-bg/70 border border-game-muted/30 text-game-muted">
                <Trophy className="w-3.5 h-3.5" />
                <span className="tabular-nums">
                  {formatTime(stats.topScore)}
                </span>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-game-bg/70 border border-game-muted/30 text-game-muted">
                <Users className="w-3.5 h-3.5" />
                <span className="tabular-nums">{stats.botCount}</span>
              </div>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleTogglePause}
            className="pointer-events-auto font-mono uppercase tracking-widest text-[10px] gap-2 bg-game-bg/80 border-game-accent/40 text-game-accent hover:bg-game-accent/10 hover:text-game-accent"
          >
            {paused ? (
              <>
                <Play className="w-3 h-3" />
                Resume
              </>
            ) : (
              <>
                <Pause className="w-3 h-3" />
                Pause
              </>
            )}
          </Button>
        </div>
        <div className="flex-1" />
        <div className="px-6 py-4 font-mono text-game-muted text-[10px] tracking-wider text-center uppercase">
          WASD / Arrows to move &middot; Space to jump &middot; Click to shoot
          &middot; Esc / P to pause
        </div>
      </div>

      {/* Pause overlay */}
      {paused && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-game-bg/70 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-6">
            <div className="font-mono text-game-accent text-3xl tracking-[0.4em] uppercase">
              Paused
            </div>
            <Button
              type="button"
              onClick={handleTogglePause}
              className="font-mono uppercase tracking-widest gap-2 bg-game-accent text-game-bg hover:bg-game-accent/90"
            >
              <Play className="w-4 h-4" />
              Resume
            </Button>
          </div>
        </div>
      )}

      {/* Custom crosshair following the mouse (hidden when paused) */}
      {!paused && (
        <div
          className="pointer-events-none fixed z-50"
          style={{
            left: cursor.x,
            top: cursor.y,
            transform: "translate(-50%, -50%)",
          }}
        >
          <div className="relative w-8 h-8">
            <div className="absolute inset-0 rounded-full border-2 border-game-accent/80" />
            <div className="absolute inset-[10px] rounded-full bg-game-accent/90" />
            <div className="absolute left-1/2 top-0 w-px h-2 -translate-x-1/2 bg-game-accent/80" />
            <div className="absolute left-1/2 bottom-0 w-px h-2 -translate-x-1/2 bg-game-accent/80" />
            <div className="absolute top-1/2 left-0 h-px w-2 -translate-y-1/2 bg-game-accent/80" />
            <div className="absolute top-1/2 right-0 h-px w-2 -translate-y-1/2 bg-game-accent/80" />
          </div>
        </div>
      )}
    </div>
  );
};

export default Index;
