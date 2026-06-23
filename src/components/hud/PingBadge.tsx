import { memo } from "react";
import { Activity } from "lucide-react";
import { GamePanel, HUD } from "./primitives";

/**
 * Server round-trip latency, shown in-match so the player can tell whether a
 * laggy moment is their connection. Color-coded: green < 80ms, honey < 150ms,
 * red otherwise; "—" while latency is still unknown (or local mode).
 *
 * Updates ~1x/sec on the existing notifyStats cadence — memoized so it only
 * re-renders when the (quantized) ping actually changes.
 */
const tone = (ping: number | null) => {
  if (ping == null) return HUD.muted;
  if (ping < 80) return HUD.success;
  if (ping < 150) return HUD.honey;
  return HUD.danger;
};

const PingBadgeImpl = ({
  ping,
  isMobile = false,
}: {
  ping: number | null;
  isMobile?: boolean;
}) => {
  const accent = tone(ping);
  return (
    <GamePanel
      accent={accent}
      radius={999}
      className="flex items-center"
      style={{
        gap: isMobile ? 4 : 5,
        padding: isMobile ? "3px 8px" : "4px 9px",
      }}
    >
      <Activity
        style={{
          width: isMobile ? 12 : 14,
          height: isMobile ? 12 : 14,
          color: accent,
        }}
        strokeWidth={3}
      />
      <span
        className="hud-text font-bold tabular-nums"
        style={{ fontSize: isMobile ? 11 : 13 }}
      >
        {ping == null ? "—" : `${ping}ms`}
      </span>
    </GamePanel>
  );
};

export const PingBadge = memo(PingBadgeImpl);
