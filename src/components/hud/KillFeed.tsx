import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowDownToLine, Crown, Skull } from "lucide-react";
import { cn } from "@/lib/utils";
import { GamePanel, HexBadge, HUD, IconWell } from "./primitives";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KillEvent {
  /** Unique id for this event (e.g. crypto.randomUUID or monotonic counter). */
  id: string;
  /** Killer name. Empty string = environmental death (fell / lava / no killer). */
  killer: string;
  victim: string;
  /** Kill streak count for the killer at the time of this kill. */
  streak: number;
  /** The victim's kill streak that was ended (drives "interrompeu a chacina"). */
  victimStreak?: number;
  /** Unix timestamp (ms) when the event occurred. */
  t: number;
}

// ---------------------------------------------------------------------------
// Streak tiers (PT-BR, escalating alarm)
// ---------------------------------------------------------------------------

type MsgKind = "normal" | "rampage" | "shutdown" | "environment";

interface StreakTier {
  /** Min streak count (inclusive) to activate this tier. */
  min: number;
  suffix: string;
}

const STREAK_TIERS: StreakTier[] = [
  { min: 10, suffix: "é um mito entre os mortais" },
  { min: 7, suffix: "é uma lenda viva" },
  { min: 5, suffix: "está imparável" },
  { min: 3, suffix: "tá fazendo uma chacina" },
];

// Variety banks. The line is chosen deterministically from the event id so the
// text stays stable across re-renders (no flicker), while still feeling varied.
const NORMAL_LINES = [
  (k: string, v: string) => `${k} matou ${v}`,
  (k: string, v: string) => `${k} eliminou ${v}`,
  (k: string, v: string) => `${k} mandou ${v} pro respawn`,
  (k: string, v: string) => `${k} derrubou ${v}`,
  (k: string, v: string) => `${k} apagou ${v}`,
];
const SHUTDOWN_LINES = [
  (k: string, v: string) => `${k} interrompeu a chacina de ${v}!`,
  (k: string, v: string) => `${k} encerrou a sequência de ${v}!`,
  (k: string, v: string) => `${k} acabou com a killstreak de ${v}!`,
  (k: string, v: string) => `${k} calou ${v}, que tava voando!`,
];
const ENV_LINES = [
  (v: string) => `${v} caiu no esquecimento`,
  (v: string) => `${v} encontrou o abismo`,
  (v: string) => `${v} virou poeira`,
];

/** Stable string hash so message variety + styling never flicker on re-render. */
function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function pick<T>(arr: T[], id: string): T {
  return arr[hashId(id) % arr.length];
}

function buildMessage(ev: KillEvent): { text: string; kind: MsgKind } {
  const { killer, victim, streak, victimStreak = 0, id } = ev;
  if (!killer) return { text: pick(ENV_LINES, id)(victim), kind: "environment" };
  if (victimStreak >= 3)
    return { text: pick(SHUTDOWN_LINES, id)(killer, victim), kind: "shutdown" };
  if (streak >= 3) {
    const tier = STREAK_TIERS.find((t) => streak >= t.min);
    return {
      text: `${killer} matou ${victim} e ${tier?.suffix ?? "tá fazendo uma chacina"}`,
      kind: "rampage",
    };
  }
  return { text: pick(NORMAL_LINES, id)(killer, victim), kind: "normal" };
}

/** Per-kind identity — accent color + emblem icon. Color is always paired with a
 *  distinct icon/shape (colorblind-safe): normal/rampage → Skull, shutdown → Crown
 *  (dethroned the streak), environment → a falling block (ArrowDownToLine). */
const TONES: Record<MsgKind, { accent: string; icon: LucideIcon }> = {
  normal: { accent: HUD.danger, icon: Skull },
  rampage: { accent: HUD.honey, icon: Skull },
  shutdown: { accent: HUD.success, icon: Crown },
  environment: { accent: HUD.muted, icon: ArrowDownToLine },
};

// ---------------------------------------------------------------------------
// One-at-a-time ticker — shows a SINGLE notification, then the next in queue,
// so kills never pile up. Older queued events are dropped when the queue grows
// (FFA bots produce a lot), so it always shows the most RECENT activity.
// ---------------------------------------------------------------------------

const SHOW_MS = 2200; // how long each notification stays up
const FADE_MS = 350; // fade-out transition
const MAX_QUEUE = 6; // cap so a busy lobby shows recent kills, not a backlog

interface VisibleEvent extends KillEvent {
  /** True while the fade-out CSS transition is running. */
  fading: boolean;
}

function useKillTicker(events: KillEvent[]) {
  const [current, setCurrent] = useState<VisibleEvent | null>(null);
  const queue = useRef<KillEvent[]>([]);
  const seen = useRef<Set<string>>(new Set());
  const running = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const pump = useCallback(() => {
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
  }, []);

  useEffect(() => {
    // Enqueue only genuinely new ids (never re-show an event that already played).
    const fresh = events.filter((e) => !seen.current.has(e.id));
    if (!fresh.length) return;
    fresh.forEach((e) => seen.current.add(e.id));
    queue.current.push(...fresh);
    if (queue.current.length > MAX_QUEUE) {
      queue.current = queue.current.slice(-MAX_QUEUE);
    }
    pump();
  }, [events, pump]);

  useEffect(() => {
    const t = timers.current;
    return () => t.forEach(clearTimeout);
  }, []);

  return current;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface KillFeedProps {
  events: KillEvent[];
  isMobile?: boolean;
}

/**
 * KillFeed — top-center kill notifications shown to ALL players, one at a time.
 * Each entry is a cocoa-glass GamePanel ribbon accented by kind (normal→danger,
 * rampage→honey, shutdown→success, environment→muted) with a matching IconWell
 * emblem. Auto-dismisses with a CSS fade-out; streak >= 3 escalates to a PT-BR
 * alarming suffix plus a ×N HexBadge.
 */
const KillFeedImpl = ({ events, isMobile = false }: KillFeedProps) => {
  const current = useKillTicker(events);

  if (!current) return null;

  return (
    <div
      className={cn(
        // Self-positions BELOW the top stats bar (Index/lab render it bare).
        "pointer-events-none absolute left-1/2 z-20 flex -translate-x-1/2 flex-col items-center",
        isMobile ? "top-12 max-w-[55vw]" : "top-24",
      )}
      aria-live="polite"
      aria-label="Kill feed"
    >
      <KillChip key={current.id} event={current} isMobile={isMobile} />
    </div>
  );
};

/**
 * Memoized: `events` only changes when a new kill arrives (its own state array),
 * never on the per-tick stats updates, so this bails out in between kills.
 */
export const KillFeed = memo(KillFeedImpl);

// ---------------------------------------------------------------------------
// Individual chip
// ---------------------------------------------------------------------------

interface KillChipProps {
  event: VisibleEvent;
  isMobile?: boolean;
}

const KillChip = ({ event, isMobile = false }: KillChipProps) => {
  const { streak, fading } = event;
  const { text, kind } = buildMessage(event);
  const tone = TONES[kind];
  const showStreak = kind === "rampage" && streak >= 3;

  return (
    <GamePanel
      accent={tone.accent}
      radius={8}
      className={cn(
        "flex items-center animate-rise transition-opacity",
        fading ? "opacity-0 duration-[600ms]" : "opacity-95 duration-[150ms]",
      )}
      style={{
        gap: isMobile ? 8 : 10,
        padding: isMobile ? "5px 9px 5px 5px" : "6px 12px 6px 6px",
      }}
    >
      <IconWell
        icon={tone.icon}
        accent={tone.accent}
        shape="hex"
        size={isMobile ? 24 : 30}
      />
      <span
        className={cn(
          "hud-text font-bold leading-snug",
          isMobile ? "max-w-[46vw] truncate text-[13px]" : "text-[15px]",
        )}
      >
        {text}
      </span>
      {showStreak && (
        <HexBadge
          accent={tone.accent}
          size={isMobile ? 22 : 26}
          value={`×${streak}`}
        />
      )}
    </GamePanel>
  );
};
