import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ChevronDown,
  Gamepad2,
  Mic,
  Monitor,
  Music2,
  Radio,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  PIXEL_FILTER_KEY,
  SFX_MUTED_KEY,
  VOICE_MUTED_KEY,
} from "@/game/consts";
import { cn } from "@/lib/utils";

/**
 * Full-screen Settings view for the menu (rendered over the blurred ambient
 * scene, same cozy parchment system as the rest of the game).
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

export const SettingsScreen = ({
  onBack,
  onSfxMutedChange,
  onPixelFilterChange,
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

  const selectClass =
    "w-full appearance-none rounded-xl border-[1.5px] border-game-border bg-game-bg/55 px-3.5 py-2.5 pr-10 text-[13px] font-medium text-game-ink key-shadow outline-none disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="relative w-full max-w-[440px] max-h-[88dvh] overflow-y-auto animate-rise">
      <div className="relative overflow-hidden rounded-[24px] border-[1.5px] border-game-border/80 bg-game-panel/90 backdrop-blur-md cozy-shadow">
        <div className="h-1.5 w-full bg-gradient-to-r from-game-accent via-game-accent-2 to-game-accent-3" />
        <div className="pointer-events-none absolute inset-0 paper-grain opacity-60" />

        <div className="relative flex flex-col gap-5 px-6 py-6 sm:px-7">
          {/* Header */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              aria-label="Voltar"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border-[1.5px] border-game-border bg-game-bg/60 text-game-muted key-shadow outline-none transition hover:-translate-y-px hover:text-game-ink focus-visible:ring-2 focus-visible:ring-game-accent/40 active:translate-y-0"
            >
              <ArrowLeft className="h-4 w-4" strokeWidth={2.5} />
            </button>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-game-muted">
                Cozy Killer
              </p>
              <h2 className="font-display text-[24px] font-semibold leading-tight text-game-ink">
                Configurações
              </h2>
            </div>
          </div>

          {/* ── Audio channels ── */}
          <div className="flex flex-col gap-2.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-game-muted">
              Som
            </span>
            <ToggleRow
              on={sfxOn}
              onToggle={toggleSfx}
              title="Efeitos sonoros"
              desc="Passos, tiros, explosões"
              IconOn={Music2}
              IconOff={VolumeX}
            />
            <ToggleRow
              on={voiceOn}
              onToggle={toggleVoice}
              title="Voz das partidas"
              desc="Ouvir os amigos por perto"
              IconOn={Volume2}
              IconOff={VolumeX}
            />
          </div>

          {/* ── Vídeo (visual filter) ── */}
          <div className="flex flex-col gap-2.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-game-muted">
              Vídeo
            </span>
            <ToggleRow
              on={pixelOn}
              onToggle={togglePixel}
              title="Modo desenho"
              desc="Pixelado, contorno e cores de cartoon"
              IconOn={Gamepad2}
              IconOff={Monitor}
            />
          </div>

          {/* ── Devices ── */}
          <div className="flex flex-col gap-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-game-muted">
              Dispositivos
            </span>

            {permissionError && (
              <p className="flex items-start gap-2 rounded-xl border border-game-accent-3/35 bg-game-accent-3/10 px-3 py-2 text-[12px] leading-snug text-game-accent-3">
                <AlertCircle className="mt-px h-4 w-4 shrink-0" strokeWidth={2.25} />
                {permissionError}
              </p>
            )}

            {/* Microphone */}
            <div>
              <div className="mb-1.5 flex items-center gap-2">
                <span className="grid h-6 w-6 place-items-center rounded-lg border border-game-border/70 bg-game-accent/12 text-game-accent">
                  <Mic className="h-3.5 w-3.5" strokeWidth={2.25} />
                </span>
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-game-muted">
                  Microfone
                </span>
              </div>
              <div className="relative">
                <select
                  className={selectClass}
                  value={selectedInput}
                  onChange={(e) => handleInputChange(e.target.value)}
                  aria-label="Microfone"
                >
                  <option value="">Padrão do sistema</option>
                  {inputs.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Microfone ${d.deviceId.slice(0, 6)}`}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-game-muted" />
              </div>
            </div>

            {/* Speaker */}
            <div>
              <div className="mb-1.5 flex items-center gap-2">
                <span className="grid h-6 w-6 place-items-center rounded-lg border border-game-border/70 bg-game-accent-2/15 text-game-accent-2">
                  <Volume2 className="h-3.5 w-3.5" strokeWidth={2.25} />
                </span>
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-game-muted">
                  Alto-falante
                </span>
              </div>
              <div className="relative">
                <select
                  className={selectClass}
                  value={selectedOutput}
                  onChange={(e) => handleOutputChange(e.target.value)}
                  disabled={!canRouteOutput}
                  aria-label="Alto-falante"
                >
                  <option value="">Padrão do sistema</option>
                  {outputs.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Alto-falante ${d.deviceId.slice(0, 6)}`}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-game-muted" />
              </div>
              {!canRouteOutput && (
                <p className="mt-1.5 text-[11px] leading-snug text-game-muted">
                  Este navegador não deixa escolher a saída — use o som do
                  sistema.
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={() => void handleTestSound()}
              disabled={testing}
              className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-game-border bg-game-accent-2 px-3 py-2.5 text-[13px] font-semibold text-game-ink key-shadow outline-none transition hover:-translate-y-px hover:brightness-[1.04] focus-visible:ring-2 focus-visible:ring-game-accent/40 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Volume2
                className={cn("h-4 w-4", testing && "animate-pulse")}
                strokeWidth={2.5}
              />
              {testing ? "Tocando…" : "Testar som"}
            </button>
          </div>

          {/* Footnote: ground the voice radius in gameplay. */}
          <p className="flex items-center gap-1.5 text-[11px] leading-snug text-game-muted">
            <Radio className="h-3.5 w-3.5 shrink-0 text-game-accent" strokeWidth={2.25} />
            Só te ouve quem estiver dentro do teu raio vermelho.
          </p>
        </div>
      </div>
    </div>
  );
};

interface ToggleRowProps {
  on: boolean;
  onToggle: () => void;
  title: string;
  desc: string;
  IconOn: typeof Volume2;
  IconOff: typeof VolumeX;
}

const ToggleRow = ({
  on,
  onToggle,
  title,
  desc,
  IconOn,
  IconOff,
}: ToggleRowProps) => {
  const Icon = on ? IconOn : IconOff;
  return (
    <button
      type="button"
      onClick={onToggle}
      role="switch"
      aria-checked={on}
      className="group flex items-center gap-3 rounded-[16px] border-[1.5px] border-game-border bg-game-bg/45 px-3.5 py-3 text-left outline-none transition hover:border-game-accent/50 focus-visible:ring-2 focus-visible:ring-game-accent/40"
    >
      <span
        className={cn(
          "grid h-9 w-9 shrink-0 place-items-center rounded-[11px] border transition-colors",
          on
            ? "border-game-accent/40 bg-game-accent/15 text-game-accent"
            : "border-game-border/60 bg-game-bg/70 text-game-muted",
        )}
      >
        <Icon className="h-[18px] w-[18px]" strokeWidth={2.25} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[14px] font-semibold text-game-ink">{title}</span>
        <span className="text-[11px] leading-snug text-game-muted">{desc}</span>
      </span>
      {/* Switch track */}
      <span
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full border-[1.5px] transition-colors",
          on
            ? "border-game-accent bg-game-accent/85"
            : "border-game-border bg-game-bg/80",
        )}
      >
        <span
          className={cn(
            "absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-white shadow-sm transition-all",
            on ? "left-[22px]" : "left-[3px]",
          )}
        />
      </span>
    </button>
  );
};
