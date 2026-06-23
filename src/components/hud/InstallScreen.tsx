import { useEffect } from "react";
import { Check, Maximize2, MoreVertical, Plus, Share } from "lucide-react";
import { isIOS } from "@/lib/useIsMobile";
import { ScreenShell, PlayButton, INK_TEXT, CREAM } from "./menu-primitives";
import { HexBadge, IconWell, HUD, INK } from "./primitives";

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
      <div className="max-h-[88dvh] w-full max-w-[440px] overflow-y-auto">
        <ScreenShell
          title="Instalar"
          accent={HUD.honey}
          onBack={onBack}
          footer={
            <PlayButton label="Entendi" icon={Check} onClick={onBack} />
          }
        >
          <div className="flex flex-col gap-4">
            {/* Pitch */}
            <p
              className="text-[14px] font-semibold leading-relaxed"
              style={{ color: INK_TEXT }}
            >
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
                    className="flex items-center gap-3"
                    style={{
                      background: CREAM,
                      border: `2px solid ${INK}`,
                      borderRadius: 10,
                      padding: "10px 12px",
                      boxShadow: `0 3px 0 ${INK}`,
                    }}
                  >
                    <HexBadge accent={HUD.rose} size={34} value={i + 1} />
                    <IconWell icon={Icon} accent={HUD.honey} size={34} />
                    <span
                      className="flex-1 text-[13px] font-semibold leading-snug"
                      style={{ color: INK_TEXT }}
                    >
                      {s.text}
                    </span>
                  </li>
                );
              })}
            </ol>

            <p
              className="text-center text-[11px] font-semibold"
              style={{ color: "#9B7B63" }}
            >
              Depois de instalado, abra sempre pelo ícone do Cozy Killer.
            </p>
          </div>
        </ScreenShell>
      </div>
    </div>
  );
};
