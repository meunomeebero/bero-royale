# Balance log — sessões de balanceamento do Bero Royale

**Keywords:** balance, balanceamento, nerf, buff, tuning, ajuste, sessão, playtest, peso,
velocidade, armas, super, kite, dano, fire rate, cooldown, números canônicos, histórico de balance,
bots, IA, realismo, skill, reação, targeting, hesitation.

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

## Sessão 2026-06-25 — Modelo de realismo dos bots (megabrain council)

**Spec de referência:** `docs/superpowers/specs/2026-06-25-multiplayer-bot-realism-design.md`
**Doc de sistema:** [`systems/server-bots-ai.md`](systems/server-bots-ai.md)
**Council:** GPT 5.5 + GLM 5.2 (via OpenRouter) + lentes Claude + juiz neutro.

### População: `[3,6]` plano, vitalício de sala

- **Antes:** preencher até `MIN_COMBATANTS=10`, cap `MAX_BOTS=5`.
- **Agora:** rolar `targetBotCount = 3 + floor(rand()*4)` → `[3,6]`, uma vez ao ativar a sala
  (live>0 && targetBotCount===0), mantido até `clearRoom`. `MAX_BOTS=6`.
- **Racional:** lobby de 3–6 bots é coerente com uma sessão early-access real; número fixo
  evita churning visível quando players entram/saem; o GLM sugeriu piso [4,6] (rejeitado —
  provado que não reduz o neglect rate).

### Precisão por bot: spread 3.1×, drift de DPS médio +2.3% ACEITO

- **Antes:** `ACCURACY=0.3` única para todos os bots (cloning effect).
- **Agora:** `skill∈[0,1]` (centro-biased) → `accEff=ACCURACY*(0.7+0.6*skill)`.
  Range efetivo `[0.21,0.39]`. Spread de DPS: ~3.1× (fraco vs forte).
- **Covariance drift:** `accEff` e `cadenceMul` (1.25−0.5×skill) ambos sobem com `skill`: bots
  habilidosos acertam mais E atiram mais rápido. `E[accEff × 1/cadenceMul] ≈ ACCURACY × 1.023` →
  **+2.3% de DPS médio** em relação a bots idênticos. Dentro da faixa de `SHOOT_CD_RND=0.5`.
- **DECISÃO:** ACEITAR e LOGAR. NÃO tocar `SHOOT_CD_MIN` (owner-locked) para compensar.
  A distribuição centro-biased significa que a maioria dos bots fica próxima da média.

### Latência de reação: 150–300 ms, skill-scaled

- **Antes:** reação instantânea (frame-perfect omniscient).
- **Agora:** `reactT = REACT_MIN + (1-skill)*REACT_SPAN` → `[0.15s, 0.30s]`.
  Gatea FIRE (reactT=0) + dodge defensivo via timer separado `defensiveReactT = min(reactT,
  DEFENSIVE_FLINCH=0.12s)`. Semeado em `damageBot` somente quando `wasCalm` (ameaça estava em 0).
- **Racional:** 150–300 ms é perceptível pelo player mas não o torna catatônico; skill-scaling
  faz bots fortes reagirem mais rápido, mantendo hierarquia. Facing faz slew (`MAX_TURN_RATE=8`),
  nunca snap de um tick (que leria como net-lag).

### Super hesitation: 0.15–0.50 s, skill-scaled, dois passos arm→commit

- **Antes:** super iniciava imediatamente ao cumprir as condições de gate.
- **Agora:** `superHesitateT = SUPER_HESITATE_MIN + (1-skill)*SUPER_HESITATE_SPAN` →
  `[0.15s, 0.50s]`. Gate em dois passos: arm (`_superArmed=true`) → timer → commit
  incondicional (sem re-roll que poderia segurar o slot do super sem telegrafar nada).
- **Slot-safety:** `superHesitateT=0` e `_superArmed=false` limpos em abort, stagger (ambos
  os branches), respawn, saída de gate-failure e **morte** (`damageBot`/`killBot`).

### Targeting: equal-by-distance + player-attention floor (post-pass)

- **Antes:** player-first (drop duel to chase you the instant you approach).
- **Agora:** `enemies` = players + bots tratados igual; nearest wins. `commitT` (0.8–1.6s)
  anti-ping-pong. Retaliation (player OU bot, dentro de SHOOT_RANGE+ENGAGE_LEASH).
  **Post-pass (player-attention floor):** único mecanismo que garante ~0% neglect rate.
  Rode após o loop de bots; qualquer player com zero targeters recebe o bot livre (commitT≤0)
  mais próximo, com steal-guard (não tira o único guardião de outro player).
- **Racional:** "pure-equal" sem o post-pass deixa um player passivo sem-target ~29% do tempo
  (simulado pelo juiz do council, invariante ao nº de bots). O post-pass reduz para ~0.6%.
  `PLAYER_PULL` (bias de distância proposto pelo GLM) foi **rejeitado** — não funcionava na
  geometria do arena (5u num arena de ±42); o post-pass é a garantia direta e sem alocação.

**🚀 Deploy:** em prod 2026-06-25 (review GPT-5.5 via OpenRouter — APPROVE, sem blockers; 2 fixes
aplicados: timer `defensiveReactT` real + limpar estado de super na morte). tsc/build/testes verdes.
Integrado sobre `main` (rename de armas + netcode Phase 3/5 já em prod) sem regressão.

---

## Sessão 2026-06-25 (v2) — ajuste de playtest pós-deploy
Feedback do playtest com amigos no online → 3 ajustes:
1. **Pistol — DPS pra baixo.** `SHOOT_COOLDOWN 0.10 → 0.11` (~9 tiros/s). O +20% ficou OP; agora é só
   **um pouco acima do antigo** 0.12.
2. **Energy Blast — canal de volta a 3.0s + sem HUD de texto.** `KAME_CHARGE 1.5 → 3.0` (o 1.5 ficou
   forte demais). O overlay **"Channeling…" foi removido** (poluía a tela; ficou só a barra de carga
   sob o slot 2).
3. **Lightsaber — impacto de volta, MAS sem stun.** Voltaram o **knockback + blink branco + fumaça**
   no acerto (a pancada satisfatória), mas **continua sem stun** — não trava tiro nem interrompe o
   canal/super da vítima. Client-side: `rp.applyStaggerVisual` (remotos) + `bot.knockback`/`bot.flash`
   (bots); **sem** `meleehit` (não estuna nem bot de servidor). `SABER_IMPACT_FLASH=0.6s`.

**Princípio confirmado:** Lightsaber = impacto **sem** controle; Energy Blast = burst + control (stun);
Pistol = mobilidade + RoF sustentado (sem ser dominante).

**Arquivos:** `src/game/Player.ts` (`SHOOT_COOLDOWN`, `KAME_CHARGE`), `src/game/Game.ts`
(`handleMeleeSample` knockback+flash; `SABER_IMPACT_FLASH`), `src/game/Bot.ts` (`flash()`),
`src/pages/Index.tsx` + `src/index.css` (HUD "Channeling…" removido; `ChannelingIndicator.tsx`
deletado). Docs: [`systems/weapons-melee-saber.md`](systems/weapons-melee-saber.md),
[`systems/weapons-energy-blast.md`](systems/weapons-energy-blast.md).

**🚀 Deploy:** em prod 2026-06-25 (commit `b345b7b`, bundle `index-FBaro2zH.js`). Review GPT-5.5
(OpenRouter) — **SHIP**, sem blockers. tsc/eslint/build/28 testes verdes. https://beroroyale.shardweb.app

---

## Sessão 2026-06-25 — rename + rebalance: Pistol / Energy Blast / Lightsaber
**Contexto/objetivo:** padronizar a nomenclatura das armas e re-equilibrar o trio. O Lightsaber
estava **OP** (dano alto + control de stun); a antiga "tiro concentrado" era pouco recompensadora pro
risco do canal; a "tiro constante" continuava fraca demais. Princípio: **cada arma com uma
força↔custo clara**.

**Rename (nomenclatura canônica):**
- Arma 1 = **Pistol** (`FireMode "pistol"`)
- Arma 2 = **Energy Blast** (`FireMode "energyBlast"`)
- Arma 3 = **Lightsaber** (`FireMode "lightsaber"`)
- "boss" (easter egg "bero") inalterado.
- Snapshot `NetState.weapon` agora ∈ `"gun" | "saber" | "blast"` (`"blast"` = Energy Blast de mãos
  vazias → remotos não mostram arma).

**Mudanças:**
1. **Pistol — fire rate +20%.** `SHOOT_COOLDOWN 0.12 → 0.10` (~10 tiros/s). A arma fraca de
   run-and-gun ganha DPS pra valer a pena ficar nela (mantém o +30% de mobilidade do peso leve).
2. **Energy Blast — mais difícil, mas recompensa.** Não segura nada (canaliza de mãos vazias; o mesh
   da gun some mas o feixe ainda sai do anchor do cano). Canal **−50%** (`KAME_CHARGE 3.0 → 1.5s`).
   Movimento: **rápida quando idle** (×1.30, igual à Pistol) e só **−20%** (×0.80) enquanto canaliza.
   Ganhou um **stun-on-hit** (knockback + flash + stun que interrompe o canal da vítima + trava o
   tiro ~1s) e um HUD piscante **"Channeling…"** (baixa opacidade, estilo Dota). Dano segue
   server-authoritative (`SUPER_DAMAGE=3`, **não** insta-kill).
3. **Lightsaber — stun removido (era OP).** Tirado o stun/fire-lock/super-interrupt/freeze/pulinho/
   flash; **não** envia mais `meleehit`. Agora é **dano puro (`MELEE_DAMAGE=3`) + deflexão (parry de
   balas/super) + impact spark**. O control que ele tinha foi o que migrou pra Energy Blast.

**Princípio de design:** cada arma com uma força↔custo clara — Pistol = mobilidade + RoF (DPS
sustentado, sem burst); Energy Blast = burst + control, ao custo de canal lento/exposto; Lightsaber =
deflexão + dano corpo-a-corpo, sem mais control gratuito.

**Decisões em aberto / próximos passos:**
- Sentir se o stun na Energy Blast não fica forte demais sob o canal curto (1.5s) — ajustar
  `MELEE_STUN`/`MELEE_FIRE_LOCK` ou o canal se virar dominante.
- Avaliar se o Lightsaber, sem control, precisa de algum buff (alcance/cooldown) pra continuar
  relevante vs a deflexão.

**Arquivos:** `src/game/Player.ts` (`SHOOT_COOLDOWN`, `FireMode`, `SLOT_MODES`, `WEAPON_SPEED_MULT`,
`KAME_CHARGE`, `setFireMode` bare-handed), `src/game/Game.ts` (`handleMeleeSample` sem stun;
`onKameHit`/`setKameHitHandler` com stagger; mapeamento `weapon`), `src/game/net/Multiplayer.ts`
(`NetState.weapon "blast"`), `src/components/hud/ChannelingIndicator.tsx` + `src/index.css`
(`.channel-flash`), `src/components/hud/WeaponHotbar.tsx` (rótulos). Docs:
[`systems/weapons-energy-blast.md`](systems/weapons-energy-blast.md) (novo),
[`systems/weapons-melee-saber.md`](systems/weapons-melee-saber.md),
[`systems/weapons-weight-speed.md`](systems/weapons-weight-speed.md),
[`systems/netcode-fidelity-golden-rule.md`](systems/netcode-fidelity-golden-rule.md).

**🚀 Deploy:** em prod 2026-06-25 (commit `85da240`, bundle `index-BdGMMS7N.js`). Review MegaBrain
limpo — GPT-5.5 Max + GLM 5.2 via OpenRouter, ambos **SHIP-AFTER-FIXES** (sem P1; fixes aplicados:
guard `isAlive` no stagger, feixe do blast saindo do peito, opacidade do "Channeling…", renomes de
clareza). 28 testes verdes. https://beroroyale.shardweb.app

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
