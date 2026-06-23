import { useEffect } from "react";
import { ExternalLink, Heart, Swords } from "lucide-react";
import { ScreenShell, INK_TEXT } from "./menu-primitives";
import { HexBadge, HUD } from "./primitives";

/**
 * Full-screen "Sobre" view for the menu — who made Cozy Killer and where to
 * find more. Cocoa Cream language: a centered hex emblem, a Fraunces italic
 * pitch, and a tidy credits list with honey hairline dividers, all on the
 * cream ScreenShell stage.
 */

interface AboutScreenProps {
  onBack: () => void;
}

/** Honey hairline divider between credit rows. */
const Hairline = () => (
  <span aria-hidden className="block h-px w-full" style={{ background: `${HUD.honey}66` }} />
);

export const AboutScreen = ({ onBack }: AboutScreenProps) => {
  // Esc → back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  return (
    <ScreenShell title="Sobre" accent={HUD.honey} onBack={onBack} maxWidth={440}>
      <div className="flex flex-col items-center gap-5">
        {/* Logo emblem */}
        <div className="flex flex-col items-center gap-2">
          <HexBadge accent={HUD.rose} size={64} icon={Swords} />
          <span className="hud-label text-[10px]" style={{ color: INK_TEXT }}>
            Cozy Killer
          </span>
        </div>

        {/* Pitch — Fraunces italic intro */}
        <p
          className="hud-text font-display text-center text-[15px] italic leading-relaxed"
          style={{ color: INK_TEXT, textShadow: "none" }}
        >
          Um mundinho fofo e voxel onde os bichinhos não fazem prisioneiros.
          Mundo doce, lutas impiedosas. Sobreviva às ondas ou caia na arena
          todos-contra-todos com os teus amigos.
        </p>

        {/* Credits — tidy list, honey hairline dividers */}
        <div className="flex w-full flex-col">
          <Hairline />
          <a
            href="https://bero.land"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-3 py-3 transition-transform hover:translate-x-0.5"
          >
            <HexBadge accent={HUD.honey} size={36} icon={Heart} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span
                className="hud-label flex items-center gap-1 text-[10px]"
                style={{ color: HUD.muted }}
              >
                Feito com
                <Heart style={{ width: 11, height: 11, color: HUD.rose, fill: HUD.rose }} />
                por
              </span>
              <span
                className="hud-text font-sans text-[18px] font-bold leading-none"
                style={{ color: INK_TEXT, textShadow: "none" }}
              >
                Bero
              </span>
            </span>
            <ExternalLink
              className="transition-transform group-hover:translate-x-0.5"
              style={{ width: 18, height: 18, color: HUD.muted }}
              strokeWidth={2.75}
            />
          </a>
          <Hairline />
        </div>

        {/* Footnote */}
        <span className="hud-label text-[10px]" style={{ color: HUD.muted }}>
          cozykiller.io · demo
        </span>
      </div>
    </ScreenShell>
  );
};
