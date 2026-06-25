# Balance log — sessões de balanceamento do Bero Royale

**Keywords:** balance, balanceamento, nerf, buff, tuning, ajuste, sessão, playtest, peso,
velocidade, armas, super, kite, dano, fire rate, cooldown, números canônicos, histórico de balance.

> **Por que este doc existe:** um jogo competitivo só tem sucesso se for **balanceado**. Cada arma
> e interação precisa ter força e fraqueza claras (sem dominância, sem playstyle "grátis"). Este é o
> **registro vivo das decisões de balance**: o quê mudou, por quê, e o resultado observado em
> playtest. Toda sessão de balance entra aqui (mais recente no topo). Os **números canônicos atuais**
> vivem nos docs de sistema (ex.: [`systems/weapons-weight-speed.md`](systems/weapons-weight-speed.md));
> este log guarda o **raciocínio e a história**.

## Princípios de balance (do projeto)
- **Toda força tem um custo.** Mobilidade alta ↔ dano baixo; dano alto ↔ mobilidade/lentidão.
- **Punir playstyles "grátis".** Se um padrão (ex.: carregar super no seguro e fugir pra recarregar)
  não tem contrapartida, ele vira dominante → criar o trade-off.
- **Iterar com playtest.** Ajustar em passos pequenos (±10%) e sentir antes de empilhar.
- **Documentar.** Toda mudança de número/regra entra aqui + no doc de sistema correspondente.

---

## Sessão 2026-06-25 — peso das armas e nerf do kite do super
**Contexto/objetivo:** o **tiro constante** (arma 1) é a arma mais fraca; jogadores que ficam nela
ficavam sem recompensa. Introduzir **peso por arma** como alavanca de mobilidade e amarrar o super
concentrado a um custo de movimento.

**Mudanças:**
1. **Peso por arma → velocidade de corrida** (nova mecânica). Arma ativa escala a velocidade:
   - Tiro constante (leve): **+30%** mobilidade (iterado em playtest: +10% → +20% → +30%, ainda
     buscando casar com a fraqueza de dano da arma).
   - Tiro concentrado (normal): **×1.00**.
   - Sabre (pesada): **−10%**.
   Compõe (multiplica) com o power-up "speed". Não afeta o dash.
2. **Super carregando/carregado pesa (nerf do kite).** Enquanto o super concentrado está
   `charging` OU `ready`, o jogador é desacelerado (knob próprio `SUPER_LOADED_SPEED_MULT`, sem
   acoplar ao sabre). Iterado em playtest: **−10% → −20%** (×0.80, _mais lento que o sabre_) porque
   −10% ainda deixava o kite rápido demais. Alvo: o padrão "carrega no seguro → corre pra briga →
   atira → foge pra recarregar". Carregar/segurar um super agora custa mobilidade em todo o ciclo
   (não só quando pronto).

**Decisões em aberto / próximos passos:**
- Sentir se +30% no constante basta ou se a arma precisa de **buff de dano/fire-rate** em vez de só
  mobilidade (hoje: 1 de dano a ~8 tiros/s).
- Considerar aprofundar o sabre (−10% → −20%) pra abrir o gap sem deixar o gun "twitchy".
- Avaliar se o nerf do super deveria valer só quando **pronto** (não enquanto carrega) — hoje vale
  para os dois.

**Arquivos:** `src/game/Player.ts` (`WEAPON_SPEED_MULT`, `superLoaded` no cálculo de `effSpeed`),
doc de sistema [`systems/weapons-weight-speed.md`](systems/weapons-weight-speed.md).

**🚀 Deploy:** em prod 2026-06-25 (junto com a fidelidade do sabre no online — commit `b33fefb`,
bundle `index-CKaIO6m3.js`). Review GPT-5.5 (codex) limpo (1 P2 corrigido: arma inferida por evento
pra peers legados) + revisão adversarial multi-agente. https://beroroyale.shardweb.app
