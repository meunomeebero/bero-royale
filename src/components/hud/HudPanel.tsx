import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface HudPanelProps {
  children: ReactNode;
  className?: string;
  /** Optional small label rendered at the top-left of the panel. */
  label?: string;
  /** Highlight color for the label / accent bracket. */
  tone?: "accent" | "cyan" | "danger" | "muted";
  /** Show an animated scanning sweep on top. */
  sweep?: boolean;
}

const toneClass = {
  accent: "text-game-accent",
  cyan: "text-game-accent-2",
  danger: "text-game-danger",
  muted: "text-game-muted",
};

/**
 * A diagonally-clipped HUD panel with bracket corners and an inner border.
 * Used as the building block for all heads-up display widgets.
 */
export const HudPanel = ({
  children,
  className,
  label,
  tone = "accent",
  sweep = false,
}: HudPanelProps) => {
  return (
    <div className={cn("relative", className)}>
      {/* Outer brackets */}
      <div className="absolute inset-0 bracket-corners pointer-events-none">
        <span className="br-bl" />
        <span className="br-br" />
      </div>

      {/* Panel body */}
      <div
        className="clip-hud relative overflow-hidden border border-game-accent/25 bg-[var(--gradient-hud)]"
        style={{ background: "var(--gradient-hud)" }}
      >
        {sweep && (
          <div className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-game-accent/15 to-transparent animate-hud-sweep" />
        )}
        {label && (
          <div
            className={cn(
              "absolute top-1.5 left-3 font-mono text-[9px] tracking-[0.3em] uppercase",
              toneClass[tone],
            )}
          >
            {label}
          </div>
        )}
        <div className="relative">{children}</div>
      </div>
    </div>
  );
};
