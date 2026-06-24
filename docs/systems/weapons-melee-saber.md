# Arma corpo a corpo — Sabre de luz (hotbar slot 3)

**Keywords:** sabre, saber, lightsaber, melee, corpo a corpo, slot 3, staff (chave legada),
swing, baseball, parry, reflexão de projéteis, reflect, stun, stagger, fire-lock, interromper
super, knockback, hotbar.

> Domínio: combate / arma de melee. Para visão geral do combate veja
> [`../ARCHITECTURE.md`](../ARCHITECTURE.md); para netcode veja
> [`netcode-trust-model.md`](netcode-trust-model.md).

## O que é
A 3ª arma (slot 3 da hotbar). A `FireMode` continua chamada `"staff"` por compatibilidade de
wire/HUD, mas o item é um **sabre de luz** que flutua à frente do cubo (sem mão). Substituiu o
antigo bastão de madeira.

## Onde está o código (mapa)
| Peça | Arquivo | O quê |
|---|---|---|
| Mesh do sabre | `src/game/PigParts.ts` → `buildSaber()` | hilt + guarda + lâmina emissiva ciano + glow aditivo + `tip` |
| Animação + input + stagger local | `src/game/Player.ts` | `sampleSaberYaw()` (wind-up 45° CCW → strike 180° CW, eased), montagem dinâmica que nunca toca o corpo, `MeleeSample`, `applyMeleeStagger`, freeze de aim durante o swing |
| Resolução de hit/parry + netcode | `src/game/Game.ts` → `handleMeleeSample()` | hit varrido por sub-passos (anti-tunnel), parry (`reflectInArc`), stagger, gate de stun anti-grief, handler `parry` |
| Projéteis + reflexão | `src/game/Bullets.ts` → `reflectInArc()`, `cancelOwnedNear()` | reverte balas, varre trajeto da bala, gate vertical/inbound, `shooterId`/`reflections` |
| Stagger do bot local | `src/game/Bot.ts` → `applyMeleeStagger()` | stun + fire-lock + interromper super, free-window anti-refresh |
| Stagger do bot do servidor | `server/src/ws/bots.ts` → `staggerBot()` + `server/src/ws/index.ts` (interceptação de `meleehit`) | stun/fire-lock/super-interrupt server-authoritative |
| Mensagens de rede | `src/game/net/Multiplayer.ts` | `MeleeEvent`, `MeleeHitEvent` (campos de stun opcionais), `ParryEvent` + `sendParry` |
| HUD | `src/components/hud/WeaponHotbar.tsx` | rótulo do slot ("Sabre de luz") |

## Mecânicas (números canônicos)
- **Swing:** rest perpendicular (~90°) → wind-up 45° anti-horário → strike 180° horário (eased),
  `MELEE_SWING_DUR=0.4s`, `MELEE_COOLDOWN=0.55s`. Aim **congela durante o swing** (golpe comprometido).
- **Alcance:** `MELEE_RANGE=3.2` (dobrado de 1.6); lâmina visual chega ~ao alcance. Hit por segmento
  varrido (`MELEE_SWEEP_RADIUS=0.6`), 1× por alvo por swing.
- **Parry/reflexão:** janela `SWING_PARRY_START_T..END_T`; reflete balas inbound que cruzam a lâmina
  (varre lâmina E trajeto da bala). Balas de bot → viram do jogador e dão dano na volta. Balas de
  jogador remoto → crédito via `sendHit` + `sendParry` (o atirador cancela a própria bala = escudo
  real). Cap por swing; 1 reflexão por bala; gate vertical+inbound.
- **Stun/interrupção:** hit empurra + congela ações ~0.25s, trava tiro constante ~1s, e **zera o
  carregamento do super (arma 2)**. Rate-limited (free-window) contra stun-lock; durações clampadas
  no receptor.

## Limitações conhecidas (diferidas — ver [`../PENDENCIAS.md`](../PENDENCIAS.md))
- Parry PvP é **best-effort** sob latência (sem lag-comp; o cancelamento do tiro é por proximidade).
- Parry server-authoritative com shot-id e validação de swing estão diferidos (postura de
  anti-cheat diferida do projeto).

## Histórico
Projetado e revisado via Mega Brain (DeepSeek V4 Pro + GLM 5.2 + GPT-5.5/Codex), 2026-06-24.
Commits `feat(weapons): lightsaber melee …` + follow-ups de review.
