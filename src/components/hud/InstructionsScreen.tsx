import { useEffect, useRef, useState } from "react";
import {
  Play,
  Gamepad2,
  MousePointer2,
  Zap,
  ChevronsUp,
  Mic,
  Pause,
  Crosshair,
  EyeOff,
  ArrowUp,
  ArrowDown,
  ArrowLeft as ArrowLeftIcon,
  ArrowRight,
} from "lucide-react";
import { PlayerPreview } from "@/game/PlayerPreview";
import { ModelLibrary } from "@/game/ModelLibrary";
import type { GameMode } from "@/game/Game";
import {
  ScreenShell,
  PlayButton,
  ToggleRow,
  KeyHint,
  CREAM,
  INK_TEXT,
} from "./menu-primitives";
import { GamePanel, HexBadge, IconWell, HUD, INK } from "./primitives";

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

function ControlRow({ entry }: { entry: ControlEntry }) {
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-start gap-2.5">
        <span className="flex flex-shrink-0 flex-wrap items-center gap-1">
          {entry.keys.map((k) => (
            <KeyHint key={k} wide={k.length > 2}>
              {k}
            </KeyHint>
          ))}
        </span>
        <span className="flex items-center gap-1.5 pt-1.5 text-[13px] font-semibold leading-tight text-white">
          <span className="text-white/70">{entry.icon}</span>
          {entry.label}
        </span>
      </div>
      {entry.sub && (
        <p
          className="pl-1 text-[11px] leading-snug"
          style={{ color: `${CREAM}cc` }}
        >
          <span style={{ color: HUD.honey }}>↳ </span>
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
    <GamePanel accent={HUD.honey} className="p-3.5">
      <h3 className="hud-label mb-3 flex items-center gap-2 text-[11px]">
        <span
          className="h-2 w-2 rounded-full"
          style={{ background: HUD.honey, outline: `1.5px solid ${INK}` }}
        />
        {title}
      </h3>
      <ul className="flex flex-col gap-3">
        {entries.map((e) => (
          <ControlRow key={e.label} entry={e} />
        ))}
      </ul>
    </GamePanel>
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
    <div className="relative z-10 max-h-[88dvh] w-full overflow-y-auto px-1 py-2">
      <ScreenShell
        title="Como jogar"
        accent={mode === "local" ? HUD.terracotta : HUD.rose}
        onBack={onBack}
        maxWidth={760}
        className="mx-auto"
        contentClassName="flex flex-col gap-4"
        footer={
          <div className="flex flex-col gap-3">
            <ToggleRow
              on={dontShow}
              onToggle={() => setDontShow((v) => !v)}
              title="Não mostrar mais"
              desc="Pula esta tela nas próximas partidas"
              icon={EyeOff}
            />
            <PlayButton label="Vamos lá!" onClick={() => onStart(dontShow)} icon={Play} />
          </div>
        }
      >
        {/* Avatar stage + identity */}
        <div
          className="relative grid place-items-center overflow-hidden"
          style={{
            background: CREAM,
            border: `3px solid ${INK}`,
            borderRadius: 12,
            boxShadow: `0 0 0 1.5px ${HUD.honey}, 0 4px 0 ${INK}`,
            minHeight: 200,
          }}
        >
          {/* stage floor shadow (hard, no soft glow) */}
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3"
            style={{ background: `linear-gradient(to top, ${INK}1f, transparent)` }}
          />
          {/* preview host — DO NOT change wiring */}
          <div ref={previewHostRef} className="absolute inset-0" />

          {/* name tag */}
          <div
            className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2"
            style={{
              background: `${HUD.honey}f0`,
              border: `2px solid ${INK}`,
              borderRadius: 999,
              padding: "4px 14px",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.30), 0 3px 0 rgba(0,0,0,0.40)",
            }}
          >
            <span
              className="font-display text-[15px] font-bold leading-none text-white"
              style={{ textShadow: `1px 1px 0 ${INK}` }}
            >
              {displayName}
            </span>
          </div>

          {/* weapon chip */}
          <div
            className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5"
            style={{
              background: CREAM,
              border: `2px solid ${INK}`,
              borderRadius: 999,
              padding: "5px 12px",
              boxShadow: `0 3px 0 ${INK}`,
            }}
          >
            <Crosshair style={{ width: 14, height: 14, color: HUD.rose }} strokeWidth={3} />
            <span className="text-[12px] font-bold" style={{ color: INK_TEXT }}>
              Pistola
            </span>
          </div>

          {/* mode badge */}
          <div className="pointer-events-none absolute right-3 top-3">
            <HexBadge
              accent={mode === "local" ? HUD.terracotta : HUD.rose}
              size={34}
              icon={mode === "local" ? Gamepad2 : Crosshair}
            />
          </div>
        </div>

        {/* Controls — 2-column grid of dark control groups */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ControlGroup title="Movimento" entries={MOVEMENT} />
          <ControlGroup title="Combate" entries={COMBAT} />
          <ControlGroup title="Social & Sistema" entries={SOCIAL} />

          {/* Arrow-key cluster */}
          <GamePanel accent={HUD.honey} className="flex flex-col items-center justify-center gap-2.5 p-3.5">
            <h3 className="hud-label flex items-center gap-2 text-[11px]">
              <IconWell icon={Gamepad2} accent={HUD.honey} size={20} />
              Setas
            </h3>
            <div className="flex flex-col items-center gap-1.5">
              <KeyHint>
                <ArrowUp className="h-4 w-4" />
              </KeyHint>
              <div className="flex gap-1.5">
                <KeyHint>
                  <ArrowLeftIcon className="h-4 w-4" />
                </KeyHint>
                <KeyHint>
                  <ArrowDown className="h-4 w-4" />
                </KeyHint>
                <KeyHint>
                  <ArrowRight className="h-4 w-4" />
                </KeyHint>
              </div>
            </div>
            <p className="text-center text-[11px] font-semibold" style={{ color: `${CREAM}cc` }}>
              ou use as setas do teclado
            </p>
          </GamePanel>
        </div>
      </ScreenShell>
    </div>
  );
};
