/**
 * MobileControls — full-screen touch overlay for bero-royale.
 *
 * Layout (landscape, one-thumb-right optimised):
 *   • Bottom-left       — LEFT virtual joystick  (move)
 *   • Mid-right         — RIGHT virtual joystick (aim; holding auto-fires via InputManager)
 *   • Bottom-right      — JUMP + DASH one-shot buttons (below right stick, same thumb)
 *
 * In a 430 px-tall iPhone 14 Pro Max landscape viewport the right cluster sits
 * comfortably within thumb reach:
 *   buttons  ~24 px from safe-area bottom
 *   right stick  ~104 px above buttons (stick diameter) + gap
 *
 * Multi-touch: each zone tracks its own Touch.identifier so left stick,
 * right stick, and action buttons all work simultaneously.
 *
 * Props contract (INPUT CONTRACT):
 *   onMove(x, y)  — left stick vector [-1..1], y=down; (0,0) on release
 *   onAim(x, y)   — right stick vector [-1..1] while held
 *   onAimEnd()    — right stick released
 *   onJump()      — jump button touchstart
 *   onDash()      — dash button touchstart
 */

import { ChevronsUp, Zap } from "lucide-react";
import { useEffect, useRef } from "react";
import { useIsMobile } from "@/lib/useIsMobile";
import { HUD, INK } from "./primitives";

// ── Constants ────────────────────────────────────────────────────────────────
const STICK_RADIUS = 52;   // px — outer ring radius
const KNOB_RADIUS  = 22;   // px — draggable knob radius

// ── Types ────────────────────────────────────────────────────────────────────
export interface MobileControlsProps {
  onMove: (x: number, y: number) => void;
  onAim:  (x: number, y: number) => void;
  onAimEnd: () => void;
  onJump: () => void;
  onDash: () => void;
}

// ── Sub-components ───────────────────────────────────────────────────────────

interface StickProps {
  /** Which side this joystick lives on */
  side: "left" | "right";
  onDelta: (x: number, y: number) => void;
  onRelease: () => void;
  /** Extra px to add above the safe-area-inset-bottom (right stick sits higher) */
  extraBottomPx?: number;
  /** Knob identity color (move vs aim). */
  accent?: string;
}

/**
 * VirtualStick — a translucent base ring + draggable knob.
 * Handles its own touch tracking via a captured Touch identifier.
 */
const VirtualStick = ({ side, onDelta, onRelease, extraBottomPx = 0, accent = HUD.rose }: StickProps) => {
  const baseRef  = useRef<HTMLDivElement>(null);
  const knobRef  = useRef<HTMLDivElement>(null);
  const touchId  = useRef<number | null>(null);
  const centerRef = useRef({ x: 0, y: 0 });

  const onTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (touchId.current !== null) return; // already tracking
    const touch = e.changedTouches[0];
    touchId.current = touch.identifier;

    const rect = baseRef.current!.getBoundingClientRect();
    centerRef.current = {
      x: rect.left + rect.width  / 2,
      y: rect.top  + rect.height / 2,
    };
    moveKnob(touch.clientX, touch.clientY);
  };

  const onTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === touchId.current) {
        moveKnob(touch.clientX, touch.clientY);
        break;
      }
    }
  };

  const onTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === touchId.current) {
        touchId.current = null;
        resetKnob();
        onRelease();
        break;
      }
    }
  };

  const moveKnob = (clientX: number, clientY: number) => {
    const { x: cx, y: cy } = centerRef.current;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    const clamped = Math.min(dist, STICK_RADIUS);
    if (dist > 0) { dx = (dx / dist) * clamped; dy = (dy / dist) * clamped; }

    if (knobRef.current) {
      knobRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
    }

    const nx = dist > 0 ? dx / STICK_RADIUS : 0;
    const ny = dist > 0 ? dy / STICK_RADIUS : 0;
    // clamp vector length to 1
    const len = Math.hypot(nx, ny);
    if (len > 1) {
      onDelta(nx / len, ny / len);
    } else {
      onDelta(nx, ny);
    }
  };

  const resetKnob = () => {
    if (knobRef.current) {
      knobRef.current.style.transform = "translate(0px, 0px)";
    }
    onDelta(0, 0);
  };

  const isLeft = side === "left";

  return (
    <div
      ref={baseRef}
      className="absolute touch-none select-none"
      style={{
        width:  STICK_RADIUS * 2,
        height: STICK_RADIUS * 2,
        // Safe-area-aware positioning: calc combines the env() inset + fixed px offset
        bottom: `calc(env(safe-area-inset-bottom, 0px) + ${24 + extraBottomPx}px)`,
        ...(isLeft
          ? { left: "calc(env(safe-area-inset-left, 0px) + 20px)" }
          : { right: "calc(env(safe-area-inset-right, 0px) + 20px)" }),
        borderRadius: "50%",
        backgroundColor: "rgba(36,16,25,0.40)",
        border: `2px solid ${INK}`,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.12), 0 3px 0 rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        // pointer-events re-enabled here
        pointerEvents: "auto",
      }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      {/* knob */}
      <div
        ref={knobRef}
        style={{
          width:  KNOB_RADIUS * 2,
          height: KNOB_RADIUS * 2,
          borderRadius: "50%",
          backgroundColor: accent,
          border: `2px solid ${INK}`,
          boxShadow: "inset 0 2px 0 rgba(255,255,255,0.30), 0 2px 0 rgba(0,0,0,0.35)",
          transition: "transform 50ms linear",
          pointerEvents: "none",
          willChange: "transform",
        }}
      />
    </div>
  );
};

interface ActionBtnProps {
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
  /** extra right/left offset for spacing */
  offsetX?: number;
  /** Button identity color. */
  accent?: string;
}

const ActionBtn = ({ label, icon, onPress, offsetX = 0, accent = HUD.success }: ActionBtnProps) => {
  const onTouchStart = (e: React.TouchEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    onPress();
  };

  return (
    <button
      type="button"
      aria-label={label}
      className="touch-none select-none flex flex-col items-center gap-0.5"
      style={{
        pointerEvents: "auto",
        marginLeft: offsetX,
        marginRight: offsetX > 0 ? 0 : -offsetX,
      }}
      onTouchStart={onTouchStart}
    >
      <div
        style={{
          width: 52,
          height: 52,
          borderRadius: "50%",
          backgroundColor: accent,
          border: `2px solid ${INK}`,
          boxShadow: "inset 0 2px 0 rgba(255,255,255,0.28), 0 3px 0 rgba(0,0,0,0.35)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
        }}
      >
        {icon}
      </div>
      <span
        className="hud-label"
        style={{
          fontSize: 9,
          marginTop: 2,
        }}
      >
        {label}
      </span>
    </button>
  );
};

// ── Main component ────────────────────────────────────────────────────────────

/**
 * MobileControls — render only on mobile devices (useIsMobile gate).
 * The outer div is pointer-events-none so it never blocks the 3-D canvas;
 * each interactive child re-enables pointer-events individually.
 */
export const MobileControls = ({
  onMove,
  onAim,
  onAimEnd,
  onJump,
  onDash,
}: MobileControlsProps) => {
  const isMobile = useIsMobile();

  // Prevent default scroll / zoom on the whole overlay while touch is active.
  // We attach a non-passive listener because React synthetic events don't let
  // us call preventDefault() on touchmove reliably in all browsers.
  useEffect(() => {
    const prevent = (e: TouchEvent) => e.preventDefault();
    document.addEventListener("touchmove", prevent, { passive: false });
    return () => document.removeEventListener("touchmove", prevent);
  }, []);

  if (!isMobile) return null;

  return (
    /* Overlay — full screen, non-interactive by default */
    <div
      className="absolute inset-0 z-30"
      style={{ pointerEvents: "none" }}
      aria-hidden="true"
    >
      {/* LEFT stick — move */}
      <VirtualStick
        side="left"
        accent={HUD.rose}
        onDelta={onMove}
        onRelease={() => onMove(0, 0)}
      />

      {/* RIGHT stick — aim; raised so the action buttons fit below it */}
      {/*   extraBottomPx = button-cluster height (≈60px) + gap (12px) = 72px  */}
      <VirtualStick
        side="right"
        accent={HUD.terracotta}
        onDelta={onAim}
        onRelease={onAimEnd}
        extraBottomPx={72}
      />

      {/* RIGHT-SIDE action buttons — JUMP + DASH below the right stick       */}
      {/* Anchored to bottom-right so one right thumb covers aim + actions.    */}
      <div
        className="absolute flex items-end gap-4"
        style={{
          pointerEvents: "none",
          bottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)",
          right:  "calc(env(safe-area-inset-right, 0px) + 20px)",
        }}
      >
        <ActionBtn
          label="Pular"
          accent={HUD.success}
          icon={<ChevronsUp size={24} strokeWidth={2.75} />}
          onPress={onJump}
        />
        <ActionBtn
          label="Dash"
          accent={HUD.honey}
          icon={<Zap size={22} strokeWidth={2.75} />}
          onPress={onDash}
        />
      </div>
    </div>
  );
};

export default MobileControls;
