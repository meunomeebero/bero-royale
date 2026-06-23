import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ChevronDown, Mic, Radio, RefreshCw, Volume2, X } from "lucide-react";

/**
 * VoiceSettingsModal — pick the microphone + speaker used for proximity voice
 * chat, themed to match the cozy voxel-almanac HUD.
 *
 * Behavior (unchanged from the functional version):
 * - On open, requests mic permission ONCE so the OS populates device labels
 *   (enumerateDevices() returns blank labels until a getUserMedia grant).
 * - Lists audioinput + audiooutput devices in two pickers; refreshes on
 *   `devicechange` (plug/unplug).
 * - Persists the selection to localStorage (same keys VoiceChat reads) and
 *   calls back onSelectInput(id)/onSelectOutput(id) so the live VoiceChat swaps
 *   the active device immediately.
 * - Feature-detects HTMLMediaElement.setSinkId; if absent (Firefox / older
 *   Safari) the speaker picker + test are disabled with a note.
 * - Closes on backdrop click, the X keycap, or Escape.
 */

/** localStorage keys — MUST match those in src/game/net/VoiceChat.ts. */
const LS_MIC = "voxelcube:voice:mic";
const LS_SPK = "voxelcube:voice:spk";

/** A short, pleasant test tone (data-URI WAV would bloat; use WebAudio). */
const TEST_TONE_HZ = 440;
const TEST_TONE_MS = 350;

interface VoiceSettingsModalProps {
  open: boolean;
  onClose: () => void;
  onSelectInput: (deviceId: string) => void;
  onSelectOutput: (deviceId: string) => void;
  onRestart?: () => void;
  currentInput?: string | null;
  currentOutput?: string | null;
}

/** Whether the running browser supports routing audio output (setSinkId). */
function sinkIdSupported(): boolean {
  return typeof (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId === "function";
}

export const VoiceSettingsModal = ({
  open,
  onClose,
  onSelectInput,
  onSelectOutput,
  onRestart,
  currentInput,
  currentOutput,
}: VoiceSettingsModalProps) => {
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedInput, setSelectedInput] = useState<string>("");
  const [selectedOutput, setSelectedOutput] = useState<string>("");
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [restarting, setRestarting] = useState(false);

  const canRouteOutput = sinkIdSupported();
  /** Audio element used to play the speaker-test tone through the chosen device. */
  const testAudioRef = useRef<HTMLAudioElement | null>(null);

  /** (Re)read the device list. Labels are only populated post-permission. */
  const refreshDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setInputs(devices.filter((d) => d.kind === "audioinput"));
      setOutputs(devices.filter((d) => d.kind === "audiooutput"));
    } catch {
      setPermissionError("Não foi possível listar os dispositivos de áudio.");
    }
  }, []);

  // On open: request mic (to unlock labels) then enumerate; subscribe to
  // devicechange so hot-plugging a headset refreshes the lists live.
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    let permissionStream: MediaStream | null = null;

    const init = async () => {
      // Seed the pickers from persisted/current selection up front.
      setSelectedInput(currentInput ?? localStorage.getItem(LS_MIC) ?? "");
      setSelectedOutput(currentOutput ?? localStorage.getItem(LS_SPK) ?? "");
      try {
        permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setPermissionError(null);
      } catch {
        // Mic denied — output selection + listen-only still work, so continue
        // enumerating (labels for inputs may be blank, which is acceptable).
        setPermissionError(
          "Permissão de microfone negada. Ainda dá para escolher a saída de som.",
        );
      }
      if (cancelled) {
        permissionStream?.getTracks().forEach((t) => t.stop());
        return;
      }
      // The permission probe stream is only needed to unlock labels — release it
      // immediately so we don't hold the mic open (VoiceChat owns the real one).
      permissionStream?.getTracks().forEach((t) => t.stop());
      permissionStream = null;
      await refreshDevices();
    };

    void init();
    const onDeviceChange = () => void refreshDevices();
    navigator.mediaDevices.addEventListener("devicechange", onDeviceChange);

    return () => {
      cancelled = true;
      permissionStream?.getTracks().forEach((t) => t.stop());
      navigator.mediaDevices.removeEventListener("devicechange", onDeviceChange);
    };
  }, [open, currentInput, currentOutput, refreshDevices]);

  // Close on Escape while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handleInputChange = (deviceId: string) => {
    setSelectedInput(deviceId);
    if (!deviceId) return;
    try {
      localStorage.setItem(LS_MIC, deviceId);
    } catch {
      /* ignore */
    }
    onSelectInput(deviceId);
  };

  const handleOutputChange = (deviceId: string) => {
    setSelectedOutput(deviceId);
    if (!deviceId) return;
    try {
      localStorage.setItem(LS_SPK, deviceId);
    } catch {
      /* ignore */
    }
    onSelectOutput(deviceId);
  };

  /** Full voice restart — closes all peer connections and re-negotiates. */
  const handleRestart = async () => {
    if (!onRestart) return;
    setRestarting(true);
    try {
      onRestart();
      // Give the reconnection a moment to start before re-enumerating devices.
      await new Promise((r) => setTimeout(r, 800));
    } finally {
      setRestarting(false);
    }
  };

  /** Play a short tone through the selected speaker so the user can verify it. */
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

      // Route the tone through an <audio> element so setSinkId can target the
      // chosen speaker (an AudioContext can't pick an output device directly).
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
          /* fall back to default output */
        }
      }

      osc.start();
      // Soft attack/release so the tone isn't a click.
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

  if (!open) return null;

  const selectClass =
    "w-full appearance-none rounded-xl border-[1.5px] border-game-border bg-game-bg/50 px-3.5 py-2.5 pr-10 text-[13px] font-medium text-game-ink key-shadow outline-none transition focus-visible:border-game-accent focus-visible:ring-2 focus-visible:ring-game-accent/30 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-game-ink/45 px-4 backdrop-blur-[3px] animate-in fade-in-0 duration-150 motion-reduce:animate-none"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="voice-modal-title"
        className="relative w-[400px] max-w-full overflow-hidden rounded-2xl border-[1.5px] border-game-border bg-game-panel paper-grain cozy-shadow animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2 duration-200 motion-reduce:animate-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Honey-to-rose almanac ribbon across the top edge. */}
        <div className="h-1.5 w-full bg-gradient-to-r from-game-accent via-game-accent-2 to-game-accent-3" />

        <div className="p-6">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-game-muted">
                Chat de voz
              </p>
              <h2
                id="voice-modal-title"
                className="font-display text-[23px] font-semibold leading-tight text-game-ink"
              >
                Voz de proximidade
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border-[1.5px] border-game-border bg-game-bg/60 text-game-muted key-shadow outline-none transition hover:-translate-y-px hover:text-game-ink focus-visible:ring-2 focus-visible:ring-game-accent/40 active:translate-y-0"
            >
              <X className="h-4 w-4" strokeWidth={2.5} />
            </button>
          </div>

          {/* Grounds the panel in the gameplay: the red ring = hearing radius. */}
          <p className="mt-2 flex items-center gap-1.5 text-[12px] text-game-muted">
            <Radio className="h-3.5 w-3.5 shrink-0 text-game-accent" strokeWidth={2.25} />
            Só te ouve quem estiver dentro do teu raio.
          </p>

          {permissionError && (
            <p className="mt-4 flex items-start gap-2 rounded-xl border border-game-accent-3/35 bg-game-accent-3/10 px-3 py-2 text-[12px] leading-snug text-game-accent-3">
              <AlertCircle className="mt-px h-4 w-4 shrink-0" strokeWidth={2.25} />
              {permissionError}
            </p>
          )}

          {/* Microphone (input) channel */}
          <div className="mt-5">
            <div className="mb-2 flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-lg border border-game-border/70 bg-game-accent/12 text-game-accent">
                <Mic className="h-4 w-4" strokeWidth={2.25} />
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-game-muted">
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

          {/* Speaker (output) channel */}
          <div className="mt-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-lg border border-game-border/70 bg-game-accent-2/15 text-game-accent-2">
                <Volume2 className="h-4 w-4" strokeWidth={2.25} />
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-game-muted">
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
              <p className="mt-2 text-[11px] leading-snug text-game-muted">
                Este navegador não deixa escolher a saída — use as configurações
                de som do sistema.
              </p>
            )}
          </div>

          {/* Restart audio — full reconnect for "configured but inaudible". */}
          {onRestart && (
            <div className="mt-5">
              <button
                type="button"
                onClick={() => void handleRestart()}
                disabled={restarting}
                className="flex w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-game-accent/60 bg-game-accent/15 px-3 py-2.5 text-[13px] font-semibold text-game-accent key-shadow outline-none transition hover:-translate-y-px hover:bg-game-accent/25 focus-visible:ring-2 focus-visible:ring-game-accent/40 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw
                  className={`h-4 w-4 ${restarting ? "animate-spin" : ""}`}
                  strokeWidth={2.5}
                />
                {restarting ? "Reiniciando…" : "Reiniciar áudio"}
              </button>
              <p className="mt-1.5 text-center text-[11px] leading-snug text-game-muted">
                Não está a ouvir? Reinicie o áudio.
              </p>
            </div>
          )}

          {/* Pressable honey keycap: verify the chosen speaker. */}
          <button
            type="button"
            onClick={() => void handleTestSound()}
            disabled={testing}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-game-border bg-game-accent-2 px-3 py-2.5 text-[13px] font-semibold text-game-ink key-shadow outline-none transition hover:-translate-y-px hover:brightness-[1.04] focus-visible:ring-2 focus-visible:ring-game-accent/40 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Volume2
              className={`h-4 w-4 ${testing ? "animate-pulse" : ""}`}
              strokeWidth={2.5}
            />
            {testing ? "Tocando…" : "Testar som"}
          </button>
        </div>
      </div>
    </div>
  );
};
