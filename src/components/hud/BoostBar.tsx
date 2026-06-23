import { memo } from "react";
import { Gauge, Zap, Shield, Star, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { GamePanel, HUD, IconWell, KeyCap, SegBar, type Accent } from "./primitives";

// ---------------------------------------------------------------------------
// Types — coded against the contract shape (inline; NOT imported from Game to
// avoid module-ordering issues during the Build phase).
// ---------------------------------------------------------------------------

export interface Boost {
  /** Power-up kind key shared server↔client (only TIMED ones reach here). */
  kind: string;
  /** PT-BR label for the kind. */
  label: string;
  /** Seconds left on this boost. */
  remaining: number;
  /** Seconds the boost was originally applied with (drives the bar width). */
  duration: number;
}

interface BoostBarProps {
  boosts: Boost[];
  isMobile?: boolean;
}

// ---------------------------------------------------------------------------
// Per-kind identity (icon + accent). Only the timed boosts (speed/rapid/shield)
// ever show a chip; instant kinds (heal/dash/super) just flash the PickupToast.
// speed → rose, rapid → honey, shield → success (sage). Unknown → muted.
// ---------------------------------------------------------------------------

interface Tone {
  icon: LucideIcon;
  accent: Accent;
}

const TONES: Record<string, Tone> = {
  speed: { icon: Gauge, accent: HUD.rose },
  rapid: { icon: Zap, accent: HUD.honey },
  shield: { icon: Shield, accent: HUD.success },
};

const FALLBACK: Tone = { icon: Star, accent: HUD.muted };

/**
 * BoostBar — a row of dark cocoa-glass chips, one per active timed power-up.
 * Each chip is a small GamePanel tinted by its kind's accent ring, holding a
 * saturated IconWell, a tiny uppercase label, a segmented countdown bar that
 * burns down across the boost's duration, and the seconds left as an outlined
 * numeral. A ×N stack chip surfaces when multiple pickups are contributing
 * time. Renders nothing when no boosts are active so it never occupies space
 * above the bottom controls.
 */
const BoostBarImpl = ({ boosts, isMobile = false }: BoostBarProps) => {
  if (!boosts.length) return null;

  return (
    <div
      className={cn(
        "pointer-events-none flex items-center justify-center",
        isMobile ? "gap-2" : "gap-2.5",
      )}
    >
      {boosts.map((b) => {
        const tone = TONES[b.kind] ?? FALLBACK;
        const Icon = tone.icon;

        // Kept countdown math: ratio = remaining / duration, secs.
        const ratio = b.duration > 0 ? b.remaining / b.duration : 0;
        const secs = Math.max(0, Math.ceil(b.remaining));
        // Discrete countdown across a single boost's duration (4–6 cells).
        const segments = Math.min(6, Math.max(4, Math.ceil(b.duration)));
        const filled = Math.max(
          0,
          Math.min(segments, Math.ceil((Math.min(1, ratio) * segments))),
        );
        // ×N surfaces when extra pickups stacked time beyond one duration.
        const stacks = Math.max(1, Math.floor(ratio + 1e-6));

        return (
          <GamePanel
            key={b.kind}
            accent={tone.accent}
            radius={8}
            className="flex items-center animate-rise"
            style={{
              gap: isMobile ? 7 : 9,
              padding: isMobile ? "5px 8px" : "7px 10px",
            }}
          >
            <div className="relative">
              <IconWell
                icon={Icon}
                accent={tone.accent}
                size={isMobile ? 26 : 30}
              />
              {stacks > 1 && (
                <span
                  className="absolute -right-2 -top-2"
                  aria-label={`${stacks} pilhas`}
                >
                  <KeyCap active accent={tone.accent}>
                    ×{stacks}
                  </KeyCap>
                </span>
              )}
            </div>

            <div className="flex flex-col" style={{ gap: 4 }}>
              <span
                className="hud-label leading-none"
                style={{ fontSize: isMobile ? 8 : 9 }}
              >
                {b.label}
              </span>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={segments}
                aria-valuenow={filled}
                aria-label={`${b.label}: ${secs}s`}
              >
                <SegBar
                  segments={segments}
                  filled={filled}
                  accent={tone.accent}
                  isMobile={isMobile}
                />
              </div>
            </div>

            <span
              className="hud-num hud-num-sm flex items-baseline leading-none"
              style={{ fontSize: isMobile ? 16 : 20 }}
            >
              {secs}
              <span
                className="font-bold opacity-70"
                style={{ fontSize: isMobile ? 9 : 11, WebkitTextStrokeWidth: 0 }}
              >
                s
              </span>
            </span>
          </GamePanel>
        );
      })}
    </div>
  );
};

/**
 * Memoized: skips a re-render when the `boosts` array reference is unchanged.
 * While boosts are active their countdown values change every tick (so it must
 * re-render), but it bails out once the array is referentially stable.
 */
export const BoostBar = memo(BoostBarImpl);
