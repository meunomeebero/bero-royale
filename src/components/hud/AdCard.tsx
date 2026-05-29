/**
 * AdCard — promotional card shown during the respawn countdown.
 * Styled to fit the game's dark HUD aesthetic while drawing attention.
 */
export const AdCard = () => {
  return (
    <a
      href="https://curricu.lol"
      target="_blank"
      rel="noopener noreferrer"
      className="group pointer-events-auto flex flex-col w-60 cursor-pointer"
    >
      {/* Outer glow border */}
      <div className="relative rounded-sm border border-game-accent/40 bg-game-panel/95 backdrop-blur-sm overflow-hidden shadow-[0_0_32px_hsl(265_100%_75%/0.18)] hover:shadow-[0_0_40px_hsl(265_100%_75%/0.35)] transition-shadow duration-300">
        {/* Top accent bar */}
        <div className="h-0.5 w-full bg-gradient-to-r from-transparent via-game-accent to-transparent" />

        {/* Scan sweep animation */}
        <div className="pointer-events-none absolute inset-y-0 -left-full w-1/2 bg-gradient-to-r from-transparent via-game-accent/10 to-transparent group-hover:animate-[hud-sweep_1.8s_ease-in-out_infinite]" />

        <div className="px-5 py-5 flex flex-col gap-3">
          {/* AD label */}
          <span className="font-mono text-[8px] tracking-[0.35em] text-game-muted uppercase">
            Patrocinado
          </span>

          {/* Headline */}
          <p className="font-mono text-sm font-bold leading-snug text-game-accent uppercase tracking-wide">
            Você está a<br />
            <span className="text-2xl text-white">1 minuto</span>
            <br />
            da sua<br />
            <span className="text-game-accent">Vaga dos Sonhos</span>
          </p>

          {/* Body */}
          <p className="text-[11px] leading-relaxed text-game-muted/90">
            Analise gratuitamente seu currículo ou LinkedIn e descubra o que
            falta para você conquistar o sucesso profissional.
          </p>

          {/* CTA */}
          <div className="mt-1 flex items-center justify-between">
            <span className="font-mono text-[10px] tracking-[0.2em] text-game-accent-2 uppercase group-hover:text-white transition-colors">
              curricu.lol
            </span>
            <span className="font-mono text-[9px] text-game-muted border border-game-accent/30 px-2 py-0.5 group-hover:border-game-accent/70 transition-colors">
              Grátis
            </span>
          </div>
        </div>

        {/* Bottom accent bar */}
        <div className="h-px w-full bg-gradient-to-r from-transparent via-game-accent/40 to-transparent" />
      </div>
    </a>
  );
};
