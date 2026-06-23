import { useEffect } from "react";
import { ArrowLeft, ExternalLink, Heart, Swords } from "lucide-react";

/**
 * Full-screen "Sobre" view for the menu — who made Cozy Killer and where to
 * find more. Same cozy parchment system as the rest of the game.
 */

interface AboutScreenProps {
  onBack: () => void;
}

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
                Sobre
              </h2>
            </div>
          </div>

          {/* Pitch */}
          <p className="text-[14px] leading-relaxed text-game-ink/90">
            Um mundinho fofo e voxel onde os bichinhos não fazem prisioneiros.
            Mundo doce, lutas impiedosas. Sobreviva às ondas ou caia na arena
            todos-contra-todos com os teus amigos.
          </p>

          {/* Credit card */}
          <div className="flex items-center gap-3 rounded-[16px] border-[1.5px] border-game-border bg-game-bg/45 px-4 py-3.5">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[13px] border border-game-accent/40 bg-game-accent/15 text-game-accent">
              <Swords className="h-5 w-5" strokeWidth={2.25} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-game-muted">
                Feito com <Heart className="h-3 w-3 fill-game-accent text-game-accent" /> por
              </span>
              <span className="font-display text-[20px] font-semibold leading-tight text-game-ink">
                Bero
              </span>
            </div>
          </div>

          {/* Portfolio link */}
          <a
            href="https://bero.land"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-xl bg-game-accent px-5 py-3 text-[15px] font-semibold text-white outline-none transition-all duration-100 hover:brightness-[1.04] focus-visible:ring-2 focus-visible:ring-game-accent/50 active:translate-y-[3px] active:[box-shadow:0_1px_0_rgba(140,36,64,0.6)]"
            style={{ boxShadow: "0 4px 0 rgba(140,36,64,0.6)" }}
          >
            <ExternalLink className="h-[18px] w-[18px]" strokeWidth={2.5} />
            bero.land
          </a>

          <p className="text-center text-[11px] text-game-muted">
            cozykiller.io · demo
          </p>
        </div>
      </div>
    </div>
  );
};
