interface CrosshairProps {
  x: number;
  y: number;
}

/**
 * Futuristic targeting reticle: dual rotating rings, tick marks,
 * a central glow dot, and 4 directional brackets.
 */
export const Crosshair = ({ x, y }: CrosshairProps) => {
  return (
    <div
      className="pointer-events-none fixed z-50"
      style={{
        left: x,
        top: y,
        transform: "translate(-50%, -50%)",
      }}
    >
      <div className="relative w-12 h-12">
        {/* Outer rotating ring with notches */}
        <svg
          className="absolute inset-0 w-full h-full animate-ring-rotate text-game-accent"
          viewBox="0 0 48 48"
          fill="none"
        >
          <circle
            cx="24"
            cy="24"
            r="22"
            stroke="currentColor"
            strokeWidth="1"
            strokeDasharray="2 6"
            opacity="0.85"
          />
        </svg>

        {/* Mid stationary ring */}
        <div className="absolute inset-2 rounded-full border border-game-accent/70" />

        {/* Center dot with glow */}
        <div
          className="absolute left-1/2 top-1/2 w-1.5 h-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-game-accent"
          style={{ boxShadow: "var(--glow-accent-strong)" }}
        />

        {/* Directional ticks */}
        <div className="absolute left-1/2 top-0 w-px h-2 -translate-x-1/2 bg-game-accent" />
        <div className="absolute left-1/2 bottom-0 w-px h-2 -translate-x-1/2 bg-game-accent" />
        <div className="absolute top-1/2 left-0 h-px w-2 -translate-y-1/2 bg-game-accent" />
        <div className="absolute top-1/2 right-0 h-px w-2 -translate-y-1/2 bg-game-accent" />

        {/* Diagonal brackets */}
        <div className="absolute -top-1 -left-1 w-2 h-2 border-l border-t border-game-accent-2" />
        <div className="absolute -top-1 -right-1 w-2 h-2 border-r border-t border-game-accent-2" />
        <div className="absolute -bottom-1 -left-1 w-2 h-2 border-l border-b border-game-accent-2" />
        <div className="absolute -bottom-1 -right-1 w-2 h-2 border-r border-b border-game-accent-2" />
      </div>
    </div>
  );
};
