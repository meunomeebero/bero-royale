import { useEffect, useState } from "react";
import type { GameStats } from "@/game/Game";
import { StatsBar } from "@/components/hud/StatsBar";
import { BoostBar } from "@/components/hud/BoostBar";
import { PickupToast, type PickupEvent } from "@/components/hud/PickupToast";
import { KillFeed } from "@/components/hud/KillFeed";
import type { KillEvent } from "@/components/hud/KillFeed";
import { Leaderboard } from "@/components/hud/Leaderboard";
import { PlayersList } from "@/components/hud/PlayersList";
import { ChatPanel, type ChatMessage } from "@/components/hud/ChatPanel";
import { PingBadge } from "@/components/hud/PingBadge";
import { GamePanel, KeyCap, SegBar, HUD } from "@/components/hud/primitives";
import { WeaponHotbar } from "@/components/hud/WeaponHotbar";

/**
 * SECRET HUD LAB (/hudlab) — renders the in-game HUD over a static cozy backdrop
 * with rich mock data so the 2-D HUD can be screenshotted + iterated with
 * Playwright (the 3-D game can't render headless). Deterministic via URL params:
 *   ?m=1            mobile sizes
 *   ?boosts=0|1|2   active boost chips (speed, +rapid)
 *   ?shield=0..10   shield charges
 *   ?hp=0..10       health
 *   ?toast=0|1      show the pickup toast (kept on-screen by fast re-fire)
 *   ?kf=0|1         show the kill feed
 *   ?fire=constant|concentrated|boss
 * The bottom column mirrors the real game (toast → boost bar → controls) so
 * overlap problems reproduce faithfully. Dev-only, unlinked.
 */

const NAMES = [
  "Bero", "Lila", "Pingo", "Tato", "Nuvem", "Brisa", "Quindim", "Fubá",
  "Jambo", "Catito", "Maré", "Pipoca",
];
const BEST_RUNS = NAMES.map((n, i) => ({
  username: n, aliveSeconds: 600 - i * 37, kills: 24 - i * 2, endedAt: "2026-06-20T00:00:00.000Z",
}));
// i===0 is "me" (bero); 1-2 are real, 3-7 are bots → "3 reais · 5 bots".
const ROSTER = NAMES.slice(0, 8).map((n, i) => ({ id: `p${i}`, name: n, me: i === 0, isBot: i >= 3 }));
const CHAT: ChatMessage[] = [
  { id: "c1", name: "Lila", text: "alguém no rio?", t: 1 },
  { id: "c2", name: "Pingo", text: "vou de boost", t: 2 },
  { id: "c3", name: "Bero", text: "cobre a ponte!", t: 3 },
  { id: "c4", name: "Tato", text: "rampage 🔥", t: 4 },
];
const KILL_VARIANTS: Omit<KillEvent, "id" | "t">[] = [
  { killer: "Lila", victim: "Bero", streak: 1, victimStreak: 6 },
  { killer: "Bero", victim: "Pingo", streak: 4 },
  { killer: "", victim: "Tato", streak: 0 },
  { killer: "Quindim", victim: "Nuvem", streak: 9 },
];

const q = (k: string, d: string) =>
  new URLSearchParams(window.location.search).get(k) ?? d;
const num = (k: string, d: number) => {
  const v = Number(q(k, String(d)));
  return Number.isFinite(v) ? v : d;
};

export default function HudLab() {
  const [isMobile, setIsMobile] = useState(q("m", "0") === "1");
  const [shield, setShield] = useState(num("shield", 5));
  const [health, setHealth] = useState(num("hp", 7));
  const [nBoosts, setNBoosts] = useState(num("boosts", 2));
  const showToast = q("toast", "1") === "1";
  const showKf = q("kf", "1") === "1";
  const fireMode = q("fire", "concentrated") as GameStats["fireMode"];

  const [pickup, setPickup] = useState<PickupEvent | null>(null);
  const [killEvents, setKillEvents] = useState<KillEvent[]>([]);

  // Keep the transients on-screen for screenshots: re-fire before they fade.
  useEffect(() => {
    if (!showToast && !showKf) return;
    let seq = 0;
    const tick = () => {
      seq += 1;
      if (showToast) {
        const effect = seq % 2 === 0 ? "heal" : "dash";
        const label = effect === "heal" ? "HP restaurado" : "Dashs recarregados";
        setPickup({ kind: effect, label, t: 1_000_000 + seq });
      }
      if (showKf) {
        const v = KILL_VARIANTS[seq % KILL_VARIANTS.length];
        setKillEvents([{ ...v, id: `k${seq}`, t: 1_000_000 + seq }]);
      }
    };
    tick();
    const iv = setInterval(tick, 1100);
    return () => clearInterval(iv);
  }, [showToast, showKf]);

  const SPEED = 16, RAPID = 20;
  const boosts = [
    nBoosts >= 1 ? { kind: "speed", label: "Velocidade", remaining: SPEED * 2, duration: SPEED } : null,
    nBoosts >= 2 ? { kind: "rapid", label: "Tiro rápido", remaining: RAPID * 3, duration: RAPID } : null,
  ].filter(Boolean) as GameStats["boosts"];

  const stats: GameStats = {
    elapsed: 137, topScore: 24, botCount: 3, health, maxHealth: 10, isDead: false,
    dashCharges: 2, dashMaxCharges: 3, kills: 8, mode: "multiplayer", mpConnected: true,
    mpLocal: false, mpPlayers: 9, ping: 42, talking: false, voiceMode: "ptt", fireMode,
    weaponSlot: fireMode === "concentrated" ? 1 : fireMode === "boss" ? -1 : 0,
    chargeProgress: 0.6, respawnIn: 0, shield, leaderboard: [], roster: ROSTER,
    bestRuns: BEST_RUNS, boosts,
  };

  const btn = "rounded-md border border-white/30 bg-black/40 px-2 py-1 text-[11px] font-semibold text-white hover:bg-black/60";

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-gradient-to-b from-[#bfe3ff] via-[#e7f3da] to-[#8fcf6f] font-sans">
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#6fbf57]/70 to-transparent" />

      {/* Dev control panel */}
      <div className="absolute right-2 bottom-2 z-50 flex flex-col gap-1.5 rounded-lg bg-black/35 p-2 backdrop-blur">
        <div className="text-[11px] font-bold uppercase tracking-wide text-white/80">HUD Lab</div>
        <div className="flex gap-1">
          <button className={btn} onClick={() => setShield((s) => Math.max(0, s - 1))}>esc −</button>
          <span className="px-1 text-[11px] text-white">{shield}</span>
          <button className={btn} onClick={() => setShield((s) => Math.min(10, s + 1))}>esc +</button>
        </div>
        <div className="flex gap-1">
          <button className={btn} onClick={() => setHealth((h) => Math.max(0, h - 1))}>hp −</button>
          <span className="px-1 text-[11px] text-white">{health}</span>
          <button className={btn} onClick={() => setHealth((h) => Math.min(10, h + 1))}>hp +</button>
        </div>
        <button className={btn} onClick={() => setNBoosts((n) => (n + 1) % 3)}>boosts {nBoosts}</button>
        <button className={btn} onClick={() => setIsMobile((m) => !m)}>{isMobile ? "mobile" : "desktop"}</button>
      </div>

      {/* Top-center stats */}
      <div className="absolute left-1/2 top-5 -translate-x-1/2">
        <StatsBar
          elapsed={stats.elapsed}
          topScore={stats.topScore}
          botCount={stats.botCount}
          kills={stats.kills}
          shield={stats.shield}
          mode={stats.mode}
          health={stats.health}
          maxHealth={stats.maxHealth}
          isMobile={isMobile}
        />
      </div>

      {/* Right: ranking */}
      <Leaderboard bestRuns={stats.bestRuns} mode="multiplayer" isMobile={isMobile} />

      {/* Left: ping + players list + chat (mirrors the real left column) */}
      <div className="absolute left-3 top-24 flex flex-col gap-2">
        <PingBadge ping={stats.ping} isMobile={isMobile} />
        <PlayersList players={stats.roster} isMobile={isMobile} isBero={q("bero", "1") === "1"} />
        <ChatPanel messages={CHAT} onSend={() => {}} isMobile={isMobile} />
      </div>

      {/* Kill feed (self-positioned, top-center) */}
      {showKf && <KillFeed events={killEvents} isMobile={isMobile} />}

      {/* Bottom column — mirrors the real game stack so overlaps reproduce:
          toast → boost bar → controls. */}
      <div
        className="absolute bottom-0 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center gap-2 pb-4"
      >
        {showToast && <PickupToast pickup={pickup} isMobile={isMobile} />}
        <BoostBar boosts={stats.boosts} isMobile={isMobile} />
        {/* Weapon hotbar + dash, mirroring the real Index.tsx bottom controls. */}
        <div className="flex items-end gap-2.5">
          <WeaponHotbar
            slot={stats.weaponSlot}
            chargeProgress={stats.chargeProgress}
            isMobile={isMobile}
            onSelect={() => {}}
          />
          <GamePanel accent={HUD.honey} className="flex items-center gap-2" style={{ padding: isMobile ? "6px 10px" : "7px 12px" }}>
            <SegBar segments={3} filled={2} accent={HUD.honey} isMobile={isMobile} />
            <KeyCap>Shift</KeyCap>
          </GamePanel>
        </div>
      </div>
    </div>
  );
}
