# Bots do servidor — IA + combate (server-authoritative)

**Keywords:** bot, server bot, srvbot, IA, AI, backfill, engager, dogpile, target, hitscan, fire,
super, kamehameha, telegraph, dash, jump, item-seek, powerup, stagger, stun, tick, 20Hz, h(dano).

> Domínio: IA/combate online server-side. Autoridade de rede: [`netcode-trust-model.md`](netcode-trust-model.md).
> O bug 🔴 dos "tiros invisíveis" mora aqui: [`online-invisible-shots-diagnosis.md`](online-invisible-shots-diagnosis.md).

## O que é
Bots simulados **no servidor** (um conjunto por sala, `server/src/ws/bots.ts` → `BotSim`), enviados
como pseudo-jogadores via presence + snapshots `"s"` a **20 Hz**. Todo cliente os renderiza como
remotos. Diferente dos bots locais (`src/game/Bot.ts`, modo offline), estes são **consistentes** para
todos. Backfill: mantém ~`MIN_COMBATANTS=10` combatentes, cap `MAX_BOTS=5`, só com ≥1 player real.

## Mapa de código (`server/src/ws/bots.ts`)
| Peça | Onde | O quê |
|---|---|---|
| Estado do bot | `interface ServerBot` | pos/vel, jump arc (y/vy/grounded), dash, HP/shield, target, super (kameCharging), item-seek, buffs, **stagger** (stunT/fireLockT/staggerOkAt) |
| Loop principal | `tick(room, dt)` | mantém população → estima vel dos alvos → **engager cap** → por bot: super-charge, seleção de alvo, nav (engage/seek/hunt), separação, steering, dash/jump, fire, integra física, fanout `"s"` |
| Cap anti-dogpile | `engagersByPlayer` / `superHolder` | só os `MAX_ENGAGERS_PER_PLAYER=3` bots mais próximos de um player atiram/fecham; 1 super por player |
| Seleção de alvo | dentro do `tick` | player-first, sticky (hysteresis), retaliação ao ser atingido |
| Tiro normal | `fire(room, b, tgt)` | fanout `"shot"` (tracer visual que VIAJA) **+ hitscan instantâneo** (`damagePlayer`/`damageBot` + `"hit"`/`"died"`). ⚠️ ver bug abaixo |
| Super (kamehameha) | `tickSuperCharge`/`fireSuper`/`abortSuper` | telegrafo ~1.2s (`SUPER_CHARGE`), feixe hitscan letal dodgeable, `SUPER_DAMAGE=3` shield-first |
| Dano sofrido | `damageBot`/`killBot` | shield-first; respawn após `RESPAWN_MS=5000` |
| Stagger (sabre) | `staggerBot` + interceptação de `meleehit` em `index.ts` | stun/fire-lock/super-interrupt server-side (ver [`weapons-melee-saber.md`](weapons-melee-saber.md)) |
| Pickups | `applyBotPickup` | heal/rapid/speed/dash/shield/super (resolvido em `powerups.ts`) |

## Acoplamento (boundaries)
`BotSim` lê do `RoomHub` (`hub.playerTargets`, `hub.damagePlayer`, `hub.isPlayer`, `hub.fanout`,
`hub.powerupSim.botItemTargets`) — **one-directional** para evitar import circular com `PowerUpSim`.
Os bots NÃO simulam balas: tiro é **hitscan + tracer visual** (sem física de projétil no servidor).

## ⚠️ Bug conhecido (prioridade) — dano antes do visual
`fire()` aplica dano **na hora** mas o tracer **viaja** → "tiro invisível / morte súbita". Correção
proposta (sincronizar dano com a chegada do tracer) em
[`online-invisible-shots-diagnosis.md`](online-invisible-shots-diagnosis.md). **Pendente de decisão de
feel/balance** (afeta TTK e dodgeability) — ver [`../PENDENCIAS.md`](../PENDENCIAS.md).

## Constantes-chave (feel/balance — owner-locked, cuidar ao mexer)
`MOVE_SPEED=4.6`, `SHOOT_CD_MIN=0.55`+`RND=0.5`, `ACCURACY=0.3`, `ENGAGE_DIST=5.2`,
`MAX_ENGAGERS_PER_PLAYER=3`, `SUPER_CHARGE=1.2`, `SUPER_DAMAGE=3`, `BOT_TICK_MS=50` (20Hz).
