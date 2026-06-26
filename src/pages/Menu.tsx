import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, Info, Settings, User, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
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
import { MenuButton } from "@/components/hud/menu-primitives";
import { HexBadge, HUD, INK } from "@/components/hud/primitives";

const USERNAME_KEY = "voxelCube.username";
const MODE_KEY = "voxelCube.mode";
const SKIP_INTRO_KEY = "cozykiller:skipIntro";

type MenuView = "main" | "select" | "instructions" | "install" | "settings" | "about";

interface MenuItem {
  key: string;
  label: string;
  icon: LucideIcon;
  primary?: boolean;
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
    { key: "single", label: "Single player", icon: User, onSelect: () => openSelect("local") },
    { key: "multi", label: "Multiplayer", icon: Users, primary: true, onSelect: () => openSelect("multiplayer") },
    { key: "settings", label: "Configurações", icon: Settings, onSelect: () => setView("settings") },
    { key: "about", label: "Sobre", icon: Info, onSelect: () => setView("about") },
    // Surface the "add to home screen" guide directly when play would be gated
    // behind it (mobile browser tab) — keeps the same install view/flow.
    ...(needsInstall
      ? [{ key: "install", label: "Instalar app", icon: Download, onSelect: () => setView("install") } as MenuItem]
      : []),
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
        <div className="relative z-10 flex w-full max-w-[340px] flex-col items-center gap-7 md:items-start animate-rise">
          {/* Mobile-only soft halo so the centered column reads over the bright
              scene (desktop uses the left-side scrim instead). */}
          <div className="pointer-events-none absolute -inset-x-10 -inset-y-12 -z-10 rounded-[44px] bg-[radial-gradient(ellipse_at_center,rgba(24,10,16,0.6),rgba(24,10,16,0.22)_54%,transparent_78%)] blur-xl md:hidden" />

          {/* Logo — Cocoa Cream "3D sticker" wordmark: white extra-bold ALL CAPS
              with an ink outline + honey under-shadow, a rose HexBadge perched
              top-right, and a Fraunces-italic cream subtitle. */}
          <header className="relative select-none text-center md:text-left">
            {/* Rose emblem perched near the wordmark. */}
            <HexBadge
              accent={HUD.rose}
              size={38}
              value="!"
              className="absolute -right-3 -top-4 md:-right-4"
            />
            <h1 className="font-logo uppercase leading-[0.82] tracking-[-0.01em]">
              <span
                className="block text-[clamp(2.9rem,8.6vw,5rem)] font-extrabold"
                style={{
                  color: "#fff",
                  WebkitTextStroke: `4px ${INK}`,
                  paintOrder: "stroke fill",
                  textShadow: `0 4px 0 ${HUD.honey}, 0 9px 0 ${INK}`,
                }}
              >
                Cozy
              </span>
              <span
                className="mt-1.5 block text-[clamp(2.9rem,8.6vw,5rem)] font-extrabold"
                style={{
                  color: "#fff",
                  WebkitTextStroke: `4px ${INK}`,
                  paintOrder: "stroke fill",
                  textShadow: `0 4px 0 ${HUD.rose}, 0 9px 0 ${INK}`,
                }}
              >
                Killer
              </span>
            </h1>
            <p
              className="mt-3 font-display text-[15px] italic"
              style={{ color: "#FBEFD8", textShadow: "0 1px 2px rgba(18,7,12,0.85)" }}
            >
              Fofo por fora, feroz por dentro.
            </p>
          </header>

          {/* Menu stack — chunky Cocoa Cream game tiles. */}
          <nav className="flex w-full flex-col gap-2.5">
            {items.map(({ key, label, icon, primary, onSelect }) => (
              <MenuButton
                key={key}
                label={label}
                icon={icon}
                primary={primary}
                onClick={onSelect}
              />
            ))}
          </nav>

          {/* Footer — small uppercase version tag. */}
          <footer className="w-full text-center md:text-left">
            <span
              className="hud-label text-[11px]"
              style={{ color: "rgba(251,239,216,0.78)", textShadow: "0 1px 2px rgba(18,7,12,0.85)" }}
            >
              Demo · v0.0
            </span>
          </footer>
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
            onVhsLevelChange={(level) =>
              ambientGameRef.current?.setVhsLevel(level)
            }
            onAimSensitivityChange={(s) =>
              ambientGameRef.current?.setAimSensitivity(s)
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
