# Balance log — Bero Royale

Registro de decisões de balanceamento: cada nerf/buff/tuning com racional e números canônicos.
Formato: data · domínio · mudança · racional · decisão.

---

## 2026-06-25 — Modelo de realismo dos bots (megabrain council)

**Spec de referência:** `docs/superpowers/specs/2026-06-25-multiplayer-bot-realism-design.md`
**Council:** 2 × GLM 5.2 (via OpenRouter) + 4 lentes Claude + juiz neutro.

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
- **Covariance drift:** `accEff` e `cadenceMul` (1.25−0.5×skill) são **negativamente
  correlacionados** com `skill`: bots habilidosos acertam mais E atiram mais rápido.
  `E[accEff × 1/cadenceMul] ≈ ACCURACY × 1.023` → **+2.3% de DPS médio** em relação a bots
  idênticos. Dentro da faixa de `SHOOT_CD_RND=0.5` (ruído de cadência cobre esse drift).
- **DECISÃO:** ACEITAR e LOGAR. NÃO tocar `SHOOT_CD_MIN` (owner-locked) para compensar.
  A distribuição centro-biased significa que a maioria dos bots fica próxima da média.

### Latência de reação: 150–300 ms, skill-scaled

- **Antes:** reação instantânea (frame-perfect omniscient).
- **Agora:** `reactT = REACT_MIN + (1-skill)*REACT_SPAN` → `[0.15s, 0.30s]`.
  Gatea FIRE (reactT=0) + dodge defensivo (`min(reactT, DEFENSIVE_FLINCH=0.12s)`).
  Semeado em `damageBot` somente quando `wasCalm` (ameaça estava em 0 → engajamento fresco).
- **Racional:** 150–300 ms é perceptível pelo player mas não o torna catatônico; skill-scaling
  faz bots fortes reagirem mais rápido, mantendo hierarquia.

### Super hesitation: 0.15–0.50 s, skill-scaled, dois passos arm→commit

- **Antes:** super iniciava imediatamente ao cumprir as condições de gate.
- **Agora:** `superHesitateT = SUPER_HESITATE_MIN + (1-skill)*SUPER_HESITATE_SPAN` →
  `[0.15s, 0.50s]`. Gate em dois passos: arm (`_superArmed=true`) → timer → commit
  incondicional (sem re-roll que poderia segurar o slot do super sem telegrafar nada).
- **Slot-safety:** `superHesitateT=0` e `_superArmed=false` limpos em abort, stagger (ambos
  os branches), respawn e saída de gate-failure. Nunca segura o slot por-player enquanto
  telegrafando nada.
- **Racional:** pausa humaniza o "tempo de decisão" antes do super; skill-scaling faz bots
  fracos hesitarem mais (mais dodgeable).

### Targeting: equal-by-distance + player-attention floor (post-pass)

- **Antes:** player-first (drop duel to chase you the instant you approach).
- **Agora:** `enemies` = players + bots tratados igual; nearest wins. `commitT` (0.8–1.6s)
  anti-ping-pong. Retaliation (player OU bot, dentro de SHOOT_RANGE+ENGAGE_LEASH).
  **Post-pass (player-attention floor):** único mecanismo que garante 0% neglect rate.
  Rode após o loop de bots; qualquer player com zero targeters recebe o bot livre (commitT≤0)
  mais próximo, com steal-guard (não tira o único guardião de outro player).
- **Racional:** "pure-equal" sem o post-pass deixa um player passivo sem-target ~29% do tempo
  (simulado pelo juiz do council). O post-pass reduz para ~0.6% (arredondamento). `PLAYER_PULL`
  (bias de distância proposto pelo GLM) foi **rejeitado** em favor desta garantia mais direta.
