import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Film,
  Gamepad2,
  Mic,
  MousePointer2,
  Music2,
  Radio,
  Volume2,
} from "lucide-react";
import {
  AIM_SENSITIVITY_DEFAULT,
  AIM_SENSITIVITY_KEY,
  AIM_SENSITIVITY_MAX,
  AIM_SENSITIVITY_MIN,
  PIXEL_FILTER_KEY,
  SFX_MUTED_KEY,
  VHS_LEVEL_DEFAULT,
  VHS_LEVEL_KEY,
  VOICE_MUTED_KEY,
} from "@/game/consts";
import { cn } from "@/lib/utils";
import { HUD, INK, IconWell, RibbonStrip } from "./primitives";
import {
  CREAM,
  INK_TEXT,
  ScreenShell,
  SelectField,
  SliderRow,
  ToggleRow,
} from "./menu-primitives";

/**
 * Full-screen Settings view for the menu (rendered over the blurred ambient
 * scene, same "Cocoa Cream" cream-panel system as the rest of the menu).
 *
 * Two audio CHANNELS the player can independently silence:
 *   - "Efeitos sonoros"  → all procedural game SFX (footsteps, shots, death).
 *   - "Voz das partidas" → incoming proximity voice (hearing teammates).
 * Muting one never touches the other — so you can kill the gunfire and still
 * talk to friends, or vice-versa.
 *
 * Device selection (microphone + speaker) persists to the SAME localStorage
 * keys VoiceChat reads, so the choice applies the moment a multiplayer match
 * boots. Output routing (setSinkId) is feature-detected.
 */

/** localStorage keys — MUST match those in src/game/net/VoiceChat.ts. */
const LS_MIC = "voxelcube:voice:mic";
const LS_SPK = "voxelcube:voice:spk";

const TEST_TONE_HZ = 440;
const TEST_TONE_MS = 350;

interface SettingsScreenProps {
  onBack: () => void;
  /** Apply the SFX mute live to the menu's ambient scene (persists too). */
  onSfxMutedChange?: (muted: boolean) => void;
  /** Apply the "modo desenho" filter live to the menu's ambient scene. */
  onPixelFilterChange?: (on: boolean) => void;
  /** Apply the VHS/retro filter intensity (0..1) live to the ambient scene. */
  onVhsLevelChange?: (level: number) => void;
  /** Apply the cursor/aim sensitivity multiplier (persists; next match). */
  onAimSensitivityChange?: (sensitivity: number) => void;
}

function sinkIdSupported(): boolean {
  return (
    typeof (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId ===
    "function"
  );
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* private mode — ignore */
  }
}

function readNumber(key: string, fallback: number, min: number, max: number) {
  try {
    const raw = parseFloat(localStorage.getItem(key) ?? "");
    if (Number.isFinite(raw)) return Math.max(min, Math.min(max, raw));
  } catch {
    /* private mode — ignore */
  }
  return fallback;
}

function writeNumber(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* private mode — ignore */
  }
}

export const SettingsScreen = ({
  onBack,
  onSfxMutedChange,
  onPixelFilterChange,
  onVhsLevelChange,
  onAimSensitivityChange,
}: SettingsScreenProps) => {
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedInput, setSelectedInput] = useState<string>("");
  const [selectedOutput, setSelectedOutput] = useState<string>("");
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  // ON = audible. Stored inverted (the keys hold the MUTED flag).
  const [sfxOn, setSfxOn] = useState<boolean>(() => !readFlag(SFX_MUTED_KEY));
  const [voiceOn, setVoiceOn] = useState<boolean>(
    () => !readFlag(VOICE_MUTED_KEY),
  );
  // "Modo desenho" filter — stored as ENABLED (absent => ON by default).
  const [pixelOn, setPixelOn] = useState<boolean>(() => {
    try {
      return localStorage.getItem(PIXEL_FILTER_KEY) !== "0";
    } catch {
      return true;
    }
  });
  // VHS/retro filter intensity (0..1) + cursor sensitivity multiplier.
  const [vhsLevel, setVhsLevel] = useState<number>(() =>
    readNumber(VHS_LEVEL_KEY, VHS_LEVEL_DEFAULT, 0, 1),
  );
  const [sensitivity, setSensitivity] = useState<number>(() =>
    readNumber(
      AIM_SENSITIVITY_KEY,
      AIM_SENSITIVITY_DEFAULT,
      AIM_SENSITIVITY_MIN,
      AIM_SENSITIVITY_MAX,
    ),
  );

  const canRouteOutput = sinkIdSupported();
  const testAudioRef = useRef<HTMLAudioElement | null>(null);

  const refreshDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setInputs(devices.filter((d) => d.kind === "audioinput"));
      setOutputs(devices.filter((d) => d.kind === "audiooutput"));
    } catch {
      setPermissionError("Não foi possível listar os dispositivos de áudio.");
    }
  }, []);

  // Request mic once to unlock device labels, then enumerate + watch for
  // hot-plugged headsets.
  useEffect(() => {
    let cancelled = false;
    let permissionStream: MediaStream | null = null;

    const init = async () => {
      setSelectedInput(localStorage.getItem(LS_MIC) ?? "");
      setSelectedOutput(localStorage.getItem(LS_SPK) ?? "");
      try {
        permissionStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        setPermissionError(null);
      } catch {
        setPermissionError(
          "Microfone bloqueado. Dá para escolher a saída de som à mesma.",
        );
      }
      permissionStream?.getTracks().forEach((t) => t.stop());
      permissionStream = null;
      if (cancelled) return;
      await refreshDevices();
    };

    void init();
    const onDeviceChange = () => void refreshDevices();
    navigator.mediaDevices.addEventListener("devicechange", onDeviceChange);
    return () => {
      cancelled = true;
      permissionStream?.getTracks().forEach((t) => t.stop());
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        onDeviceChange,
      );
    };
  }, [refreshDevices]);

  // Esc → back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  const handleInputChange = (deviceId: string) => {
    setSelectedInput(deviceId);
    try {
      localStorage.setItem(LS_MIC, deviceId);
    } catch {
      /* ignore */
    }
  };

  const handleOutputChange = (deviceId: string) => {
    setSelectedOutput(deviceId);
    try {
      localStorage.setItem(LS_SPK, deviceId);
    } catch {
      /* ignore */
    }
  };

  const toggleSfx = () => {
    const next = !sfxOn;
    setSfxOn(next);
    writeFlag(SFX_MUTED_KEY, !next); // stored value is the MUTED flag
    onSfxMutedChange?.(!next);
  };

  const toggleVoice = () => {
    const next = !voiceOn;
    setVoiceOn(next);
    writeFlag(VOICE_MUTED_KEY, !next);
  };

  const togglePixel = () => {
    const next = !pixelOn;
    setPixelOn(next);
    writeFlag(PIXEL_FILTER_KEY, next); // stored value is ENABLED (not inverted)
    onPixelFilterChange?.(next);
  };

  const handleVhsLevel = (level: number) => {
    setVhsLevel(level);
    writeNumber(VHS_LEVEL_KEY, level);
    onVhsLevelChange?.(level);
  };

  const handleSensitivity = (s: number) => {
    setSensitivity(s);
    writeNumber(AIM_SENSITIVITY_KEY, s);
    onAimSensitivityChange?.(s);
  };

  const handleTestSound = async () => {
    setTesting(true);
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const dest = ctx.createMediaStreamDestination();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = TEST_TONE_HZ;
      gain.gain.value = 0.0001;
      osc.connect(gain).connect(dest);

      const audio = testAudioRef.current ?? new Audio();
      testAudioRef.current = audio;
      audio.srcObject = dest.stream;
      const el = audio as HTMLAudioElement & {
        setSinkId?: (id: string) => Promise<void>;
      };
      if (selectedOutput && typeof el.setSinkId === "function") {
        try {
          await el.setSinkId(selectedOutput);
        } catch {
          /* default output */
        }
      }
      osc.start();
      const now = ctx.currentTime;
      gain.gain.linearRampToValueAtTime(0.2, now + 0.02);
      gain.gain.setValueAtTime(0.2, now + TEST_TONE_MS / 1000 - 0.05);
      gain.gain.linearRampToValueAtTime(0.0001, now + TEST_TONE_MS / 1000);
      await audio.play().catch(() => {});
      await new Promise((r) => setTimeout(r, TEST_TONE_MS));
      osc.stop();
      audio.pause();
      audio.srcObject = null;
      void ctx.close();
    } finally {
      setTesting(false);
    }
  };

  const inputOptions = [
    { value: "", label: "Padrão do sistema" },
    ...inputs.map((d) => ({
      value: d.deviceId,
      label: d.label || `Microfone ${d.deviceId.slice(0, 6)}`,
    })),
  ];

  const outputOptions = [
    { value: "", label: "Padrão do sistema" },
    ...outputs.map((d) => ({
      value: d.deviceId,
      label: d.label || `Alto-falante ${d.deviceId.slice(0, 6)}`,
    })),
  ];

  return (
    <div className="max-h-[88dvh] w-full max-w-[460px] overflow-y-auto">
      <ScreenShell
        title="Configurações"
        accent={HUD.honey}
        onBack={onBack}
        contentClassName="flex flex-col gap-5"
      >
        {/* ── Áudio ── */}
        <section className="flex flex-col gap-2.5">
          <RibbonStrip icon={Music2} accent={HUD.honey} className="self-start">
            <span
              className="hud-label text-[12px]"
              style={{ color: "#fff", textShadow: `1px 1px 0 ${INK}` }}
            >
              Áudio
            </span>
          </RibbonStrip>
          <ToggleRow
            on={sfxOn}
            onToggle={toggleSfx}
            title="Efeitos sonoros"
            desc="Passos, tiros, explosões"
            icon={Music2}
            accent={HUD.rose}
          />
          <ToggleRow
            on={voiceOn}
            onToggle={toggleVoice}
            title="Voz das partidas"
            desc="Ouvir os amigos por perto"
            icon={Volume2}
            accent={HUD.rose}
          />
        </section>

        {/* ── Dispositivos ── */}
        <section className="flex flex-col gap-3">
          <RibbonStrip icon={Mic} accent={HUD.honey} className="self-start">
            <span
              className="hud-label text-[12px]"
              style={{ color: "#fff", textShadow: `1px 1px 0 ${INK}` }}
            >
              Dispositivos
            </span>
          </RibbonStrip>

          {permissionError && (
            <p
              className="hud-text flex items-start gap-2 text-[12px] leading-snug"
              style={{
                color: INK_TEXT,
                background: CREAM,
                border: `2px solid ${INK}`,
                borderRadius: 10,
                padding: "8px 10px",
                boxShadow: `0 3px 0 ${INK}`,
              }}
            >
              <span className="mt-px shrink-0">
                <IconWell icon={AlertCircle} accent={HUD.danger} size={22} />
              </span>
              {permissionError}
            </p>
          )}

          {/* Microphone */}
          <div className="flex flex-col gap-1.5">
            <span className="hud-label text-[11px]" style={{ color: INK_TEXT }}>
              Microfone
            </span>
            <SelectField
              value={selectedInput}
              onChange={handleInputChange}
              options={inputOptions}
              icon={Mic}
              ariaLabel="Microfone"
            />
          </div>

          {/* Speaker */}
          <div className="flex flex-col gap-1.5">
            <span className="hud-label text-[11px]" style={{ color: INK_TEXT }}>
              Alto-falante
            </span>
            <SelectField
              value={selectedOutput}
              onChange={handleOutputChange}
              options={outputOptions}
              icon={Volume2}
              disabled={!canRouteOutput}
              ariaLabel="Alto-falante"
            />
            {!canRouteOutput && (
              <p
                className="hud-text text-[11px] leading-snug"
                style={{ color: "#9B7B63" }}
              >
                Este navegador não deixa escolher a saída — use o som do
                sistema.
              </p>
            )}
          </div>

          {/* Test sound — chunky honey CTA. */}
          <button
            type="button"
            onClick={() => void handleTestSound()}
            disabled={testing}
            className="mt-1 flex w-full items-center justify-center gap-2.5 transition-transform hover:-translate-y-0.5 active:translate-y-[2px] disabled:translate-y-0 disabled:opacity-60"
            style={{
              background: testing ? HUD.muted : HUD.honey,
              border: `3px solid ${INK}`,
              borderRadius: 12,
              padding: "10px 16px",
              boxShadow: testing
                ? "none"
                : `0 0 0 1.5px ${HUD.terracotta}, 0 5px 0 ${INK}, 0 9px 0 rgba(0,0,0,0.3)`,
            }}
          >
            <IconWell
              icon={Volume2}
              accent={HUD.terracotta}
              size={28}
              className={cn(testing && "animate-pulse")}
            />
            <span
              className="text-[14px] font-bold"
              style={{ color: "#fff", textShadow: `1px 1px 0 ${INK}` }}
            >
              {testing ? "Tocando…" : "Testar som"}
            </span>
          </button>
        </section>

        {/* ── Vídeo ── */}
        <section className="flex flex-col gap-2.5">
          <RibbonStrip
            icon={Gamepad2}
            accent={HUD.honey}
            className="self-start"
          >
            <span
              className="hud-label text-[12px]"
              style={{ color: "#fff", textShadow: `1px 1px 0 ${INK}` }}
            >
              Vídeo
            </span>
          </RibbonStrip>
          <ToggleRow
            on={pixelOn}
            onToggle={togglePixel}
            title="Modo desenho"
            desc="Pixelado, contorno e cores de cartoon"
            icon={Gamepad2}
            accent={HUD.rose}
          />
          <SliderRow
            value={vhsLevel}
            min={0}
            max={1}
            step={0.05}
            onValueChange={handleVhsLevel}
            title="Intensidade do filtro VHS"
            desc={
              pixelOn
                ? "Quão forte é o visual retrô (pixel, contorno, cores)"
                : "Liga o «Modo desenho» para ver o efeito"
            }
            icon={Film}
            accent={HUD.honey}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </section>

        {/* ── Controles ── */}
        <section className="flex flex-col gap-2.5">
          <RibbonStrip
            icon={MousePointer2}
            accent={HUD.honey}
            className="self-start"
          >
            <span
              className="hud-label text-[12px]"
              style={{ color: "#fff", textShadow: `1px 1px 0 ${INK}` }}
            >
              Controles
            </span>
          </RibbonStrip>
          <SliderRow
            value={sensitivity}
            min={AIM_SENSITIVITY_MIN}
            max={AIM_SENSITIVITY_MAX}
            step={0.1}
            onValueChange={handleSensitivity}
            title="Sensibilidade do cursor"
            desc="O quanto a mira anda por movimento do mouse"
            icon={MousePointer2}
            accent={HUD.rose}
            format={(v) => `${v.toFixed(1)}×`}
          />
        </section>

        {/* Footnote: ground the voice radius in gameplay. */}
        <p
          className="hud-text flex items-center gap-2 text-[11px] leading-snug"
          style={{ color: INK_TEXT }}
        >
          <span className="shrink-0">
            <IconWell icon={Radio} accent={HUD.rose} size={22} />
          </span>
          Só te ouve quem estiver dentro do teu raio vermelho.
        </p>
      </ScreenShell>
    </div>
  );
};
