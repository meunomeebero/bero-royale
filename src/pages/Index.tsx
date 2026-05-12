import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { Game } from "@/game/Game";
import { Button } from "@/components/ui/button";

const Index = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [cursor, setCursor] = useState({ x: -100, y: -100 });
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const game = new Game(containerRef.current);
    gameRef.current = game;
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
        <div className="flex items-start justify-between px-6 py-4">
          <div className="font-mono text-game-accent text-xs tracking-widest uppercase">
            Voxel Cube
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
