import { memo } from "react";
import { HUD } from "./primitives";

/**
 * Dota-style "Channeling…" cue for the Energy Blast (weapon slot 2).
 *
 * A low-opacity text that pulses just below the crosshair while the super charges,
 * and vanishes the instant the channel completes (ready) or is cancelled. It signals
 * the COMMITMENT/vulnerability window (you're slowed + exposed) — complementary to the
 * small charge fill under the hotbar slot, not a duplicate.
 *
 * HUD rules applied:
 *  - Only-when-active (R4): rendered only while actively channeling slot 2.
 *  - Placement (R3): below the crosshair, never covering it / the kill feed / hotbar.
 *  - Readable over the bright moving scene (R2): a dark ink outline (text-shadow)
 *    carries the low-opacity text over grass, sky AND explosions.
 *  - On-theme (R1): honey accent (matches the charge fill) + the HUD UI font.
 *  - Not color-only (R5): the word "Channeling…" carries the meaning; the pulse
 *    honors prefers-reduced-motion (see .channel-flash in index.css).
 *  - Perf (R6): memoized on two primitive props; driven by the THROTTLED
 *    `chargeProgress` stat (quantized 5% buckets), and the flash is pure CSS — no
 *    per-frame React.
 */
const ChannelingIndicatorImpl = ({
  weaponSlot,
  chargeProgress,
}: {
  weaponSlot: number;
  chargeProgress: number;
}) => {
  // Slot 1 = Energy Blast. Show only while charging: progress started but not yet
  // ready (===1 means done → the player releases to fire, so the cue clears).
  if (weaponSlot !== 1 || chargeProgress <= 0 || chargeProgress >= 1) return null;
  return (
    <div className="pointer-events-none absolute left-1/2 top-[58%] z-40 -translate-x-1/2">
      <span
        className="channel-flash select-none whitespace-nowrap font-bold uppercase tracking-[0.35em]"
        style={{
          fontFamily: '"Baloo 2", "Hanken Grotesk", system-ui, sans-serif',
          fontSize: 15,
          color: HUD.honey,
          // Dark ink outline + soft drop + faint honey glow → legible at low opacity
          // over any frame (bright grass, sky, an explosion).
          textShadow:
            "0 0 2px #241019, 0 1px 1px #241019, -1px 0 1px #241019, 1px 0 1px #241019, 0 2px 6px rgba(0,0,0,0.6), 0 0 14px rgba(224,163,64,0.45)",
        }}
      >
        Channeling…
      </span>
    </div>
  );
};

export const ChannelingIndicator = memo(ChannelingIndicatorImpl);
