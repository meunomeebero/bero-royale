import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import type { GameMode } from "@/game/Game";
import { Game } from "@/game/Game";
import { ModelLibrary } from "@/game/ModelLibrary";
import { cn } from "@/lib/utils";
import { useIsMobile, isStandalonePWA } from "@/lib/useIsMobile";
import { SettingsScreen } from "@/components/hud/SettingsScreen";
import { AboutScreen } from "@/components/hud/AboutScreen";
import { CharacterSelect } from "@/components/hud/CharacterSelect";
import { InstructionsScreen } from "@/components/hud/InstructionsScreen";
import { InstallScreen } from "@/components/hud/InstallScreen";

const USERNAME_KEY = "voxelCube.username";
const MODE_KEY = "voxelCube.mode";
const SKIP_INTRO_KEY = "cozykiller:skipIntro";

type MenuView = "main" | "select" | "instructions" | "install" | "settings" | "about";

interface MenuItem {
  key: string;
  label: string;
  onSelect: () => void;
}

const Menu = () => {
  const navigate = useNavigate();
  const [view, setView] = useState<MenuView>("main");
  const [pendingMode, setPendingMode] = useState<GameMode>("multiplayer");
  const [pendingName, setPendingName] = useState("");
  const [pendingAnimal, setPendingAnimal] = useState("");
  const isMobile = useIsMobile();
  // In a mobile BROWSER tab the game can't go truly fullscreen, so we block play
  // and show the "add to home screen" guide. An installed PWA runs fullscreen.
  const needsInstall = isMobile && !isStandalonePWA();

  // Ambient live-game background refs
  const bgRef = useRef<HTMLDivElement>(null);
  const ambientGameRef = useRef<Game | null>(null);

  // Mount the ambient game background: real game world with bots fighting and a
  // featured showcase avatar jumping. Blurred via CSS. No HUD, no controls, no
  // stats. (DO NOT touch — this is the live THREE.js scene behind the menu.)
  useEffect(() => {
    if (!bgRef.current) return;
    const container = bgRef.current;
    let game: Game | null = null;
    let cancelled = false;

    ModelLibrary.preload()
      .then(() => {
        if (cancelled || !container) return;
        game = new Game(container, {
          mode: "ambient",
          featuredAnimal: ModelLibrary.randomAnimalName(),
        });
        ambientGameRef.current = game;
        game.start();
      })
      .catch((err) => {
        console.warn("Ambient game background failed to load:", err);
      });

    return () => {
      cancelled = true;
      if (game) {
        game.dispose();
      }
      ambientGameRef.current = null;
    };
  }, []);

  // From the main menu, picking a mode goes to the character-select screen —
  // unless we're in a mobile browser tab, where play is gated behind the
  // "add to home screen" guide so the game can run fullscreen.
  const openSelect = (mode: GameMode) => {
    if (needsInstall) {
      setView("install");
      return;
    }
    setPendingMode(mode);
    setView("select");
  };

  // Actually launch the match.
  const launchGame = (name: string, animal: string) => {
    localStorage.setItem(USERNAME_KEY, name);
    localStorage.setItem(MODE_KEY, pendingMode);
    navigate("/play", { state: { username: name, mode: pendingMode, animal } });
  };

  // "Vamos lá!" on the character-select screen → instructions screen first,
  // unless the player ticked "não mostrar mais" before.
  const onSelectStart = (name: string, animal: string) => {
    localStorage.setItem(USERNAME_KEY, name);
    setPendingName(name);
    setPendingAnimal(animal);
    const skip = (() => {
      try {
        return localStorage.getItem(SKIP_INTRO_KEY) === "1";
      } catch {
        return false;
      }
    })();
    // Mobile uses on-screen controls, so the keyboard-controls screen is skipped.
    if (skip || isMobile) launchGame(name, animal);
    else setView("instructions");
  };

  // "Vamos lá!" on the instructions screen → persist the skip choice + launch.
  const onInstructionsStart = (dontShowAgain: boolean) => {
    try {
      localStorage.setItem(SKIP_INTRO_KEY, dontShowAgain ? "1" : "0");
    } catch {
      /* ignore */
    }
    launchGame(pendingName, pendingAnimal);
  };

  const items: MenuItem[] = [
    { key: "single", label: "Single player", onSelect: () => openSelect("local") },
    { key: "multi", label: "Multiplayer", onSelect: () => openSelect("multiplayer") },
    { key: "settings", label: "Configurações", onSelect: () => setView("settings") },
    { key: "about", label: "Sobre", onSelect: () => setView("about") },
  ];

  return (
    <div
      className={cn(
        "relative flex min-h-screen w-screen overflow-hidden bg-[#241019] px-5 md:px-0",
        view === "main"
          ? "items-center justify-center md:justify-start md:pl-[clamp(2.5rem,8vw,9rem)]"
          : "items-center justify-center",
      )}
    >
      {/* Ambient blurred live-game background — real THREE.js scene with bots. */}
      <div
        ref={bgRef}
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          filter: "blur(3px) saturate(1.06)",
          transform: "scale(1.04)",
          transformOrigin: "center center",
        }}
      />

      {/* Warm vignette + left scrim — menu views only (select + instructions
          are full-screen overlays that bring their own backdrops). */}
      {view !== "select" && view !== "instructions" && (
        <>
          <div
            className="pointer-events-none absolute inset-0 z-0"
            style={{
              background:
                "radial-gradient(ellipse at 50% 42%, rgba(36,16,25,0) 26%, rgba(36,16,25,0.42) 74%, rgba(24,10,16,0.66) 100%)",
            }}
          />
          <div
            className="pointer-events-none absolute inset-0 z-0 hidden md:block"
            style={{
              background:
                "linear-gradient(90deg, rgba(22,9,15,0.78) 0%, rgba(22,9,15,0.5) 26%, rgba(22,9,15,0.16) 50%, transparent 68%)",
            }}
          />
        </>
      )}

      {/* ── MAIN MENU ─────────────────────────────────────────────────────── */}
      {view === "main" && (
        <div className="relative z-10 flex w-full max-w-[360px] flex-col items-center gap-8 md:items-start animate-rise">
          {/* Mobile-only soft halo so the centered column reads over the bright
              scene (desktop uses the left-side scrim instead). */}
          <div className="pointer-events-none absolute -inset-x-10 -inset-y-12 -z-10 rounded-[44px] bg-[radial-gradient(ellipse_at_center,rgba(24,10,16,0.6),rgba(24,10,16,0.22)_54%,transparent_78%)] blur-xl md:hidden" />

          {/* Logo — chunky, beveled, two-line wordmark. */}
          <header className="select-none text-center md:text-left">
            <h1 className="font-logo leading-[0.84] tracking-[-0.01em]">
              <span
                className="block text-[clamp(3rem,9vw,5.2rem)] font-extrabold"
                style={{
                  color: "#FBEFD8",
                  WebkitTextStroke: "3px #2a160e",
                  paintOrder: "stroke fill",
                  textShadow:
                    "0 5px 0 rgba(80,40,28,0.5), 0 16px 34px rgba(18,7,12,0.7)",
                }}
              >
                Cozy
              </span>
              <span
                className="mt-1 block text-[clamp(3rem,9vw,5.2rem)] font-extrabold"
                style={{
                  color: "#D14E6E",
                  WebkitTextStroke: "3px #2a160e",
                  paintOrder: "stroke fill",
                  textShadow:
                    "0 5px 0 rgba(110,28,42,0.6), 0 16px 34px rgba(18,7,12,0.7)",
                }}
              >
                Killer
              </span>
            </h1>
            <div className="mt-4 flex items-center justify-center gap-2.5 md:justify-start">
              <span className="rounded-md bg-game-ink px-2 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-[#fff4e6] shadow-[0_2px_0_rgba(0,0,0,0.35)]">
                Demo
              </span>
            </div>
          </header>

          {/* Menu list — quiet text rows that light up on hover. */}
          <nav className="flex w-full flex-col gap-1">
            {items.map(({ key, label, onSelect }) => (
              <button
                key={key}
                type="button"
                onClick={onSelect}
                className="group relative flex w-full items-center rounded-2xl px-4 py-3 text-left outline-none transition-all duration-200 hover:translate-x-1 hover:bg-[#fff4e6]/12 hover:backdrop-blur-sm focus-visible:bg-[#fff4e6]/12 focus-visible:ring-2 focus-visible:ring-game-accent/40"
              >
                <span className="font-logo text-[26px] font-bold text-[#fde9cf] drop-shadow-[0_2px_6px_rgba(18,7,12,0.85)] transition-colors duration-200 group-hover:text-white group-focus-visible:text-white">
                  {label}
                </span>
                <ChevronRight
                  className="ml-auto h-5 w-5 shrink-0 text-game-accent opacity-0 -translate-x-2 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100"
                  strokeWidth={2.6}
                />
              </button>
            ))}
          </nav>
        </div>
      )}

      {/* ── CHARACTER SELECT (3D fighter pick) ───────────────────────────── */}
      {view === "select" && (
        <CharacterSelect
          mode={pendingMode}
          onBack={() => setView("main")}
          onStart={onSelectStart}
        />
      )}

      {/* ── INSTRUCTIONS / HOW-TO-PLAY (before entering the room) ─────────── */}
      {view === "instructions" && (
        <InstructionsScreen
          mode={pendingMode}
          name={pendingName}
          animal={pendingAnimal}
          onBack={() => setView("select")}
          onStart={onInstructionsStart}
        />
      )}

      {/* ── INSTALL (mobile browser: add to home screen for fullscreen) ───── */}
      {view === "install" && <InstallScreen onBack={() => setView("main")} />}

      {/* ── SETTINGS ──────────────────────────────────────────────────────── */}
      {view === "settings" && (
        <div className="relative z-10">
          <SettingsScreen
            onBack={() => setView("main")}
            onSfxMutedChange={(muted) =>
              ambientGameRef.current?.setSfxMuted(muted)
            }
            onPixelFilterChange={(on) =>
              ambientGameRef.current?.setPixelFilter(on)
            }
          />
        </div>
      )}

      {/* ── ABOUT ─────────────────────────────────────────────────────────── */}
      {view === "about" && (
        <div className="relative z-10">
          <AboutScreen onBack={() => setView("main")} />
        </div>
      )}
    </div>
  );
};

export default Menu;
