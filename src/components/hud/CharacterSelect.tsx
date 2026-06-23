import { useEffect, useRef, useState } from "react";
import { Check, Play, Signal, User, Users } from "lucide-react";
import type { GameMode } from "@/game/Game";
import { CharacterStage } from "@/game/CharacterStage";
import { PlayerPreview } from "@/game/PlayerPreview";
import { ModelLibrary, ANIMAL_NAMES } from "@/game/ModelLibrary";
import {
  CharacterCard,
  CREAM,
  INK_TEXT,
  PlayButton,
  ScreenShell,
  TextField,
} from "./menu-primitives";
import { GamePanel, HUD, INK, IconWell, RibbonStrip } from "./primitives";

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
  const selectedName = DISPLAY_NAMES[selected] ?? selected;
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
      ? HUD.muted
      : ping < 90
        ? HUD.success
        : ping < 180
          ? HUD.honey
          : HUD.danger;

  return (
    <div className="absolute inset-0 flex flex-col">
      {/* Mobile-only notch spacer so the panel doesn't sit under the Island. */}
      <div className="md:hidden" style={{ height: "env(safe-area-inset-top, 0px)" }} />

      {/* FULL-BLEED 3D ROSTER — interactive voxel animals over the blurred scene.
          Stays mounted as the ambient backdrop; the cream panel sits on top. */}
      <div className="absolute inset-0 z-0" ref={stageHostRef}>
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 90% at 50% 52%, rgba(36,16,25,0) 42%, rgba(36,16,25,0.20) 100%)",
          }}
        />
      </div>

      {/* CREAM CONTROL PANEL — the Cocoa Cream menu surface, centered on top. */}
      <div
        className="relative z-10 flex min-h-0 flex-1 items-center justify-center overflow-y-auto"
        style={{
          padding: "1rem",
          paddingTop: "max(env(safe-area-inset-top, 0px) + 1rem, 1rem)",
          paddingBottom: "max(env(safe-area-inset-bottom, 0px) + 1rem, 1rem)",
          paddingLeft: "max(env(safe-area-inset-left, 0px) + 1rem, 1rem)",
          paddingRight: "max(env(safe-area-inset-right, 0px) + 1rem, 1rem)",
        }}
      >
        <ScreenShell
          title="Escolhe o teu lutador"
          accent={HUD.rose}
          onBack={onBack}
          maxWidth={720}
          footer={
            <PlayButton
              label="JOGAR"
              icon={Play}
              onClick={handleStart}
              disabled={!canStart}
            />
          }
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-stretch">
            {/* LEFT — name + roster grid. */}
            <div className="flex min-w-0 flex-1 flex-col gap-3.5">
              {/* Live / ping ribbons. */}
              <div className="flex items-center gap-2">
                <RibbonStrip accent={HUD.success} icon={Users}>
                  <span className="hud-num leading-none" style={{ fontSize: 14 }}>
                    {online ?? "—"}
                  </span>
                  <span
                    className="text-[11px] font-bold uppercase tracking-wide"
                    style={{ color: "#fff", textShadow: `1px 1px 0 ${INK}` }}
                  >
                    ao vivo
                  </span>
                </RibbonStrip>
                <RibbonStrip accent={pingColor} icon={Signal}>
                  <span className="hud-num leading-none" style={{ fontSize: 14 }}>
                    {ping != null ? `${ping}ms` : "—"}
                  </span>
                </RibbonStrip>
              </div>

              {/* Name field. */}
              <TextField
                value={name}
                onChange={setName}
                onKeyDown={onNameKeyDown}
                placeholder="Escreve o teu nome…"
                maxLength={NAME_MAX}
                icon={User}
              />

              {/* Roster grid. */}
              <div
                className="grid gap-2.5"
                style={{ gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))" }}
              >
                {ANIMAL_NAMES.map((animal) => {
                  const isSel = animal === selected;
                  return (
                    <CharacterCard
                      key={animal}
                      selected={isSel}
                      onClick={() => setSelected(animal)}
                      onHover={() => setHovered(animal)}
                      name={DISPLAY_NAMES[animal] ?? animal}
                      size={84}
                      style={{ width: "100%" }}
                    >
                      <span
                        className="font-display text-[22px] font-bold leading-none"
                        style={{ color: INK_TEXT }}
                      >
                        {(DISPLAY_NAMES[animal] ?? animal).charAt(0)}
                      </span>
                      {isSel && (
                        <span
                          className="absolute right-1 top-1 grid place-items-center"
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: "50%",
                            background: HUD.rose,
                            border: `2px solid ${INK}`,
                          }}
                        >
                          <Check style={{ width: 12, height: 12, color: "#fff" }} strokeWidth={3.5} />
                        </span>
                      )}
                    </CharacterCard>
                  );
                })}
              </div>
            </div>

            {/* RIGHT — live in-game preview (desktop) in a dark cocoa-glass panel. */}
            <div
              className="hidden md:flex md:w-[260px] md:shrink-0 md:flex-col md:gap-2.5"
              style={{ minHeight: 340 }}
            >
              <RibbonStrip accent={HUD.rose} className="justify-center">
                <span
                  key={labelAnimal}
                  className="font-display text-[15px] font-bold leading-none"
                  style={{ color: "#fff", textShadow: `1px 1px 0 ${INK}` }}
                >
                  {displayName}
                </span>
              </RibbonStrip>

              <GamePanel accent={HUD.rose} radius={12} className="min-h-0 flex-1">
                <div ref={previewHostRef} className="absolute inset-0" />
                {/* Footer tag inside the dark stage. */}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-2 p-2.5">
                  <IconWell icon={User} accent={HUD.honey} size={24} />
                  <span
                    className="hud-label text-[10px]"
                    style={{ color: CREAM, textShadow: `1px 1px 0 ${INK}` }}
                  >
                    {selectedName}
                  </span>
                </div>
              </GamePanel>
            </div>
          </div>
        </ScreenShell>
      </div>
    </div>
  );
};
