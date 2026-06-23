import { motion } from "framer-motion";

/**
 * AdCard — promotional card shown during the respawn countdown, styled to match
 * the cozy parchment HUD (warm cream panel, clay border, no neon).
 */
export const AdCard = () => {
  return (
    <motion.a
      href="https://curricu.lol"
      target="_blank"
      rel="noopener noreferrer"
      whileHover={{ scale: 1.02 }}
      className="group pointer-events-auto flex w-60 cursor-pointer flex-col overflow-hidden rounded-[14px] border-[1.5px] border-game-border bg-game-panel/95 cozy-shadow"
    >
      <div className="relative flex flex-col gap-3 px-5 py-5">
        <div className="pointer-events-none absolute inset-0 paper-grain opacity-70" />

        <span className="relative text-[10px] font-semibold uppercase tracking-[0.14em] text-game-muted">
          Patrocinado
        </span>

        <p className="relative font-display text-sm font-semibold leading-snug text-game-ink">
          Você está a<br />
          <span className="text-[28px] leading-none text-game-accent">
            1 minuto
          </span>
          <br />
          da sua{" "}
          <span className="text-game-accent">Vaga dos Sonhos</span>
        </p>

        <p className="relative text-[11px] leading-relaxed text-game-muted">
          Analise gratuitamente seu currículo ou LinkedIn e descubra o que falta
          para você conquistar o sucesso profissional.
        </p>

        <div className="relative mt-1 flex items-center justify-between">
          <span className="text-[10px] font-semibold text-game-accent-3">
            curricu.lol
          </span>
          <span className="rounded-md border-[1.5px] border-game-success px-2 py-0.5 text-[10px] font-semibold text-game-success">
            Grátis
          </span>
        </div>

        <span
          className="relative mt-1 self-start rounded-lg bg-game-accent px-4 py-1.5 text-xs font-semibold text-white"
          style={{ boxShadow: "0 2px 0 rgba(150,40,70,0.6)" }}
        >
          Analisar agora
        </span>
      </div>
    </motion.a>
  );
};
