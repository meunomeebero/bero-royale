import { forwardRef } from "react";
import { HUD, INK } from "./primitives";

/**
 * Targeting reticle — four hard-edged corner brackets around an open center gap,
 * with a small rose center dot. White with an ink outline so it reads on any
 * frame of the bright moving scene. No soft glow, no rotation (game-HUD look,
 * coherent with the dark cocoa-glass system).
 *
 * Position is driven IMPERATIVELY: the parent owns a ref and writes
 * `el.style.transform = translate(...)` in the mousemove handler, so pointer
 * motion triggers ZERO React reconciliation. Mounted once, never re-rendered.
 */
const bracketBase = "absolute h-2.5 w-2.5 border-white";

export const Crosshair = forwardRef<HTMLDivElement>((_props, ref) => {
  return (
    <div
      ref={ref}
      className="pointer-events-none fixed left-0 top-0 z-50"
      style={{ transform: "translate(-100px, -100px)" }}
    >
      <div
        className="relative h-11 w-11"
        // One ink outline applied to the whole group keeps every white edge crisp.
        style={{ filter: "drop-shadow(1px 0 0 " + INK + ") drop-shadow(-1px 0 0 " + INK + ") drop-shadow(0 1px 0 " + INK + ") drop-shadow(0 -1px 0 " + INK + ")" }}
      >
        {/* Corner brackets */}
        <div className={bracketBase + " left-0 top-0 rounded-tl-[2px] border-l-[3px] border-t-[3px]"} />
        <div className={bracketBase + " right-0 top-0 rounded-tr-[2px] border-r-[3px] border-t-[3px]"} />
        <div className={bracketBase + " bottom-0 left-0 rounded-bl-[2px] border-b-[3px] border-l-[3px]"} />
        <div className={bracketBase + " bottom-0 right-0 rounded-br-[2px] border-b-[3px] border-r-[3px]"} />

        {/* Center dot */}
        <div
          className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ background: HUD.rose, boxShadow: `0 0 0 1.5px ${INK}` }}
        />
      </div>
    </div>
  );
});

Crosshair.displayName = "Crosshair";
