import { memo, useEffect, useRef, useState } from "react";
import { Heart, Gauge, Zap, Crown, Shield, Sparkles, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { HUD, IconWell, RibbonStrip } from "./primitives";

// ---------------------------------------------------------------------------
// Types — coded against the contract shape (inline; NOT imported from Game).
// The parent feeds a new {kind,label,t} object every time a power-up is picked
// up; `t` (a fresh timestamp) is the trigger that distinguishes back-to-back
// pickups of the SAME kind.
// ---------------------------------------------------------------------------

export interface PickupEvent {
  kind: string;
  label: string;
  /** Unique timestamp (ms) — changes on every pickup so repeats re-fire. */
  t: number;
}

interface PickupToastProps {
  /** Latest pickup, or null before anything has been collected. */
  pickup: PickupEvent | null;
  isMobile?: boolean;
}

// What the toast says — the EFFECT, never the power-up's name (pt-BR).
const MESSAGES: Record<string, string> = {
  heal: "HP restaurado",
  speed: "Velocidade aumentada",
  rapid: "Tiro acelerado",
  dash: "Dashs recarregados",
  shield: "Escudo ativado",
  super: "Super pronto",
};

// Per-kind icon (lucide, matching the HUD). Instant kinds (heal/dash/super) have
// no boost chip, so this toast is the only feedback they get.
const ICONS: Record<string, LucideIcon> = {
  heal: Heart,
  speed: Gauge,
  rapid: Zap,
  dash: Zap,
  shield: Shield,
  super: Crown,
};

// Per-effect accent so the toast is recognizable at a glance (still one accent
// per toast — restraint kept). Identity colors from the HUD palette.
const TONES: Record<string, string> = {
  heal: HUD.success, // sage — health
  dash: HUD.honey, // honey — movement
  super: HUD.rose, // rose — super
  speed: HUD.terracotta,
  rapid: HUD.honey,
  shield: HUD.success,
};
const FALLBACK_TONE = HUD.honey;

const SHOW_MS = 1800; // how long the toast stays up
const FADE_MS = 300; // fade-out transition

interface Visible extends PickupEvent {
  fading: boolean;
}

/**
 * PickupToast — a brief toast stating the EFFECT (e.g. "Dashs recarregados") for
 * ~1.8s whenever any power-up is picked up. Self-manages its own show/hide timers
 * and a tiny queue so rapid pickups still each get a moment on screen.
 *
 * Redesigned to the "game HUD" language: a single accent RibbonStrip (accent =
 * the pickup identity) with a leading IconWell + the effect line as white
 * .hud-text. Pops in via the CSS rise animation; no soft glow / no sparkle.
 */
const PickupToastImpl = ({ pickup, isMobile = false }: PickupToastProps) => {
  const [current, setCurrent] = useState<Visible | null>(null);
  const queue = useRef<PickupEvent[]>([]);
  const lastT = useRef<number>(0);
  const running = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Enqueue each genuinely-new pickup (deduped by its timestamp).
  useEffect(() => {
    if (!pickup || pickup.t === lastT.current) return;
    lastT.current = pickup.t;
    queue.current.push(pickup);
    pump();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickup]);

  const pump = () => {
    if (running.current) return;
    const next = queue.current.shift();
    if (!next) return;
    running.current = true;
    setCurrent({ ...next, fading: false });
    timers.current.push(
      setTimeout(() => {
        setCurrent((c) => (c ? { ...c, fading: true } : c));
        timers.current.push(
          setTimeout(() => {
            setCurrent(null);
            running.current = false;
            pump();
          }, FADE_MS),
        );
      }, SHOW_MS),
    );
  };

  // Clean up any pending timers on unmount.
  useEffect(() => {
    const t = timers.current;
    return () => t.forEach(clearTimeout);
  }, []);

  if (!current) return null;

  const Icon = ICONS[current.kind] ?? Sparkles;
  const message = MESSAGES[current.kind] ?? current.label;
  const accent = TONES[current.kind] ?? FALLBACK_TONE;

  return (
    <div
      className={cn(
        "pointer-events-none animate-rise transition-opacity motion-reduce:transition-none",
        current.fading ? "opacity-0 duration-[300ms]" : "opacity-100 duration-[150ms]",
      )}
      aria-live="polite"
    >
      <RibbonStrip accent={accent} isMobile={isMobile}>
        <IconWell icon={Icon} accent={accent} size={isMobile ? 24 : 28} />
        <span
          className="hud-text font-bold leading-none"
          style={{ fontSize: isMobile ? 13 : 15 }}
        >
          {message}
        </span>
      </RibbonStrip>
    </div>
  );
};

/**
 * Memoized: `pickup` is its own state object that only changes on a fresh grab,
 * so this bails out of the per-tick stats re-renders.
 */
export const PickupToast = memo(PickupToastImpl);
