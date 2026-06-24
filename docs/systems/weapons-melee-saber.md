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
| Rastro de luz (arco azul) | `src/game/SaberTrail.ts` | ribbon (triangle-strip) aditivo azul ao longo da lâmina varrida; alimentado por `Game` durante o strike; `clear()` por swing |
| Animação + input + stagger local | `src/game/Player.ts` | `sampleSaberYaw()` (wind-up 45° → strike 180° que SEGURA no follow-through; o retorno é o settle pós-swing), montagem dinâmica que nunca toca o corpo, `MeleeSample`, `applyMeleeStagger` (hop + flash), freeze de aim durante o swing |
| Resolução de hit/parry + netcode + trail | `src/game/Game.ts` → `handleMeleeSample()` | hit varrido por sub-passos, parry de balas (`bullets.reflectInArc`) E de super (`kame.reflectInArc`), stagger, alimenta `SaberTrail`, handler `parry` |
| Projéteis + reflexão | `src/game/Bullets.ts` → `reflectInArc()`, `cancelOwnedNear()` | reverte balas, varre trajeto da bala, gate vertical/inbound, `shooterId`/`reflections` |
| Super (mega tiro) + reflexão | `src/game/Kamehameha.ts` → `reflectInArc()` | reflete feixes **damaging** que cruzam a lâmina (reverte + re-owna → voltam pelo `onHit`); pula visuais (autoritativo no servidor); bot super é **dodgeable por pulo** |
| Stagger + super do bot local | `src/game/Bot.ts` → `applyMeleeStagger()`, `knockback()` | hop (kb impulse + vy) + flash; stun + fire-lock + interromper super; bots locais agora disparam o super telegrafado (gate `onKame`) |
| Stagger VISUAL de remotos (MP) | `src/game/RemotePlayer.ts` → `applyMeleeStagger()` | quando VOCÊ golpeia um bot-do-servidor/remoto: flash branco sustentado + "pulinho" (hop + recoil que decai, sem poluir a interp) + fumaça de impacto/queda. (Servidor resolve o stun real via `staggerBot`; o atacante não recebe eco do `hit`/`meleehit`, por isso o juice é local.) |
| Stagger do bot do servidor | `server/src/ws/bots.ts` → `staggerBot()` + `server/src/ws/index.ts` | stun/fire-lock/super-interrupt server-authoritative |
| Mensagens de rede | `src/game/net/Multiplayer.ts` | `MeleeEvent`, `MeleeHitEvent` (stun opcional), `ParryEvent` + `sendParry` |
| HUD | `src/components/hud/WeaponHotbar.tsx` | rótulo do slot ("Sabre de luz") |

## Mecânicas (números canônicos)
- **Swing:** rest perpendicular (~90°) → wind-up 45° → **strike completo de 180°** (eased) que **SEGURA
  no follow-through**; o retorno ao rest é o settle suave pós-swing (não há "recovery" no meio do golpe).
  `MELEE_SWING_DUR=0.4s`, `MELEE_COOLDOWN=0.55s`, wind-up = primeiros 18%. Aim **congela** durante o swing.
- **Alcance:** `MELEE_RANGE=3.2` (dobrado); hit por segmento varrido (`MELEE_SWEEP_RADIUS=0.6`), 1× por alvo.
- **Rastro:** `SaberTrail` desenha um arco azul aditivo seguindo a lâmina (alimentado no strike, fade ~0.16s,
  `clear()` no início de cada swing pra não soldar arcos).
- **Parry de balas:** janela `SWING_PARRY_START_T(0.2)..END_T(0.75)`; reflete balas inbound (varre lâmina +
  trajeto). Balas de bot → viram do jogador. Balas de remoto → `sendHit` + `sendParry` (escudo real PvP).
- **Parry do super:** `kame.reflectInArc` reflete feixes **damaging** (super de bot local) de volta ao
  caster. Feixes **visuais** (super remoto/servidor) NÃO são refletidos (dano é autoritativo no servidor —
  evita "parry falso"; cancel autoritativo diferido). Cap próprio por swing (`REFLECT_BEAM_MAX_PER_SWING`).
- **Stun/empurrão:** hit dá um **pulinho pra trás** (kb impulse decaído + hop vertical) + **pisca branco**
  (~10Hz por toda a janela de ~1s) + trava tiro constante ~1s + **zera o carregamento do super**.
  Rate-limited (free-window) contra stun-lock; durações clampadas no receptor. Vale pro bot local e pro
  jogador (quando golpeado por sabre remoto).
- **Super dos bots locais:** agora disparam o super telegrafado (wind-up ~1s, orb de carga visível),
  dodgeable por **pulo/dash** e **parryável** — pra dar ao parry-de-super algo pra refletir offline.

## Limitações conhecidas (diferidas — ver [`../PENDENCIAS.md`](../PENDENCIAS.md))
- Parry PvP é **best-effort** sob latência (sem lag-comp; o cancelamento do tiro é por proximidade).
- Parry server-authoritative com shot-id e validação de swing estão diferidos (postura de
  anti-cheat diferida do projeto).

## Histórico
Projetado e revisado via Mega Brain (DeepSeek V4 Pro + GLM 5.2 + GPT-5.5/Codex), 2026-06-24.
Commits `feat(weapons): lightsaber melee …` + follow-ups de review.
