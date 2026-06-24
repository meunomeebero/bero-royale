import { memo } from "react";
import { Crosshair, Sword, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { GamePanel, HUD, INK, IconWell } from "./primitives";

/**
 * Minecraft-style weapon hotbar (bottom-center) — 3 slots replacing the old
 * fire-mode toggle: 1 = constant shot, 2 = concentrated super, 3 = melee saber.
 * The active slot lifts + lights its accent ring. Desktop shows the 1/2/3 key
 * hint; both desktop (click) and mobile (tap) select a slot. A charge bar fills
 * under slot 2 while the super winds up. Boss override (slot = -1) lights none.
 *
 * Memoized on the active slot + (quantized) charge so it only re-renders on a
 * real change, never per frame.
 */
const SLOTS: { icon: LucideIcon; accent: string; label: string }[] = [
  { icon: Crosshair, accent: HUD.rose, label: "Tiro constante" },
  { icon: Zap, accent: HUD.terracotta, label: "Tiro concentrado" },
  { icon: Sword, accent: HUD.honey, label: "Sabre de luz" },
];

const WeaponHotbarImpl = ({
  slot,
  chargeProgress,
  isMobile = false,
  onSelect,
}: {
  slot: number;
  chargeProgress: number;
  isMobile?: boolean;
  onSelect: (n: number) => void;
}) => {
  const cell = isMobile ? 42 : 48;
  return (
    <div className="pointer-events-auto flex items-end gap-1.5">
      {SLOTS.map((s, i) => {
        const active = i === slot;
        const charging = i === 1 && chargeProgress > 0 && chargeProgress < 1;
        return (
          <button
            key={i}
            type="button"
            onPointerUp={() => onSelect(i)}
            aria-label={s.label}
            style={{ touchAction: "manipulation" }}
            className="relative transition-transform active:translate-y-[2px]"
          >
            <GamePanel
              accent={active ? s.accent : INK}
              radius={10}
              className="grid place-items-center"
              style={{
                width: cell,
                height: cell,
                opacity: active ? 1 : 0.68,
                transform: active ? "translateY(-3px)" : "none",
              }}
            >
              <IconWell
                icon={s.icon}
                accent={active ? s.accent : HUD.muted}
                size={isMobile ? 22 : 26}
              />
            </GamePanel>

            {/* Desktop key hint (1/2/3), Minecraft-style. */}
            {!isMobile && (
              <span
                className="absolute -left-1 -top-1 grid h-4 w-4 place-items-center text-[9px] font-bold leading-none"
                style={{
                  color: "#fff",
                  background: active ? s.accent : "rgba(36,16,25,0.85)",
                  border: `1.5px solid ${INK}`,
                  borderRadius: 4,
                }}
              >
                {i + 1}
              </span>
            )}

            {/* Concentrated charge fill under slot 2. */}
            {charging && (
              <span
                className="absolute inset-x-1"
                style={{ bottom: -5, height: 4, borderRadius: 3, background: "rgba(36,16,25,0.6)" }}
              >
                <span
                  className={cn("block h-full")}
                  style={{
                    width: `${Math.round(chargeProgress * 100)}%`,
                    background: HUD.honey,
                    borderRadius: 3,
                  }}
                />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

export const WeaponHotbar = memo(WeaponHotbarImpl);
