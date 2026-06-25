# Bots do servidor — IA + combate (server-authoritative)

**Keywords:** bot, server bot, srvbot, IA, AI, backfill, engager, dogpile, target, hitscan, fire,
super, kamehameha, telegraph, dash, jump, item-seek, powerup, stagger, stun, tick, 20Hz, h(dano),
skill, accEff, cadenceMul, leadMul, reactT, commitT, superHesitateT, kills, streak, genHandle,
retaliation, player-attention-floor, yaw-slew, MAX_TURN_RATE, miss-spread, kill-feed, reaction.

> Domínio: IA/combate online server-side. Autoridade de rede: [`netcode-trust-model.md`](netcode-trust-model.md).
> O bug 🔴 dos "tiros invisíveis" mora aqui: [`online-invisible-shots-diagnosis.md`](online-invisible-shots-diagnosis.md).

## O que é
Bots simulados **no servidor** (um conjunto por sala, `server/src/ws/bots.ts` → `BotSim`), enviados
como pseudo-jogadores via presence + snapshots `"s"` a **20 Hz**. Todo cliente os renderiza como
remotos. Diferente dos bots locais (`src/game/Bot.ts`, modo offline), estes são **consistentes** para
todos.

**População:** `[3,6]` aleatório, sorteado uma vez quando o primeiro player entra (live>0 &&
targetBotCount===0), mantido pelo **tempo de vida da sala**, resetado em `clearRoom`. Cap
`MAX_BOTS=6`. Plano independente de quantos players reais há (sem `MIN_COMBATANTS`).

**Identidade por bot:** cada bot tem `skill∈[0,1]` (centro-biased: média de 2 rand), preservado
em respawn (como uma "reputação"). `deriveSkill` computa: `accEff=ACCURACY*(0.7+0.6*skill)`,
`cadenceMul=1.25-0.5*skill`, `leadMul=0.5+skill`. Spread de DPS ~3.1×; média populacional de
precisão ≈ACCURACY. Ver `docs/balance-log.md` para a decisão sobre o drift de +2.3% de DPS médio.

**Nome:** `genHandle` gera handles procedurais (PT-BR slang + anime/inglês, leet parcial ~30%,
~30–40% handles simples sem número/leet, bigNum 3–5 dígitos), com deduplicação por nome e por
stem (sem dígitos). Animal dedupado entre bots vivos. `rosterMembers` expõe `kills`.

## Mapa de código (`server/src/ws/bots.ts`)
| Peça | Onde | O quê |
|---|---|---|
| Estado do bot | `interface ServerBot` | pos/vel, jump arc (y/vy/grounded), dash, HP/shield, target, super (kameCharging), item-seek, buffs, **stagger** (stunT/fireLockT/staggerOkAt), **skill/accEff/cadenceMul/leadMul**, **commitT**, **reactT**, **superHesitateT/\_superArmed**, **kills/streak** |
| Gerar nome | `genHandle(taken)` | handle procedural PT-BR+anime, deduplicação nome+stem |
| Derivar skill | `deriveSkill(b)` | computa accEff/cadenceMul/leadMul a partir de b.skill |
| Loop principal | `tick(room, dt)` | mantém população [3,6] → estima vel dos alvos → **engager cap** → por bot: super-charge, seleção de alvo (equal-by-distance), nav (engage/seek/hunt), separação, steering, dash/jump, fire, integra física, fanout `"s"` → **player-attention-floor (post-pass)** |
| Cap anti-dogpile | `engagersByPlayer` / `superHolder` | só os `MAX_ENGAGERS_PER_PLAYER=3` bots mais próximos de um player atiram/fecham; 1 super por player |
| Seleção de alvo | dentro do `tick` | **equal-by-distance** (players==bots, nearest wins), `commitT` anti-ping-pong (re-seeded só em troca real de id), **retaliation** (player OU bot, dentro de SHOOT_RANGE+ENGAGE_LEASH, orienta imediatamente), **player-attention floor** (post-pass): garante 0% de neglected players |
| Latência de reação | `damageBot` → semente `reactT` (wasCalm), guards em fire/dodge | `reactT=0.15–0.30s` (skill-scaled) gatea FIRE (reactT=0) + dodge defensivo (`min(reactT,DEFENSIVE_FLINCH=0.12)`); gates são guards, nunca `continue` (vx/vz sempre integra) |
| Facing slew | `faceToward(b, dx, dz, dt)` | `yaw` slew a ≤`MAX_TURN_RATE=8` rad/s (normalizado a [-π,π]) para ENGAGE/SEEK_ITEM/HUNT; hard-faces só em `startDash` + `integrateCharging` (intencional) |
| Tiro normal | `fire(room, b, tgt)` | fanout `"shot"` (tracer visual que VIAJA) **+ hitscan hitscan agendado** (`resolveShot` via `enqueueHit`); miss: tracer deflectido por `MISS_SPREAD_RAD=0.18` (display-only); hit: `targetId` na shot payload (Phase 2 aim-at-victim) |
| Super (kamehameha) | `tickSuperCharge`/`fireSuper`/`abortSuper` | telegrafo ~1.2s (`SUPER_CHARGE`), feixe hitscan letal dodgeable, `SUPER_DAMAGE=3` shield-first; **superHesitateT** (0.15–0.50s, skill-scaled): gate arm→commit em 2 passos; `_superArmed` flag; slot-safe (clearado em abort/stagger/respawn) |
| Dano sofrido | `damageBot`/`killBot` | shield-first; `wasCalm` semente `reactT`; respawn após `RESPAWN_MS=5000` |
| Kill feed | `damageBot` (bot→bot) + `resolveShot`/`resolveSuper` (bot→player) | `kills` (lifetime, preservado) + `streak` (reset em morte); emitido como `min(streak,2)` → nunca tripla o banner de rampage `>=3` do cliente |
| Stagger (sabre) | `staggerBot` + interceptação de `meleehit` em `index.ts` | stun/fire-lock/super-interrupt server-side (ver [`weapons-melee-saber.md`](weapons-melee-saber.md)) |
| Pickups | `applyBotPickup` | heal/rapid/speed/dash/shield/super (resolvido em `powerups.ts`) |

## Acoplamento (boundaries)
`BotSim` lê do `RoomHub` (`hub.playerTargets`, `hub.damagePlayer`, `hub.isPlayer`, `hub.fanout`,
`hub.powerupSim.botItemTargets`) — **one-directional** para evitar import circular com `PowerUpSim`.
Os bots NÃO simulam balas: tiro é **hitscan + tracer visual** (sem física de projétil no servidor).

## ⚠️ Bug conhecido (prioridade) — dano antes do visual
`fire()` agenda dano "on arrival" (via `enqueueHit`), mas o tracer ainda viaja antes. A Phase 1/2/4
do [`netcode-hit-sync-plan.md`](netcode-hit-sync-plan.md) mitiga o pior caso — o scheduler de impacto
e o beam-front do super. O fluxo completo está documentado lá. **Pendente de decisão de feel/balance.**

## Constantes-chave (feel/balance — owner-locked, cuidar ao mexer)
| Constante | Valor | Papel |
|---|---|---|
| `MOVE_SPEED` | 4.6 | velocidade base (um pouco menor que o player) |
| `SHOOT_CD_MIN` | 0.55 | cadência mínima (owner-locked; não tocar para compensar o drift de DPS) |
| `SHOOT_CD_RND` | 0.5 | variação aleatória de cadência |
| `ACCURACY` | 0.3 | hit-rate base (média populacional → accEff varia por skill) |
| `LEAD_FACTOR` | 0.12 | segundos de lead na mira |
| `ENGAGE_DIST` | 5.2 | raio de orbit ao redor do alvo |
| `MAX_ENGAGERS_PER_PLAYER` | 3 | bots que podem atirar/fechar por player (anti-dogpile) |
| `SUPER_CHARGE` | 1.2 | wind-up do super (product-locked) |
| `SUPER_DAMAGE` | 3 | dano do super (shield-first) |
| `BOT_TICK_MS` | 50 | 20 Hz |
| `MAX_TURN_RATE` | 8 rad/s | cap de slew do yaw (suaviza retarget/reação) |
| `REACT_MIN` | 0.15s | piso de startle por skill (REACT_MIN + (1-skill)*REACT_SPAN) |
| `REACT_SPAN` | 0.15s | spread de startle → 0.15–0.30s |
| `DEFENSIVE_FLINCH` | 0.12s | dodge defensivo libera em min(reactT, DEFENSIVE_FLINCH) |
| `SUPER_HESITATE_MIN` | 0.15s | pausa antes de commit do super (0.15–0.50s, skill-scaled) |
| `SUPER_HESITATE_SPAN` | 0.35s | span do hesitate |
| `COMMIT_MIN` | 0.8s | duração mínima do commitT (0.8–1.6s, skill-scaled) |
| `COMMIT_SPAN` | 0.8s | span do commit |
| `MISS_SPREAD_RAD` | 0.18 | deflexão máxima do tracer cosmético em miss |

## Tell conhecido sobrevivente
Todos os bots compartilham a mesma **cinemática de movimento** (orbit/dash/jump idênticos). O campo
`moveStyle` por bot foi **conscientemente diferido** (YAGNI para uma sala de 3–6 bots que um player
sozinho observa brevemente). Quando o lobby crescer, isso será o tell mais audível.

Outros itens diferidos (não em nenhuma task, por design): per-tick aim-noise, panic state,
per-respawn skill jitter, avatar tint, burst-fire, live churn, arena cover.
