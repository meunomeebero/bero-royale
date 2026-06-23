import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Play, Signal, User, Users } from "lucide-react";
import type { GameMode } from "@/game/Game";
import { CharacterStage } from "@/game/CharacterStage";
import { PlayerPreview } from "@/game/PlayerPreview";
import { ModelLibrary, ANIMAL_NAMES } from "@/game/ModelLibrary";
import { cn } from "@/lib/utils";

const DISPLAY_NAMES: Record<string, string> = {
  bear: "Urso",
  bunny: "Coelho",
  cat: "Gato",
  chicken: "Galinha",
  crocodile: "Crocodilo",
  dog: "Cão",
  fox: "Raposa",
  frog: "Sapo",
  mouse: "Rato",
  panda: "Panda",
  piglet: "Porquinho",
};

const NAME_KEY = "voxelCube.username";
const NAME_MAX = 16;

interface CharacterSelectProps {
  mode: GameMode;
  onBack: () => void;
  onStart: (name: string, animal: string) => void;
}

export const CharacterSelect = ({ mode, onBack, onStart }: CharacterSelectProps) => {
  const stageHostRef = useRef<HTMLDivElement>(null);
  const previewHostRef = useRef<HTMLDivElement>(null);
  const previewObjRef = useRef<PlayerPreview | null>(null);
  const [selected, setSelected] = useState<string>(ANIMAL_NAMES[0]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [name, setName] = useState<string>(() => localStorage.getItem(NAME_KEY) ?? "");
  const [pressed, setPressed] = useState(false);
  const [online, setOnline] = useState<number | null>(null);
  const [ping, setPing] = useState<number | null>(null);
  const [isDesktop, setIsDesktop] = useState<boolean>(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches,
  );

  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const nameRef = useRef(name);
  nameRef.current = name;

  // Mount the 3D stage once.
  useEffect(() => {
    let stage: CharacterStage | null = null;
    let cancelled = false;
    void ModelLibrary.preload().then(() => {
      if (cancelled || !stageHostRef.current) return;
      stage = new CharacterStage(stageHostRef.current, [...ANIMAL_NAMES]);
      stage.onSelect = (animal) => setSelected(animal);
      stage.onHover = (animal) => setHovered(animal);
      stage.setSelected(selectedRef.current);
      stage.start();
    });
    return () => {
      cancelled = true;
      stage?.dispose();
    };
  }, []);

  // Esc → back
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  // Poll /api/online for the live player count, timing the round-trip as ping.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const t0 = performance.now();
      try {
        const r = await fetch("/api/online", { cache: "no-store" });
        const dt = Math.round(performance.now() - t0);
        if (!alive || !r.ok) return;
        const j = (await r.json()) as { count?: number };
        setOnline(typeof j.count === "number" ? j.count : null);
        setPing(dt);
      } catch {
        /* backend unreachable (e.g. local dev w/o server) — leave as "—" */
      }
    };
    void tick();
    const id = window.setInterval(tick, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Track desktop vs mobile for the in-panel 3D preview.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const on = () => setIsDesktop(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // Desktop only: mount the live "how you'll look in-game" preview (model + gun
  // + name tag + idle). Rebuilt if we cross the mobile/desktop breakpoint.
  useEffect(() => {
    if (!isDesktop) return;
    let preview: PlayerPreview | null = null;
    let cancelled = false;
    void ModelLibrary.preload().then(() => {
      if (cancelled || !previewHostRef.current) return;
      preview = new PlayerPreview(
        previewHostRef.current,
        selectedRef.current,
        nameRef.current.trim() || "Você",
      );
      preview.start();
      previewObjRef.current = preview;
    });
    return () => {
      cancelled = true;
      preview?.dispose();
      previewObjRef.current = null;
    };
  }, [isDesktop]);

  useEffect(() => {
    previewObjRef.current?.setAnimal(selected);
  }, [selected]);

  useEffect(() => {
    previewObjRef.current?.setName(name.trim() || "Você");
  }, [name]);

  const labelAnimal = hovered ?? selected;
  const displayName = DISPLAY_NAMES[labelAnimal] ?? labelAnimal;
  const trimmed = name.trim();
  const canStart = trimmed.length > 0;

  const handleStart = () => {
    if (!canStart) return;
    onStart(trimmed, selected);
  };

  const onNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && canStart) handleStart();
  };

  const pingColor =
    ping == null
      ? "text-game-muted"
      : ping < 90
        ? "text-game-success"
        : ping < 180
          ? "text-game-accent-2"
          : "text-game-danger";

  return (
    <div className="absolute inset-0 flex flex-col md:flex-row">
      {/* Mobile-only notch spacer so the roster doesn't sit under the Island. */}
      <div className="md:hidden" style={{ height: "env(safe-area-inset-top, 0px)" }} />

      {/* LEFT CONTROL PANEL (bottom on mobile, left sidebar on desktop). */}
      <aside className="relative z-20 order-2 bg-game-panel/95 paper-grain cozy-shadow md:order-1 md:h-full md:w-[340px] lg:w-[380px]">
        <div className="h-1.5 w-full bg-gradient-to-r from-game-accent-2 via-game-accent to-game-accent-3 md:hidden" />
        <div
          className="flex h-full flex-col gap-4 p-4 sm:p-5"
          style={{
            paddingTop: "1rem",
            paddingBottom: "max(env(safe-area-inset-bottom, 0px) + 1rem, 1rem)",
            paddingLeft: "max(env(safe-area-inset-left, 0px) + 1rem, 1rem)",
            paddingRight: "max(env(safe-area-inset-right, 0px) + 1rem, 1rem)",
          }}
        >
          {/* Header: back + live/ping stats */}
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={onBack}
              aria-label="Voltar"
              className="group flex shrink-0 items-center gap-2 rounded-2xl border-2 border-game-border/70 bg-game-bg/60 px-3 py-2.5 font-sans text-sm font-bold text-game-ink key-shadow transition-all hover:bg-game-bg active:translate-y-0.5"
            >
              <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
              <span className="hidden sm:inline">Voltar</span>
            </button>

            <div className="flex items-center gap-1.5">
              <span className="flex items-center gap-1.5 rounded-full border-2 border-game-border/60 bg-game-bg/60 px-2.5 py-1 font-sans text-xs font-bold text-game-ink">
                <Users className="h-3.5 w-3.5 text-game-success" />
                {online ?? "—"}
                <span className="text-game-muted">ao vivo</span>
              </span>
              <span
                className={cn(
                  "flex items-center gap-1 rounded-full border-2 border-game-border/60 bg-game-bg/60 px-2.5 py-1 font-sans text-xs font-bold",
                  pingColor,
                )}
              >
                <Signal className="h-3.5 w-3.5" />
                {ping != null ? `${ping}ms` : "—"}
              </span>
            </div>
          </div>

          {/* Selected fighter — the hero of the panel */}
          <div className="flex flex-col items-start">
            <span
              key={labelAnimal}
              className="font-logo text-4xl leading-none text-game-ink animate-nudge sm:text-5xl"
            >
              {displayName}
            </span>
            <span
              className="mt-1.5 block h-1.5 w-28 rounded-full"
              style={{
                background:
                  "linear-gradient(to right, #E0A340 0%, #D14E6E 65%, rgba(209,78,110,0) 100%)",
              }}
            />
          </div>

          {/* Desktop: live in-game preview (model + name tag + gun + idle).
              Fills the space between the name and the footer. */}
          <div
            ref={previewHostRef}
            className="hidden min-h-0 md:block md:flex-1"
          />

          {/* Footer: name + start (row on mobile, stacked on desktop) */}
          <div className="flex items-end gap-3 md:flex-col md:items-stretch">
            <label className="flex min-w-0 flex-1 flex-col md:w-full md:flex-none">
              <span className="mb-1 flex items-center gap-1.5 font-sans text-[10px] font-bold uppercase tracking-wider text-game-muted sm:text-xs">
                <User className="h-3.5 w-3.5" />
                Seu nome
              </span>
              <input
                type="text"
                value={name}
                maxLength={NAME_MAX}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={onNameKeyDown}
                placeholder="Escreve o teu nome…"
                className="w-full rounded-xl border-2 border-game-border/80 bg-game-bg/70 px-3 py-2.5 font-sans text-base font-semibold text-game-ink placeholder:font-normal placeholder:text-game-muted/60 focus:outline-none sm:px-4 sm:py-3"
              />
            </label>

            <button
              onClick={handleStart}
              onPointerDown={() => setPressed(true)}
              onPointerUp={() => setPressed(false)}
              onPointerLeave={() => setPressed(false)}
              disabled={!canStart}
              className={cn(
                "group flex shrink-0 items-center justify-center gap-2 rounded-2xl border-2 px-5 py-3 font-logo text-lg tracking-wide text-white transition-all select-none md:w-full md:py-4 md:text-2xl",
                canStart
                  ? "cursor-pointer border-game-accent/70 bg-game-accent hover:brightness-[1.04] active:translate-y-[3px]"
                  : "cursor-not-allowed border-game-muted/70 bg-game-muted/70",
              )}
              style={{
                boxShadow: canStart
                  ? `0 ${pressed ? 1 : 4}px 0 ${pressed ? "#8a3550" : "#9a3a54"}, 0 8px 18px rgba(36,16,25,0.35)`
                  : "0 4px 0 rgba(0,0,0,0.15)",
              }}
            >
              <Play className="h-5 w-5 fill-white sm:h-6 sm:w-6" />
              <span>Vamos lá!</span>
            </button>
          </div>
        </div>
      </aside>

      {/* RIGHT — 3D ROSTER over the blurred game scene. */}
      <div className="relative z-10 order-1 min-h-0 min-w-0 flex-1 md:order-2" ref={stageHostRef}>
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 90% at 50% 52%, rgba(36,16,25,0) 42%, rgba(36,16,25,0.20) 100%)",
          }}
        />
      </div>
    </div>
  );
};
