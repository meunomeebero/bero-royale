import { useCallback, useEffect, useRef, useState } from "react";
import {
  Pause,
  Play,
  Box,
  Wind,
  LogOut,
  Mic,
  Settings,
  Wifi,
  Home,
  RotateCcw,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Game, type GameStats, type GameMode, type KillFeedEntry } from "@/game/Game";
import { ModelLibrary } from "@/game/ModelLibrary";
import {
  GamePanel,
  IconWell,
  SegBar,
  KeyCap,
  HUD,
  INK,
} from "@/components/hud/primitives";
import { StatsBar } from "@/components/hud/StatsBar";
import { Crosshair } from "@/components/hud/Crosshair";
import { Leaderboard } from "@/components/hud/Leaderboard";
import { VoiceSettingsModal } from "@/components/hud/VoiceSettingsModal";
import { SettingsScreen } from "@/components/hud/SettingsScreen";
import { ChatPanel, type ChatMessage } from "@/components/hud/ChatPanel";
import { PlayersList } from "@/components/hud/PlayersList";
import { PingBadge } from "@/components/hud/PingBadge";
import { WeaponHotbar } from "@/components/hud/WeaponHotbar";
import { KillFeed, type KillEvent } from "@/components/hud/KillFeed";
import { BoostBar } from "@/components/hud/BoostBar";
import { PickupToast, type PickupEvent } from "@/components/hud/PickupToast";
import { MobileControls } from "@/components/hud/MobileControls";
import { useIsMobile } from "@/lib/useIsMobile";

const INITIAL_STATS: GameStats = {
  elapsed: 0,
  topScore: 0,
  botCount: 0,
  health: 10,
  maxHealth: 10,
  isDead: false,
  dashCharges: 3,
  dashMaxCharges: 3,
  kills: 0,
  mode: "local",
  mpConnected: false,
  mpLocal: false,
  mpPlayers: 0,
  ping: null,
  talking: false,
  voiceMode: "ptt",
  fireMode: "pistol",
  weaponSlot: 0,
  chargeProgress: 0,
  respawnIn: 0,
  shield: 0,
  leaderboard: [],
  roster: [],
  boosts: [],
};

const Index = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  // The crosshair tracks the pointer IMPERATIVELY (ref + el.style.transform) so
  // mousemove (60–1000Hz) never triggers a React re-render of the HUD tree.
  const crosshairRef = useRef<HTMLDivElement>(null);
  // Last pointer position, kept so the crosshair snaps back to it when it
  // remounts (after pause/loading) instead of parking off-screen until the
  // next mouse move.
  const cursorPos = useRef({ x: -100, y: -100 });
  const setCrosshairRef = useCallback((el: HTMLDivElement | null) => {
    crosshairRef.current = el;
    if (el) {
      const { x, y } = cursorPos.current;
      el.style.transform = `translate(calc(${x}px - 50%), calc(${y}px - 50%))`;
    }
  }, []);
  const location = useLocation();
  const navigate = useNavigate();
  const settings = location.state as
    | { username?: string; mode?: GameMode; animal?: string }
    | null;
  // Admin view: the "bero" account can see which online users are bots vs real.
  const isBero = (settings?.username ?? "").trim().toLowerCase() === "bero";
  const [paused, setPaused] = useState(false);
  // Full in-game settings overlay (opened from the pause menu). Mirrored into a
  // ref so the window keydown handler (set up once) can read it without stale
  // closure capture.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsOpenRef = useRef(false);
  // Chat focus also silences game input; mirrored to a ref so the settings
  // effect can OR the two reasons without re-running on chat focus changes.
  const chatFocusedRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<GameStats>(INITIAL_STATS);
  const [voiceSettingsOpen, setVoiceSettingsOpen] = useState(false);
  const [voiceInput, setVoiceInput] = useState<string | null>(null);
  const [voiceOutput, setVoiceOutput] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [killFeedEvents, setKillFeedEvents] = useState<KillEvent[]>([]);
  const [pickup, setPickup] = useState<PickupEvent | null>(null);
  const isMobile = useIsMobile();
  const [portrait, setPortrait] = useState(
    () => typeof window !== "undefined" && window.innerHeight > window.innerWidth,
  );

  // Track portrait/landscape so we can show the "rotate your phone" overlay.
  // Debounced: resize/orientationchange fire in bursts (mobile address-bar
  // show/hide + mid-rotation), and each setPortrait re-renders the HUD tree.
  useEffect(() => {
    const apply = () => setPortrait(window.innerHeight > window.innerWidth);
    apply();
    let t: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      if (t) clearTimeout(t);
      t = setTimeout(apply, 120);
    };
    window.addEventListener("resize", update, { passive: true });
    window.addEventListener("orientationchange", update, { passive: true });
    return () => {
      if (t) clearTimeout(t);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  // Keep the keydown-handler ref in sync, and silence game input (WASD/aim/fire)
  // while the in-game settings overlay is open so slider arrow-keys + clicks
  // never leak into the match. Respects chat focus too (shared input flag).
  useEffect(() => {
    settingsOpenRef.current = settingsOpen;
    gameRef.current?.setInputEnabled(!settingsOpen && !chatFocusedRef.current);
  }, [settingsOpen]);

  // Mobile: request fullscreen on the first touch so the browser chrome hides.
  // Works on Android/iPad; iOS Safari iPhone ignores it (no Fullscreen API there
  // — the true fix on iPhone is "Add to Home Screen", enabled via the meta tags).
  useEffect(() => {
    if (!isMobile) return;
    const go = () => {
      const el = document.documentElement as HTMLElement & {
        webkitRequestFullscreen?: () => Promise<void>;
      };
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (req) {
        try {
          void req.call(el);
        } catch {
          /* unsupported (iOS Safari iPhone) — no-op */
        }
      }
      window.removeEventListener("pointerdown", go);
    };
    window.addEventListener("pointerdown", go, { once: true });
    return () => window.removeEventListener("pointerdown", go);
  }, [isMobile]);

  useEffect(() => {
    // Entered without choosing a name/mode → back to the menu.
    if (!settings?.username) {
      navigate("/", { replace: true });
      return;
    }
    if (!containerRef.current) return;
    let game: Game | null = null;
    let cancelled = false;
    let onMove: ((e: MouseEvent) => void) | null = null;
    let onKey: ((e: KeyboardEvent) => void) | null = null;

    // Preload the voxel asset pack before booting the game — Platform, Player,
    // Bots and Decor all clone models synchronously from the loaded cache.
    ModelLibrary.preload()
      .then(() => {
        if (cancelled || !containerRef.current) return;
        game = new Game(containerRef.current, {
          mode: settings.mode ?? "local",
          username: settings.username,
          animal: settings.animal,
        });
        gameRef.current = game;
        game.setStatsListener((s) => setStats(s));
        const mode = settings.mode ?? "local";
        if (mode === "multiplayer") {
          // Keep the loading overlay up until the seed-gated buildWorld runs
          // (onReady fires once the world is built), so there is no terrain pop.
          game.setOnReady(() => {
            if (!cancelled) setLoading(false);
          });
        }
        game.start();
        if (mode !== "multiplayer") setLoading(false);

        // Register chat + kill-feed listeners (multiplayer only; no-ops in local).
        game.setChatListener((e) => {
          setChatMessages((prev) =>
            [...prev, { id: e.id, name: e.name, text: e.text, t: Date.now() }].slice(-30),
          );
        });
        game.setKillFeedListener((e: KillFeedEntry) => {
          // Keep the array bounded; KillFeed dedups by id so trimming old
          // (already-shown) entries never re-triggers them.
          setKillFeedEvents((prev) => [...prev, { ...e }].slice(-12));
        });
        // Power-up pickup toast (multiplayer only; no-op in local). A fresh
        // timestamp per pickup is the trigger so PickupToast re-fires on
        // back-to-back grabs of the same kind.
        game.setPickupListener((kind: string, label: string) => {
          setPickup({ kind, label, t: Date.now() });
        });

        // Position the crosshair directly on the DOM node — no setState, no
        // reconciliation. The element centers itself via the `- 50%` offset.
        onMove = (e: MouseEvent) => {
          // Route through the game's sensitivity gain so the reticle sits exactly
          // where the shot will land (same transform the aim raycast uses).
          const p = game!.aimCursorPos(e.clientX, e.clientY);
          cursorPos.current.x = p.x;
          cursorPos.current.y = p.y;
          const el = crosshairRef.current;
          if (el) {
            el.style.transform = `translate(calc(${p.x}px - 50%), calc(${p.y}px - 50%))`;
          }
        };
        onKey = (e: KeyboardEvent) => {
          // Don't intercept Esc/P while the player is typing in the chat input.
          if (document.activeElement?.tagName === "INPUT") return;
          // While the settings overlay is open, Esc closes it (back to pause)
          // and P is swallowed — never toggle the underlying pause state.
          if (settingsOpenRef.current) {
            if (e.code === "Escape") {
              e.preventDefault();
              setSettingsOpen(false);
            }
            return;
          }
          if (e.code === "Escape" || e.code === "KeyP") {
            e.preventDefault();
            setPaused(game!.togglePause());
          }
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("keydown", onKey);
      })
      .catch((err) => {
        console.error("Failed to load voxel asset pack", err);
      });

    return () => {
      cancelled = true;
      if (onMove) window.removeEventListener("mousemove", onMove);
      if (onKey) window.removeEventListener("keydown", onKey);
      if (game) {
        game.setStatsListener(undefined);
        game.setChatListener(undefined);
        game.setKillFeedListener(undefined);
        game.setPickupListener(undefined);
        game.dispose();
      }
      gameRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTogglePause = () => {
    // The settings overlay owns the paused state — close it first (never let a
    // stray pause-button tap unpause the game while settings sits on top).
    if (settingsOpen) return;
    const game = gameRef.current;
    if (!game) return;
    setPaused(game.togglePause());
  };

  // Stable so SettingsScreen's Esc-key effect doesn't re-subscribe each render.
  const handleSettingsBack = useCallback(() => setSettingsOpen(false), []);

  const handleChatSend = useCallback(
    (text: string) => {
      const game = gameRef.current;
      if (!game) return;
      game.sendChat(text);
      // Server never echoes the sender's own message, so append locally.
      const username = settings?.username ?? "Você";
      setChatMessages((prev) =>
        [...prev, { id: "me", name: username, text, t: Date.now() }].slice(-30),
      );
    },
    [settings?.username],
  );

  // Two independent reasons to silence game input — chat focus and the settings
  // overlay — share ONE InputManager flag, so each must respect the other or a
  // blur/close can re-enable keys while the other still wants them off.
  const handleChatFocusChange = useCallback((focused: boolean) => {
    chatFocusedRef.current = focused;
    gameRef.current?.setInputEnabled(!focused && !settingsOpenRef.current);
  }, []);

  const handleSelectSlot = useCallback((slot: number) => {
    gameRef.current?.selectWeaponSlot(slot);
  }, []);

  return (
    <div
      className={`relative w-screen h-screen overflow-hidden bg-[#241019] ${
        paused ? "" : "cursor-none"
      }`}
    >
      {/* Game canvas */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* TOP HUD */}
      {isMobile ? (
        /* ── Mobile top bar: compact, safe-area aware ── */
        <div
          className="absolute top-0 left-0 right-0 z-30 pointer-events-none flex items-start justify-between"
          style={{
            paddingTop: "max(env(safe-area-inset-top, 0px) + 4px, 4px)",
            paddingLeft: "max(env(safe-area-inset-left, 0px) + 4px, 4px)",
            paddingRight: "max(env(safe-area-inset-right, 0px) + 4px, 4px)",
          }}
        >
          {/* Left: connection badge + chat (multiplayer only) */}
          <div className="flex flex-col items-start gap-1">
            {stats.mode === "multiplayer" && (
              <div className="flex items-center gap-1.5">
                <GamePanel
                  accent={stats.mpConnected ? HUD.success : HUD.muted}
                  radius={999}
                  className="pointer-events-none flex items-center gap-1.5"
                  style={{ padding: "3px 8px 3px 3px" }}
                >
                  <IconWell
                    icon={stats.mpConnected ? (stats.mpLocal ? Home : Wifi) : Wifi}
                    accent={stats.mpConnected ? HUD.success : HUD.muted}
                    size={18}
                  />
                  <span className="hud-text text-[10px] font-bold leading-none">
                    {stats.mpConnected
                      ? `${stats.mpLocal ? "Local" : "Online"} · ${stats.mpPlayers}`
                      : "..."}
                  </span>
                </GamePanel>
                {!stats.mpLocal && <PingBadge ping={stats.ping} isMobile />}
              </div>
            )}
            {stats.mode === "multiplayer" && (
              <PlayersList players={stats.roster} isMobile isBero={isBero} />
            )}
            {stats.mode === "multiplayer" && (
              <ChatPanel
                messages={chatMessages}
                onSend={handleChatSend}
                onFocusChange={handleChatFocusChange}
                isMobile
              />
            )}
          </div>

          {/* Center: stats */}
          <StatsBar
            elapsed={stats.elapsed}
            topScore={stats.topScore}
            botCount={stats.botCount}
            kills={stats.kills}
            shield={stats.shield}
            mode={stats.mode}
            health={stats.health}
            maxHealth={stats.maxHealth}
            isMobile
          />

          {/* Right: config + pause (compact) */}
          <div className="flex items-center gap-1.5">
            {stats.mode === "multiplayer" && (
              <GamePanel radius={8}>
                <button
                  type="button"
                  onClick={() => setVoiceSettingsOpen(true)}
                  aria-label="Configurações"
                  className="pointer-events-auto flex h-7 w-7 items-center justify-center text-white transition-opacity hover:opacity-80"
                >
                  <Settings className="w-3.5 h-3.5" strokeWidth={2.5} />
                </button>
              </GamePanel>
            )}
            <GamePanel accent={HUD.rose} radius={8}>
              <button
                type="button"
                onClick={handleTogglePause}
                className="pointer-events-auto flex h-7 w-7 items-center justify-center text-white transition-opacity hover:opacity-80"
              >
                {paused ? (
                  <Play className="w-3.5 h-3.5" strokeWidth={2.5} />
                ) : (
                  <Pause className="w-3.5 h-3.5" strokeWidth={2.5} />
                )}
              </button>
            </GamePanel>
          </div>
        </div>
      ) : (
        /* ── Desktop top bar ── */
        <div className="absolute top-0 left-0 right-0 z-30 pointer-events-none">
          <div className="flex items-start justify-between gap-6 p-5">
            {/* Connection badge + chat (left column) */}
            <div className="flex flex-col items-start gap-2">
              {stats.mode === "multiplayer" && (
                <div className="flex items-center gap-2">
                  <GamePanel
                    accent={stats.mpConnected ? HUD.success : HUD.muted}
                    radius={999}
                    className="pointer-events-none flex items-center gap-2"
                    style={{ padding: "4px 12px 4px 4px" }}
                  >
                    <IconWell
                      icon={stats.mpConnected ? (stats.mpLocal ? Home : Wifi) : Wifi}
                      accent={stats.mpConnected ? HUD.success : HUD.muted}
                      size={22}
                    />
                    <span className="hud-text text-[12px] font-bold leading-none">
                      {stats.mpConnected
                        ? `${stats.mpLocal ? "Local" : "Online"} · ${stats.mpPlayers} ${stats.mpPlayers === 1 ? "jogador" : "jogadores"}`
                        : "Conectando..."}
                    </span>
                  </GamePanel>
                  {!stats.mpLocal && <PingBadge ping={stats.ping} />}
                </div>
              )}
              {stats.mode === "multiplayer" && (
                <PlayersList players={stats.roster} isBero={isBero} />
              )}
              {stats.mode === "multiplayer" && (
                <ChatPanel
                  messages={chatMessages}
                  onSend={handleChatSend}
                  onFocusChange={handleChatFocusChange}
                />
              )}
            </div>

            {/* Stats */}
            <StatsBar
              elapsed={stats.elapsed}
              topScore={stats.topScore}
              botCount={stats.botCount}
              kills={stats.kills}
              shield={stats.shield}
              mode={stats.mode}
              health={stats.health}
              maxHealth={stats.maxHealth}
            />

            {/* Config + Pause */}
            <div className="flex items-center gap-2">
              {stats.mode === "multiplayer" && (
                <GamePanel radius={10}>
                  <button
                    type="button"
                    onClick={() => setVoiceSettingsOpen(true)}
                    aria-label="Configurações"
                    className="pointer-events-auto flex h-9 w-9 items-center justify-center text-white transition-opacity hover:opacity-80"
                  >
                    <Settings className="w-4 h-4" strokeWidth={2.5} />
                  </button>
                </GamePanel>
              )}
              <GamePanel accent={HUD.rose} radius={10}>
                <button
                  type="button"
                  onClick={handleTogglePause}
                  className="hud-text pointer-events-auto flex h-9 items-center gap-2 px-4 text-[13px] font-bold transition-opacity hover:opacity-80"
                >
                  {paused ? (
                    <>
                      <Play className="w-3.5 h-3.5" strokeWidth={2.5} />
                      Continuar
                    </>
                  ) : (
                    <>
                      <Pause className="w-3.5 h-3.5" strokeWidth={2.5} />
                      Pausar
                    </>
                  )}
                </button>
              </GamePanel>
            </div>
          </div>
        </div>
      )}

      {/* BOTTOM HUD — fire-mode toggle + dash (both platforms). Control legends
          now live on the pre-game instructions screen. */}
      {!loading && (
        <div
          className="absolute bottom-0 left-1/2 -translate-x-1/2 z-40 pointer-events-none flex flex-col items-center gap-2"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px) + 16px, 16px)" }}
        >
          {/* Power-up pickup toast — TOP of the bottom stack so it can never
              overlap the boost chips/controls below (they share this column). */}
          {stats.mode === "multiplayer" && (
            <PickupToast pickup={pickup} isMobile={isMobile} />
          )}
          {/* Voice cue (multiplayer): "Falando..." while G is held, otherwise the
              push-to-talk hint. Desktop only — mobile has no G key. */}
          {stats.mode === "multiplayer" && stats.talking && (
            <GamePanel
              accent={HUD.danger}
              radius={999}
              className="flex items-center gap-2"
              style={{ padding: "3px 12px 3px 3px" }}
            >
              <IconWell icon={Mic} accent={HUD.danger} size={20} />
              <span className="hud-text text-[11px] font-bold leading-none">
                Falando...
              </span>
            </GamePanel>
          )}
          {stats.mode === "multiplayer" && !stats.talking && !isMobile && (
            <GamePanel
              accent={HUD.muted}
              radius={999}
              className="flex items-center gap-2"
              style={{ padding: "3px 12px 3px 3px" }}
            >
              <IconWell icon={Mic} accent={HUD.muted} size={20} />
              <span className="hud-text flex items-center gap-1.5 text-[11px] font-bold leading-none">
                Segure
                <KeyCap>G</KeyCap>
                para falar
              </span>
            </GamePanel>
          )}
          {/* Active timed power-ups — sits just above the bottom controls so it
              never covers the top stats or the kill feed. Renders nothing when
              no boosts are active. */}
          <BoostBar boosts={stats.boosts} isMobile={isMobile} />
          <div className="flex items-end gap-2.5">
            {/* Minecraft-style weapon hotbar: 1 Pistol · 2 Energy Blast · 3 Lightsaber.
                Keys 1/2/3 or click/tap a slot. (BOSS, the "bero" double-tap-Tab
                override, lights no slot.) */}
            <WeaponHotbar
              slot={stats.weaponSlot}
              chargeProgress={stats.chargeProgress}
              isMobile={isMobile}
              onSelect={handleSelectSlot}
            />
            <DashMeter charges={stats.dashCharges} max={stats.dashMaxCharges} compact />
          </div>
        </div>
      )}

      {/* Kill feed — stacked kill-notification chips, top-center */}
      {!loading && stats.mode === "multiplayer" && (
        <KillFeed events={killFeedEvents} isMobile={isMobile} />
      )}

      {/* Death banner — small, non-blocking respawn countdown. The match stays
          fully visible behind it so the player can keep watching the action. */}
      {stats.isDead && !paused && (
        <div
          className="pointer-events-none absolute left-1/2 top-[22%] z-40 flex -translate-x-1/2 flex-col items-center gap-3"
          style={{
            padding: "32px 64px",
            background:
              "radial-gradient(ellipse at center, rgba(36,16,25,0.66) 0%, rgba(36,16,25,0) 72%)",
          }}
        >
          <div
            className="hud-num leading-none"
            style={{ fontSize: 44, color: HUD.danger }}
          >
            ELIMINADO
          </div>
          <div className="flex items-center gap-2">
            {stats.respawnIn > 0 ? (
              <>
                <span className="hud-text text-[15px] font-bold">Reaparece em</span>
                <span
                  className="hud-num leading-none"
                  style={{ fontSize: 26, color: HUD.honey }}
                >
                  {stats.respawnIn}
                </span>
                <span className="hud-text text-[15px] font-bold">s</span>
              </>
            ) : (
              <span className="hud-text text-[15px] font-bold">Reaparecendo...</span>
            )}
          </div>
        </div>
      )}

      {/* Pause overlay (hidden while the settings overlay is on top) */}
      {paused && !settingsOpen && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(36,16,25,0.6)" }}
        >
          <div className="flex flex-col items-center gap-8">
            <GamePanel accent={HUD.rose} radius={10}>
              <div className="flex flex-col items-center gap-1.5 px-16 py-9">
                <div className="hud-num leading-none" style={{ fontSize: 40 }}>
                  Pausado
                </div>
                {/* Desktop hint only */}
                {!isMobile && (
                  <div className="hud-text flex items-center gap-1.5 text-[12px] font-bold">
                    <KeyCap>Esc</KeyCap>
                    para retomar
                  </div>
                )}
              </div>
            </GamePanel>
            <div className="flex items-center gap-3">
              <GamePanel accent={HUD.rose} radius={8}>
                <button
                  type="button"
                  onClick={handleTogglePause}
                  className="hud-text flex h-11 items-center gap-2 px-8 text-sm font-bold transition-opacity hover:opacity-80"
                >
                  <Play className="w-4 h-4" strokeWidth={2.5} />
                  Continuar
                </button>
              </GamePanel>
              <GamePanel radius={8}>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  className="hud-text flex h-11 items-center gap-2 px-6 text-sm font-bold transition-opacity hover:opacity-80"
                >
                  <Settings className="w-4 h-4" strokeWidth={2.5} />
                  Configurações
                </button>
              </GamePanel>
              <GamePanel radius={8}>
                <button
                  type="button"
                  onClick={() => navigate("/")}
                  className="hud-text flex h-11 items-center gap-2 px-6 text-sm font-bold transition-opacity hover:opacity-80"
                >
                  <LogOut className="w-4 h-4" strokeWidth={2.5} />
                  Sair
                </button>
              </GamePanel>
            </div>
          </div>
        </div>
      )}

      {/* In-game settings (opened from the pause menu). Reuses the menu Settings
          screen in `inGame` mode (no audio-device section / mic prompt). Every
          control applies LIVE to the running game — the VHS slider previews on
          the still-rendered frame behind this overlay. */}
      {settingsOpen && (
        <div
          className="absolute inset-0 z-[55] flex items-center justify-center px-3"
          style={{ background: "rgba(36,16,25,0.78)" }}
          // Click the dark margin to dismiss (matches VoiceSettingsModal); the
          // panel itself is a child, so its clicks don't bubble to here.
          onClick={(e) => {
            if (e.target === e.currentTarget) setSettingsOpen(false);
          }}
        >
          <SettingsScreen
            inGame
            onBack={handleSettingsBack}
            onSfxMutedChange={(muted) => gameRef.current?.setSfxMuted(muted)}
            onPixelFilterChange={(on) => gameRef.current?.setPixelFilter(on)}
            onVhsLevelChange={(level) => gameRef.current?.setVhsLevel(level)}
            onOutlineLevelChange={(level) => gameRef.current?.setCelOutline(level)}
            onAimSensitivityChange={(s) => gameRef.current?.setAimSensitivity(s)}
          />
        </div>
      )}

      {/* Leaderboard — multiplayer: ranked by kills; local: shows bestRuns survival times */}
      {!loading && (
        <Leaderboard
          entries={stats.leaderboard}
          bestRuns={stats.bestRuns}
          mode={stats.mode}
          isMobile={isMobile}
        />
      )}

      {/* Voice settings modal (multiplayer only) */}
      {stats.mode === "multiplayer" && (
        <VoiceSettingsModal
          open={voiceSettingsOpen}
          onClose={() => setVoiceSettingsOpen(false)}
          onSelectInput={(id) => {
            setVoiceInput(id);
            gameRef.current?.setVoiceInputDevice(id);
          }}
          onSelectOutput={(id) => {
            setVoiceOutput(id);
            gameRef.current?.setVoiceOutputDevice(id);
          }}
          onRestart={() => gameRef.current?.restartVoice()}
          currentInput={voiceInput}
          currentOutput={voiceOutput}
        />
      )}

      {/* Mobile touch controls (MobileControls self-gates via useIsMobile too) */}
      {isMobile && !paused && !loading && (
        <MobileControls
          onMove={(x, y) => gameRef.current?.mobileMove(x, y)}
          onAim={(x, y) => gameRef.current?.mobileAim(x, y)}
          onAimEnd={() => gameRef.current?.mobileAimEnd()}
          onJump={() => gameRef.current?.mobileJump()}
          onDash={() => gameRef.current?.mobileDash()}
        />
      )}

      {/* Rotate-to-landscape gate (mobile + portrait only). Covers the game
          while portrait; the MENU page stays portrait and is untouched. */}
      {isMobile && portrait && (
        <div
          className="absolute inset-0 z-[60] flex flex-col items-center justify-center gap-4 px-8 text-center"
          style={{ background: "rgba(36,16,25,0.95)" }}
        >
          <RotateCcw
            className="h-14 w-14 animate-soft-float text-white"
            strokeWidth={2.25}
          />
          <div className="hud-text text-xl font-bold">
            Vire o celular para jogar
          </div>
        </div>
      )}

      {/* Crosshair (hidden when paused / loading). Mounted once; the mousemove
          handler writes its transform directly via crosshairRef — no re-render. */}
      {!paused && !loading && !isMobile && <Crosshair ref={setCrosshairRef} />}

      {/* Loading overlay while the voxel asset pack streams in */}
      {loading && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center"
          style={{ background: INK }}
        >
          <div className="hud-text flex items-center gap-2.5">
            <Box className="w-5 h-5 animate-soft-float text-white" strokeWidth={2.25} />
            <span className="text-lg font-bold">Carregando...</span>
          </div>
        </div>
      )}
    </div>
  );
};

const DashMeter = ({ charges, max, compact = false }: { charges: number; max: number; compact?: boolean }) => {
  // Discrete: how many full charges are currently available (honey filled), the
  // rest are spent (white/10). Sourced straight from stats — no per-frame state.
  const filled = Math.max(0, Math.min(max, Math.floor(charges)));
  const ready = filled >= 1;
  const accent = ready ? HUD.honey : HUD.muted;
  return (
    <GamePanel
      accent={accent}
      radius={compact ? 10 : 8}
      className="flex items-center"
      style={{ gap: compact ? 8 : 6, padding: compact ? "6px 12px" : "5px 10px" }}
    >
      <IconWell icon={Wind} accent={accent} size={compact ? 26 : 22} />
      {!compact && (
        <span className="hud-label text-[10px] leading-none">Dash</span>
      )}
      <SegBar segments={max} filled={filled} accent={HUD.honey} isMobile={compact} />
      <KeyCap active={ready} accent={HUD.honey}>
        Shift
      </KeyCap>
    </GamePanel>
  );
};

export default Index;
