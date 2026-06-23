import { type CSSProperties, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Game-HUD primitives — the shared visual language of the in-match HUD.
 * Direction by GLM 5.2 (see docs/mega-brain.md run): dark translucent cocoa-glass
 * panels, thick ink outlines, hard stepped depth shadows (no soft web glow),
 * segmented meters, outlined numerals, and saturated accent identity colors.
 *
 * Replaces the old parchment-card look (HudPanel: cream fill + cozy-shadow +
 * paper-grain). Everything here renders crisp DOM over the canvas — the retro
 * pixelation post-FX only affects the WebGL render, NOT this overlay, so the
 * "retro" feel is stylistic (chunky/hard-edged), not literal pixelation.
 */

/** Near-black cocoa used for every outline/border — crisper than the text ink. */
export const INK = "#241019";
/** Translucent cocoa scrim fill for panels. */
export const SCRIM = "rgba(59, 41, 31, 0.80)";

/** Palette identity tokens (hex, matching index.css --game-* vars). */
export const HUD = {
  rose: "#D14E6E",
  honey: "#E0A340",
  terracotta: "#C56A4E",
  danger: "#B5523E",
  success: "#7FA05B",
  muted: "#9B7B63",
} as const;

export type Accent = (typeof HUD)[keyof typeof HUD] | string;

/** Flat-top hexagon used by HexBadge / IconWell / shield pips. */
export const HEX = "polygon(25% 4%, 75% 4%, 100% 50%, 75% 96%, 25% 96%, 0% 50%)";

/* ─────────────────────────── GamePanel ─────────────────────────── */

interface GamePanelProps {
  children: ReactNode;
  /** Identity color — drives the 1.5px outer ring. */
  accent?: Accent;
  /** Corner radius in px (chunky game, NOT 16px+ web cards). */
  radius?: number;
  className?: string;
  style?: CSSProperties;
}

/** The base dark translucent container for every HUD cluster. */
export const GamePanel = ({
  children,
  accent = INK,
  radius = 8,
  className,
  style,
}: GamePanelProps) => (
  <div
    className={cn("relative", className)}
    style={{
      background: SCRIM,
      border: `2px solid ${INK}`,
      borderRadius: radius,
      boxShadow: `inset 0 1px 0 rgba(255,255,255,0.10), inset 0 -2px 0 rgba(0,0,0,0.34), 0 0 0 1.5px ${accent}, 0 3px 0 rgba(0,0,0,0.45)`,
      ...style,
    }}
  >
    {children}
  </div>
);

/* ─────────────────────────── SegBar ─────────────────────────── */

interface SegBarProps {
  /** Total cells to draw. */
  segments: number;
  /** How many are filled (0..segments). */
  filled: number;
  accent?: Accent;
  /** Low state → danger color + pulse (e.g. HP <= 30%). */
  low?: boolean;
  isMobile?: boolean;
  className?: string;
}

/** Discrete segmented meter (HP / shield / charge / boost). No gradient fills —
 *  discrete steps rhyme with the retro color-banding. */
export const SegBar = ({
  segments,
  filled,
  accent = HUD.rose,
  low = false,
  isMobile = false,
  className,
}: SegBarProps) => {
  const fill = low ? HUD.danger : accent;
  return (
    <div className={cn("flex items-center", className)} style={{ gap: 2 }}>
      {Array.from({ length: segments }).map((_, i) => {
        const on = i < filled;
        return (
          <span
            key={i}
            className={cn(on && low && "animate-pip-pulse")}
            style={{
              width: isMobile ? 9 : 7,
              height: isMobile ? 14 : 12,
              borderRadius: 2,
              background: on ? fill : "rgba(255,255,255,0.12)",
              boxShadow: on
                ? "inset 0 1px 0 rgba(255,255,255,0.4), inset 0 -1px 0 rgba(0,0,0,0.35)"
                : "inset 0 1px 0 rgba(0,0,0,0.25)",
            }}
          />
        );
      })}
    </div>
  );
};

/* ─────────────────────────── HexBadge ─────────────────────────── */

interface HexBadgeProps {
  accent?: Accent;
  size?: number;
  icon?: LucideIcon;
  /** Big value rendered inside (outlined numeral). */
  value?: ReactNode;
  className?: string;
}

/** Beveled hexagon anchor for a key number or icon (Brawl-Stars emblem DNA). */
export const HexBadge = ({
  accent = HUD.rose,
  size = 40,
  icon: Icon,
  value,
  className,
}: HexBadgeProps) => (
  <div
    className={cn("relative grid place-items-center", className)}
    style={{ width: size, height: size, clipPath: HEX, background: INK }}
  >
    <div
      className="flex h-full w-full flex-col items-center justify-center"
      style={{
        clipPath: HEX,
        transform: "scale(0.86)",
        background: accent,
        boxShadow: "inset 0 2px 0 rgba(255,255,255,0.25)",
        gap: value != null && Icon ? size * 0.04 : 0,
      }}
    >
      {Icon && (
        <Icon
          style={{
            width: size * (value != null ? 0.28 : 0.46),
            height: size * (value != null ? 0.28 : 0.46),
            color: "#fff",
          }}
          strokeWidth={2.75}
        />
      )}
      {value != null && (
        <span
          className="hud-num hud-num-sm leading-none"
          style={{ fontSize: size * (Icon ? 0.4 : 0.46) }}
        >
          {value}
        </span>
      )}
    </div>
  </div>
);

/* ─────────────────────────── IconWell ─────────────────────────── */

interface IconWellProps {
  icon: LucideIcon;
  accent?: Accent;
  size?: number;
  shape?: "hex" | "circle";
  /** Translucent variant (accent at ~55%). */
  ghost?: boolean;
  className?: string;
}

/** Saturated icon container — accent fill, ink edge, inner top highlight. */
export const IconWell = ({
  icon: Icon,
  accent = HUD.honey,
  size = 28,
  shape = "circle",
  ghost = false,
  className,
}: IconWellProps) => (
  <div
    className={cn("grid shrink-0 place-items-center", className)}
    style={{
      width: size,
      height: size,
      background: ghost ? `${accent}8c` : accent,
      border: `2px solid ${INK}`,
      ...(shape === "circle"
        ? { borderRadius: "50%" }
        : { clipPath: HEX, border: "none", outline: `2px solid ${INK}` }),
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.28)",
    }}
  >
    <Icon
      style={{ width: size * 0.5, height: size * 0.5, color: "#fff" }}
      strokeWidth={2.75}
    />
  </div>
);

/* ─────────────────────────── RibbonStrip ─────────────────────────── */

interface RibbonStripProps {
  children: ReactNode;
  accent?: Accent;
  icon?: LucideIcon;
  isMobile?: boolean;
  className?: string;
}

/** Banner pill for temporal/headline stats (timer, coin) — accent fill, ink
 *  edge, hard shadow, optional leading IconWell (Cooking-Fever ribbon DNA). */
export const RibbonStrip = ({
  children,
  accent = HUD.honey,
  icon: Icon,
  isMobile = false,
  className,
}: RibbonStripProps) => (
  <div
    className={cn("flex items-center", className)}
    style={{
      gap: isMobile ? 6 : 8,
      paddingLeft: Icon ? (isMobile ? 4 : 5) : isMobile ? 10 : 14,
      paddingRight: isMobile ? 10 : 14,
      paddingTop: isMobile ? 4 : 5,
      paddingBottom: isMobile ? 4 : 5,
      background: `${accent}f0`,
      border: `2px solid ${INK}`,
      borderRadius: 999,
      boxShadow:
        "inset 0 1px 0 rgba(255,255,255,0.30), inset 0 -2px 0 rgba(0,0,0,0.28), 0 3px 0 rgba(0,0,0,0.40)",
    }}
  >
    {Icon && (
      <IconWell icon={Icon} accent={accent} size={isMobile ? 22 : 26} />
    )}
    {children}
  </div>
);

/* ─────────────────────────── KeyCap ─────────────────────────── */

interface KeyCapProps {
  children: ReactNode;
  active?: boolean;
  accent?: Accent;
  className?: string;
}

/** Keyboard hint chip (Shift / Space / 1-2-3). */
export const KeyCap = ({
  children,
  active = false,
  accent = HUD.rose,
  className,
}: KeyCapProps) => (
  <span
    className={cn(
      "inline-grid place-items-center px-1.5 text-[10px] font-bold leading-none",
      className,
    )}
    style={{
      minWidth: 18,
      height: 18,
      color: "#fff",
      background: active ? accent : "rgba(255,255,255,0.15)",
      border: `2px solid ${INK}`,
      borderRadius: 4,
      boxShadow: "inset 0 -2px 0 rgba(0,0,0,0.30)",
    }}
  >
    {children}
  </span>
);
