import { useEffect, useRef } from "react";
import { Game } from "@/game/Game";

const Index = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const game = new Game(containerRef.current);
    game.start();
    return () => {
      game.dispose();
    };
  }, []);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-game-bg">
      <div ref={containerRef} className="absolute inset-0" />

      {/* HUD overlay */}
      <div className="pointer-events-none absolute inset-0 flex flex-col">
        <div className="px-6 py-4 font-mono text-game-accent text-xs tracking-widest uppercase">
          Voxel Cube
        </div>
        <div className="flex-1" />
        <div className="px-6 py-4 font-mono text-game-muted text-xs tracking-wider text-center">
          Arrow keys to move &middot; Space to jump
        </div>
      </div>
    </div>
  );
};

export default Index;
