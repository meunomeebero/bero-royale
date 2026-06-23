import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Play,
  Gamepad2,
  MousePointer2,
  Zap,
  ChevronsUp,
  Mic,
  Pause,
  Crosshair,
  Keyboard,
  ArrowUp,
  ArrowDown,
  ArrowLeft as ArrowLeftIcon,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PlayerPreview } from "@/game/PlayerPreview";
import { ModelLibrary } from "@/game/ModelLibrary";
import type { GameMode } from "@/game/Game";

interface InstructionsScreenProps {
  mode: GameMode;
  name: string;
  animal: string;
  onBack: () => void;
  onStart: (dontShowAgain: boolean) => void;
}

interface ControlEntry {
  keys: string[];
  label: string;
  icon: React.ReactNode;
  sub?: string;
}

const MOVEMENT: ControlEntry[] = [
  {
    keys: ["W", "A", "S", "D"],
    label: "ou setas — mover",
    icon: <Gamepad2 className="h-4 w-4" />,
  },
  {
    keys: ["Espaço"],
    label: "pular",
    icon: <ChevronsUp className="h-4 w-4" />,
  },
  {
    keys: ["Shift"],
    label: "dash (3 cargas recarregáveis)",
    icon: <Zap className="h-4 w-4" />,
  },
];

const COMBAT: ControlEntry[] = [
  {
    keys: ["Clique"],
    label: "segurar o clique — atirar sem parar",
    icon: <MousePointer2 className="h-4 w-4" />,
  },
  {
    keys: ["Tab"],
    label: "trocar entre tiro constante e tiro concentrado",
    icon: <Crosshair className="h-4 w-4" />,
    sub: "Tiro concentrado — segura 5s e solta quando o personagem brilhar (fica pronto)",
  },
];

const SOCIAL: ControlEntry[] = [
  {
    keys: ["G"],
    label: "falar (só enquanto segurar)",
    icon: <Mic className="h-4 w-4" />,
  },
  {
    keys: ["Esc"],
    label: "pausar",
    icon: <Pause className="h-4 w-4" />,
  },
];

function KeyCap({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-md border-2 border-game-border bg-game-bg px-2 py-1 font-logo text-sm font-bold leading-none text-game-ink key-shadow",
        wide ? "min-w-[3.5rem]" : "min-w-[2rem]",
      )}
    >
      {children}
    </span>
  );
}

function ControlRow({ entry }: { entry: ControlEntry }) {
  return (
    <li className="flex flex-col gap-1.5 rounded-xl border border-game-border/60 bg-game-panel/60 px-3.5 py-3 transition-colors hover:border-game-border">
      <div className="flex items-center gap-3">
        <span className="flex flex-shrink-0 items-center gap-1">
          {entry.keys.map((k) => (
            <KeyCap key={k} wide={k.length > 2}>
              {k}
            </KeyCap>
          ))}
        </span>
        <span className="flex items-center gap-1.5 font-sans text-[0.95rem] leading-tight text-game-ink">
          <span className="text-game-muted">{entry.icon}</span>
          {entry.label}
        </span>
      </div>
      {entry.sub && (
        <p className="pl-1 font-sans text-xs leading-snug text-game-muted">
          <span className="font-display italic text-game-accent-3">↳ </span>
          {entry.sub}
        </p>
      )}
    </li>
  );
}

function ControlGroup({
  title,
  entries,
}: {
  title: string;
  entries: ControlEntry[];
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center gap-2 pl-1 font-logo text-xs font-bold uppercase tracking-[0.18em] text-game-accent-3">
        <span className="h-1.5 w-1.5 rounded-full bg-game-accent" />
        {title}
      </h3>
      <ul className="flex flex-col gap-2">
        {entries.map((e) => (
          <ControlRow key={e.label} entry={e} />
        ))}
      </ul>
    </section>
  );
}

export const InstructionsScreen = ({
  mode,
  name,
  animal,
  onBack,
  onStart,
}: InstructionsScreenProps) => {
  const previewHostRef = useRef<HTMLDivElement>(null);
  const [dontShow, setDontShow] = useState(false);

  useEffect(() => {
    let preview: PlayerPreview | null = null;
    let cancelled = false;
    void ModelLibrary.preload().then(() => {
      if (cancelled || !previewHostRef.current) return;
      preview = new PlayerPreview(previewHostRef.current, animal, name.trim() || "Você");
      preview.start();
    });
    return () => {
      cancelled = true;
      preview?.dispose();
    };
  }, [animal, name]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  const displayName = name.trim() || "Você";

  return (
    <div
      className="relative flex min-h-[100dvh] w-full flex-col overflow-hidden bg-game-bg paper-grain"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      {/* ambient warm glows */}
      <div className="pointer-events-none absolute -left-32 top-10 h-96 w-96 rounded-full bg-game-accent/15 blur-[120px]" />
      <div className="pointer-events-none absolute -right-24 bottom-0 h-96 w-96 rounded-full bg-game-accent-2/20 blur-[120px]" />
      <div className="pointer-events-none absolute left-1/2 top-1/3 h-72 w-72 -translate-x-1/2 rounded-full bg-game-accent-3/10 blur-[100px]" />

      {/* Top bar */}
      <header className="relative z-10 flex items-center justify-between px-4 py-4 sm:px-8">
        <button
          onClick={onBack}
          className="group flex items-center gap-2 rounded-xl border-2 border-game-border bg-game-panel px-3.5 py-2 font-logo text-sm font-bold text-game-ink key-shadow transition-all active:translate-y-0.5 active:key-shadow-none"
        >
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          Voltar
        </button>

        <div className="flex items-center gap-2">
          <span
            className={cn(
              "flex items-center gap-1.5 rounded-full border-2 px-3 py-1 font-logo text-xs font-bold uppercase tracking-wider",
              mode === "local"
                ? "border-game-accent-2/50 bg-game-accent-2/15 text-game-accent-3"
                : "border-game-accent/50 bg-game-accent/15 text-game-accent",
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                mode === "local" ? "bg-game-accent-2" : "bg-game-accent",
              )}
            />
            {mode === "local" ? "Single player" : "Multiplayer"}
          </span>
        </div>
      </header>

      {/* Title */}
      <div className="relative z-10 px-4 pb-2 sm:px-8">
        <p className="font-display text-sm italic text-game-muted">Antes de começar…</p>
        <h1 className="font-logo text-4xl font-extrabold leading-none text-game-ink sm:text-5xl">
          Como <span className="text-game-accent">jogar</span>
        </h1>
      </div>

      {/* Main two-column area */}
      <main className="relative z-10 flex min-h-0 flex-1 flex-col gap-5 px-4 pb-4 sm:px-8 lg:flex-row lg:gap-8">
        {/* LEFT: avatar */}
        <section className="flex min-h-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border-2 border-game-border bg-gradient-to-b from-game-panel to-game-bg cozy-shadow">
            {/* stage floor */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-game-accent-3/10 to-transparent" />
            <div className="pointer-events-none absolute bottom-6 left-1/2 h-10 w-48 -translate-x-1/2 rounded-[50%] bg-game-ink/20 blur-xl" />

            {/* preview host */}
            <div ref={previewHostRef} className="relative min-h-0 flex-1" />

            {/* name tag overlay */}
            <div className="pointer-events-none absolute left-1/2 top-5 flex -translate-x-1/2 flex-col items-center gap-1">
              <span className="rounded-full border-2 border-game-border bg-game-bg/90 px-4 py-1 font-logo text-lg font-extrabold text-game-ink cozy-shadow backdrop-blur-sm">
                {displayName}
              </span>
            </div>

            {/* weapon + mode chip */}
            <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2">
              <span className="flex items-center gap-1.5 rounded-full border-2 border-game-border bg-game-bg/95 px-3 py-1.5 font-logo text-xs font-bold text-game-ink key-shadow backdrop-blur-sm">
                <Crosshair className="h-3.5 w-3.5 text-game-accent" />
                Pistola
              </span>
            </div>

            {/* corner deco */}
            <div className="pointer-events-none absolute right-4 top-4 flex flex-col items-end gap-1 opacity-60">
              <span className="font-display text-[0.65rem] italic text-game-muted">seu bichinho</span>
              <span className="font-logo text-xs font-bold text-game-accent-3">PRONTO PRA BATALHA</span>
            </div>
          </div>
        </section>

        {/* RIGHT: controls */}
        <section className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto rounded-3xl border-2 border-game-border bg-game-panel/70 p-4 cozy-shadow sm:p-6 lg:max-w-[34rem]">
          <div className="flex items-center gap-2 border-b border-game-border/50 pb-3">
            <Keyboard className="h-5 w-5 text-game-accent" />
            <h2 className="font-logo text-lg font-bold text-game-ink">Controles</h2>
            <span className="ml-auto font-display text-xs italic text-game-muted">
              decorou? então bora
            </span>
          </div>

          <ControlGroup title="Movimento" entries={MOVEMENT} />
          <ControlGroup title="Combate" entries={COMBAT} />
          <ControlGroup title="Social & Sistema" entries={SOCIAL} />

          {/* arrow keys mini-diagram */}
          <div className="mt-1 flex items-center justify-center gap-2 rounded-xl border border-dashed border-game-border/70 bg-game-bg/40 px-3 py-3">
            <div className="flex flex-col items-center gap-1">
              <KeyCap>
                <ArrowUp className="h-3.5 w-3.5" />
              </KeyCap>
              <div className="flex gap-1">
                <KeyCap>
                  <ArrowLeftIcon className="h-3.5 w-3.5" />
                </KeyCap>
                <KeyCap>
                  <ArrowDown className="h-3.5 w-3.5" />
                </KeyCap>
                <KeyCap>
                  <ArrowRight className="h-3.5 w-3.5" />
                </KeyCap>
              </div>
            </div>
            <span className="font-display text-sm italic text-game-muted">
              ou use as setas do teclado
            </span>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer
        className="relative z-10 flex flex-col items-center gap-3 border-t-2 border-game-border/60 bg-game-panel/80 px-4 py-4 backdrop-blur-sm sm:flex-row sm:justify-between sm:px-8"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 1rem)" }}
      >
        <label className="flex cursor-pointer select-none items-center gap-2.5 group">
          <span className="relative flex h-5 w-5 items-center justify-center">
            <input
              type="checkbox"
              checked={dontShow}
              onChange={(e) => setDontShow(e.target.checked)}
              className="peer absolute h-5 w-5 cursor-pointer appearance-none rounded-md border-2 border-game-border bg-game-bg checked:border-game-accent checked:bg-game-accent key-shadow"
            />
            <svg
              className="pointer-events-none relative h-3 w-3 text-game-bg opacity-0 peer-checked:opacity-100"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 8.5l3.5 3.5L13 4.5" />
            </svg>
          </span>
          <span className="font-sans text-sm font-medium text-game-ink">
            Não mostrar mais
          </span>
        </label>

        <button
          onClick={() => onStart(dontShow)}
          className="group relative flex w-full items-center justify-center gap-2.5 overflow-hidden rounded-2xl border-2 border-game-accent bg-game-accent px-8 py-3.5 font-logo text-xl font-extrabold text-game-bg cozy-shadow transition-all hover:brightness-110 active:translate-y-0.5 active:cozy-shadow-none sm:w-auto"
        >
          <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
          <Play className="h-5 w-5 fill-current" />
          Vamos lá!
        </button>
      </footer>
    </div>
  );
};
