import { useEffect, useRef, useState } from "react";
import { Game } from "@/game/Game";

const Index = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState({ x: -100, y: -100 });

  useEffect(() => {
    if (!containerRef.current) return;
    const game = new Game(containerRef.current);
    game.start();

    const onMove = (e: MouseEvent) => {
      setCursor({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener("mousemove", onMove);

    return () => {
      window.removeEventListener("mousemove", onMove);
      game.dispose();
    };
  }, []);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-game-bg cursor-none">
      <div ref={containerRef} className="absolute inset-0" />

      {/* HUD overlay */}
      <div className="pointer-events-none absolute inset-0 flex flex-col">
        <div className="px-6 py-4 font-mono text-game-accent text-xs tracking-widest uppercase">
          Voxel Cube
        </div>
        <div className="flex-1" />
        <div className="px-6 py-4 font-mono text-game-muted text-[10px] tracking-wider text-center uppercase">
          WASD / Arrows to move &middot; Space to jump &middot; Click to shoot
        </div>
      </div>

      {/* Custom crosshair following the mouse */}
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
    </div>
  );
};

export default Index;
