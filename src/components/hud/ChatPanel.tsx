import { memo, useEffect, useRef, useState, useCallback } from "react";
import { MessageSquare, Send } from "lucide-react";
import { GamePanel, IconWell, HUD, INK } from "./primitives";

/** A single chat message. `t` is a timestamp (ms) for keying. */
export interface ChatMessage {
  id: string;
  name: string;
  text: string;
  t: number;
}

interface ChatPanelProps {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  onFocusChange?: (focused: boolean) => void;
  isMobile?: boolean;
}

const MAX_VISIBLE = 8;
const MAX_LENGTH = 140;

/**
 * Real-time chat panel — shows the latest N messages in a scrollable list and
 * provides a text input that sends on Enter. Input focus/blur is reported to
 * the parent so the game can disable movement keys while the player is typing.
 *
 * Styled in the "game HUD" language: one dark cocoa-glass GamePanel (rose
 * identity), an IconWell header, rose sender names + white message bodies, and
 * a honey send IconWell. Older messages fade purely via computed CSS opacity —
 * no per-frame React state.
 */
const ChatPanelImpl = ({ messages, onSend, onFocusChange, isMobile = false }: ChatPanelProps) => {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to the latest message whenever the list changes.
  useEffect(() => {
    const el = listRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const handleFocus = useCallback(() => {
    onFocusChange?.(true);
  }, [onFocusChange]);

  const handleBlur = useCallback(() => {
    onFocusChange?.(false);
  }, [onFocusChange]);

  const submitDraft = useCallback(() => {
    const text = draft.trim().slice(0, MAX_LENGTH);
    if (text) {
      onSend(text);
      setDraft("");
    }
  }, [draft, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submitDraft();
      } else if (e.key === "Escape") {
        e.preventDefault();
        inputRef.current?.blur();
      }
      // Stop game-key events from propagating while the input is focused.
      e.stopPropagation();
    },
    [submitDraft],
  );

  const visible = messages.slice(-MAX_VISIBLE);

  const panelWidth = isMobile ? "w-40" : "w-56";
  const maxMsgHeight = isMobile ? "max-h-[72px]" : "max-h-[152px]";
  const msgFontSize = isMobile ? "text-[10px]" : "text-[11px]";
  const inputFontSize = isMobile ? "text-[10px]" : "text-[11px]";

  return (
    <GamePanel
      accent={HUD.rose}
      className={`pointer-events-auto ${panelWidth} flex flex-col overflow-hidden animate-rise`}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-2 py-1.5"
        style={{ borderBottom: `2px solid ${INK}` }}
      >
        <IconWell icon={MessageSquare} accent={HUD.rose} size={isMobile ? 20 : 22} />
        <span className="hud-label text-[9px]">Chat</span>
      </div>

      {/* Scrollable messages */}
      <div
        ref={listRef}
        className={`flex ${maxMsgHeight} flex-col overflow-y-auto overscroll-contain`}
        style={{ scrollbarWidth: "none" }}
      >
        {visible.length === 0 ? (
          <p className={`hud-text px-2 py-2 ${msgFontSize} italic`} style={{ opacity: 0.5 }}>
            Nenhuma mensagem ainda…
          </p>
        ) : (
          visible.map((msg, i) => {
            // Older messages fade out toward the top (computed, not per-frame).
            const depth = visible.length - 1 - i;
            const opacity = Math.max(0.45, 1 - depth * 0.11);
            return (
              <div
                key={`${msg.id}-${msg.t}`}
                className={`flex flex-wrap gap-x-1 px-2 py-0.5 ${msgFontSize}`}
                style={{ opacity }}
              >
                <span
                  className="font-bold leading-snug shrink-0"
                  style={{
                    color: HUD.rose,
                    textShadow: "0 1px 0 rgba(0,0,0,0.55)",
                  }}
                >
                  {msg.name}
                </span>
                <span className="hud-text leading-snug break-all">{msg.text}</span>
              </div>
            );
          })
        )}
      </div>

      {/* Input row */}
      <div
        className="flex items-center gap-1.5 px-1.5 py-1.5"
        style={{ borderTop: `2px solid ${INK}` }}
      >
        <input
          ref={inputRef}
          type="text"
          value={draft}
          maxLength={MAX_LENGTH}
          placeholder={isMobile ? "Enviar…" : "Enter para enviar…"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          className={`hud-text min-w-0 flex-1 px-2 py-1 ${inputFontSize} outline-none placeholder:text-[#9B7B63] placeholder:opacity-90`}
          style={{
            background: "rgba(255,255,255,0.10)",
            border: `2px solid ${INK}`,
            borderRadius: 6,
          }}
        />
        <button
          type="button"
          aria-label="Enviar mensagem"
          onMouseDown={(e) => e.preventDefault()}
          onClick={submitDraft}
          className="shrink-0 transition-transform active:scale-90"
        >
          <IconWell icon={Send} accent={HUD.honey} size={isMobile ? 24 : 28} />
        </button>
      </div>
    </GamePanel>
  );
};

/**
 * Memoized: `messages` is its own state array and the `onSend`/`onFocusChange`
 * callbacks are useCallback-stable in the parent, so this skips the per-tick
 * stats re-renders.
 */
export const ChatPanel = memo(ChatPanelImpl);
