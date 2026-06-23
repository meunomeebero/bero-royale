import { useEffect } from "react";
import { ArrowLeft, Maximize2, MoreVertical, Plus, Share } from "lucide-react";
import { isIOS } from "@/lib/useIsMobile";

/**
 * Shown on mobile when the game is opened in a browser tab (not installed).
 * Cozy Killer needs true fullscreen, which mobile browsers only give to an
 * installed (home-screen) app — so we block play in-browser and walk the player
 * through "Add to Home Screen".
 */

interface Step {
  icon: typeof Share;
  text: React.ReactNode;
}

interface InstallScreenProps {
  onBack: () => void;
}

export const InstallScreen = ({ onBack }: InstallScreenProps) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  const ios = isIOS();
  const steps: Step[] = ios
    ? [
        { icon: Share, text: <>Toque em <b>Compartilhar</b> na barra do Safari.</> },
        { icon: Plus, text: <>Escolha <b>“Adicionar à Tela de Início”</b>.</> },
        { icon: Maximize2, text: <>Abra o <b>Cozy Killer</b> pelo novo ícone — em tela cheia!</> },
      ]
    : [
        { icon: MoreVertical, text: <>Toque no <b>menu (⋮)</b> do navegador.</> },
        { icon: Plus, text: <>Escolha <b>“Instalar app”</b> ou <b>“Adicionar à tela inicial”</b>.</> },
        { icon: Maximize2, text: <>Abra o <b>Cozy Killer</b> pelo ícone — em tela cheia!</> },
      ];

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center px-5">
      <div className="relative w-full max-w-[440px] max-h-[88dvh] overflow-y-auto animate-rise">
        <div className="relative overflow-hidden rounded-[24px] border-[1.5px] border-game-border/80 bg-game-panel/95 backdrop-blur-md cozy-shadow">
          <div className="h-1.5 w-full bg-gradient-to-r from-game-accent via-game-accent-2 to-game-accent-3" />
          <div className="pointer-events-none absolute inset-0 paper-grain opacity-60" />

          <div className="relative flex flex-col gap-5 px-6 py-6 sm:px-7">
            {/* Header */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onBack}
                aria-label="Voltar"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border-[1.5px] border-game-border bg-game-bg/60 text-game-muted key-shadow outline-none transition hover:-translate-y-px hover:text-game-ink active:translate-y-0"
              >
                <ArrowLeft className="h-4 w-4" strokeWidth={2.5} />
              </button>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-game-muted">
                  Cozy Killer
                </p>
                <h2 className="font-logo text-[24px] leading-tight text-game-ink">
                  Jogue em tela cheia
                </h2>
              </div>
            </div>

            <p className="text-[14px] leading-relaxed text-game-ink/90">
              No celular, o Cozy Killer funciona como <b>app em tela cheia</b> (o
              navegador não deixa esconder as barras numa aba normal). Adicione à
              tela de início e abra pelo ícone — fica tudo em tela cheia e na
              horizontal.
            </p>

            {/* Steps */}
            <ol className="flex flex-col gap-2.5">
              {steps.map((s, i) => {
                const Icon = s.icon;
                return (
                  <li
                    key={i}
                    className="flex items-center gap-3 rounded-[16px] border-[1.5px] border-game-border bg-game-bg/45 px-3.5 py-3"
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-game-accent font-logo text-[15px] text-white">
                      {i + 1}
                    </span>
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] border border-game-border/60 bg-game-bg/70 text-game-accent">
                      <Icon className="h-[18px] w-[18px]" strokeWidth={2.25} />
                    </span>
                    <span className="text-[13px] leading-snug text-game-ink">
                      {s.text}
                    </span>
                  </li>
                );
              })}
            </ol>

            <p className="text-center text-[11px] text-game-muted">
              Depois de instalado, abra sempre pelo ícone do Cozy Killer.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
