import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface HudPanelProps {
  children: ReactNode;
  className?: string;
  /** Optional small label rendered at the top-left of the panel. */
  label?: string;
  /** Tint color for the label text. */
  tone?: "rose" | "honey" | "terracotta" | "ink" | "muted";
  /** Corner radius tier. */
  radius?: "chip" | "panel" | "overlay";
}

const toneClass: Record<NonNullable<HudPanelProps["tone"]>, string> = {
  rose: "text-game-accent",
  honey: "text-game-accent-2",
  terracotta: "text-game-accent-3",
  ink: "text-game-ink",
  muted: "text-game-muted",
};

const radiusClass: Record<NonNullable<HudPanelProps["radius"]>, string> = {
  chip: "rounded-[10px]",
  panel: "rounded-[12px]",
  overlay: "rounded-[16px]",
};

/**
 * A warm parchment HUD panel: cream fill, clay hairline border, a crafted
 * layered shadow and a faint paper grain. The cozy-but-refined building block
 * for every heads-up widget.
 */
export const HudPanel = ({
  children,
  className,
  label,
  tone = "muted",
  radius = "chip",
}: HudPanelProps) => {
  return (
    <div
      className={cn(
        "relative overflow-hidden border-[1.5px] border-game-border bg-game-panel/95 cozy-shadow animate-rise",
        radiusClass[radius],
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-0 paper-grain opacity-70" />
      {label && (
        <div
          className={cn(
            "absolute top-2 left-3.5 text-[9px] font-semibold uppercase tracking-[0.14em] leading-none",
            toneClass[tone],
          )}
        >
          {label}
        </div>
      )}
      <div className="relative">{children}</div>
    </div>
  );
};
