# Arma corpo a corpo — Lightsaber (hotbar slot 3)

**Keywords:** lightsaber, sabre, saber, melee, corpo a corpo, slot 3, staff (chave legada),
swing, baseball, parry, reflexão de projéteis, reflect, deflect, deflexão, impact spark, faísca,
dano puro, hotbar.

> Domínio: combate / arma de melee. Para visão geral do combate veja
> [`../ARCHITECTURE.md`](../ARCHITECTURE.md); para netcode veja
> [`netcode-trust-model.md`](netcode-trust-model.md).
>
> ⚔️ **Atualização 2026-06-26:** o **stun voltou ao sabre** + nova mecânica de **clash (bloqueio)**,
> coerentes em **todo contexto** (bots agora usam sabre). A regra de negócio + a matriz de autoridade
> + os números vivem em **[`saber-clash-and-stun.md`](saber-clash-and-stun.md)** — este doc cobre o
> swing/parry base.

## O que é
A 3ª arma (slot 3 da hotbar). A `FireMode` é `"lightsaber"`; o item é um **sabre de luz** que
flutua à frente do cubo (sem mão). Substituiu o antigo bastão de madeira.

**Histórico de balance:** em 2026-06-25 o stun foi **removido** do sabre (era OP) e migrou pra Energy
Blast. Em **2026-06-26** o stun **voltou** ao sabre (freeze + trava tiro + interrompe o canal) com
contrapeso de **clash + dash**, e as duas armas atordoam — ver
[`saber-clash-and-stun.md`](saber-clash-and-stun.md). Além do stun, o valor do sabre é a **deflexão**
de balas/super e o dano corpo-a-corpo.

## Onde está o código (mapa)
| Peça | Arquivo | O quê |
|---|---|---|
| Mesh do sabre | `src/game/PigParts.ts` → `buildSaber()` | hilt + guarda + lâmina emissiva ciano + glow aditivo + `tip` |
| **Cinemática do swing (compartilhada)** | `src/game/saberKinematics.ts` | **Única fonte da verdade** do arco: `sampleSaberYaw()`, `saberMountX()`, `MELEE_SWING_DUR`, `SABER_REST_YAW`, etc. Importada por `Player` E `RemotePlayer` → o swing do remoto é **idêntico** ao do dono (regra de ouro de fidelidade). |
| Rastro de luz (arco azul) | `src/game/SaberTrail.ts` | ribbon (triangle-strip) aditivo azul ao longo da lâmina varrida; `clear()` por swing. Alimentado por `Game` (jogador local) **e por cada `RemotePlayer`** (um `SaberTrail` por remoto, mesh adicionado à cena por `Game`). |
| Animação + input | `src/game/Player.ts` | usa `saberKinematics` (wind-up 45° → strike 180° que SEGURA no follow-through; o retorno é o settle pós-swing), montagem dinâmica que nunca toca o corpo, `MeleeSample`, freeze de aim durante o swing |
| **Render do sabre no remoto (fidelidade)** | `src/game/RemotePlayer.ts` → `updateHeldWeapon()`, `triggerSwing()` | monta `buildGun()`+`buildSaber()` num `aimGroup`; mostra a arma ativa pelo campo `weapon` do snapshot; toca o swing completo (mesma cinemática) + `SaberTrail` + smoke de fim de swing; recuo da arma no tiro |
| Resolução de hit/parry + netcode + trail | `src/game/Game.ts` → `handleMeleeSample()` | hit varrido por sub-passos (`MELEE_DAMAGE` + impact spark), parry de balas (`bullets.reflectInArc`) E de super (`kame.reflectInArc`), alimenta `SaberTrail`, handler `parry`. **Não** aplica stun nem envia `meleehit` (migrou para a Energy Blast) |
| Projéteis + reflexão | `src/game/Bullets.ts` → `reflectInArc()`, `cancelOwnedNear()` | reverte balas, varre trajeto da bala, gate vertical/inbound, `shooterId`/`reflections` |
| Super (mega tiro) + reflexão | `src/game/Kamehameha.ts` → `reflectInArc()` | reflete feixes **damaging** que cruzam a lâmina (reverte + re-owna → voltam pelo `onHit`); pula visuais (autoritativo no servidor); bot super é **dodgeable por pulo** |
| Mensagens de rede | `src/game/net/Multiplayer.ts` | `MeleeEvent` (swing → arco no remoto), `ParryEvent` + `sendParry`; campo `weapon` (`"gun"\|"saber"\|"blast"`) no snapshot `NetState` → qual arma o remoto segura. (`MeleeHitEvent` com stun ainda existe, mas hoje só o usa a Energy Blast.) |
| HUD | `src/components/hud/WeaponHotbar.tsx` | rótulo do slot ("Lightsaber") |

## Mecânicas (números canônicos)
- **Swing:** rest perpendicular (~90°) → wind-up 45° → **strike completo de 180°** (eased) que **SEGURA
  no follow-through**; o retorno ao rest é o settle suave pós-swing (não há "recovery" no meio do golpe).
  `MELEE_SWING_DUR=0.4s`, `MELEE_COOLDOWN=0.55s`, wind-up = primeiros 18%. Aim **congela** durante o swing.
- **Dano:** `MELEE_DAMAGE=3` HP por swing, hit por segmento varrido (`MELEE_SWEEP_RADIUS=0.6`), 1× por
  alvo por `swingId`.
- **Impacto no acerto (COM stun — 2026-06-26):** knockback + **blink branco** (`SABER_IMPACT_FLASH=0.6s`)
  + **fumaça branca** + **mini-stun** (`MELEE_STUN=0.25s` freeze, `MELEE_FIRE_LOCK=1.0s` trava tiro,
  **interrompe a canalização da Energy Blast**). Aplicado em todo contexto (`bot.applyMeleeStagger`,
  `player.applyMeleeStagger`, `sendMeleeHit`→receptor com clamps, server `staggerBot`). **Clash**
  (cruzar lâminas) bloqueia o acerto. Detalhes + matriz: [`saber-clash-and-stun.md`](saber-clash-and-stun.md).
- **Alcance:** `MELEE_RANGE=3.2` (dobrado).
- **Rastro:** `SaberTrail` desenha um arco azul aditivo seguindo a lâmina (alimentado no strike, fade ~0.16s,
  `clear()` no início de cada swing pra não soldar arcos).
- **Parry de balas (deflexão):** janela `SWING_PARRY_START_T(0.2)..END_T(0.75)`; reflete balas inbound
  (varre lâmina + trajeto). Balas de bot → viram do jogador. Balas de remoto → `sendHit` + `sendParry`
  (escudo real PvP). Cap por swing (`REFLECT_MAX_PER_SWING`).
- **Parry do super:** `kame.reflectInArc` reflete feixes **damaging** (super de bot local) de volta ao
  caster. Feixes **visuais** (super remoto/servidor) NÃO são refletidos (dano é autoritativo no servidor —
  evita "parry falso"; cancel autoritativo diferido). Cap próprio por swing (`REFLECT_BEAM_MAX_PER_SWING`).
- **Fidelidade no online (regra de ouro):** os oponentes veem o sabre **montado** (slot 3), o
  **swing completo de 180°** (mesma cinemática do dono), o **rastro azul** e a **fumaça** de fim de
  swing. Também veem a **arma** (gun) montada e o **recuo** no tiro, e a **bala refletida** voltando no
  parry. Ver [`netcode-fidelity-golden-rule.md`](netcode-fidelity-golden-rule.md).

## Limitações conhecidas (diferidas — ver [`../PENDENCIAS.md`](../PENDENCIAS.md))
- Parry PvP é **best-effort** sob latência (sem lag-comp; o cancelamento do tiro é por proximidade).
- Parry server-authoritative com shot-id e validação de swing estão diferidos (postura de
  anti-cheat diferida do projeto).
- A orientação do swing no remoto usa a direção do evento `melee` (congelada); o corpo segue o `yaw`
  interpolado — pode divergir por ~1 frame no início do swing (autocorrige). Sem impacto de gameplay.

## Histórico
- Projetado e revisado via Mega Brain (DeepSeek V4 Pro + GLM 5.2 + GPT-5.5/Codex), 2026-06-24.
  Commits `feat(weapons): lightsaber melee …` + follow-ups de review.
- **2026-06-25** (rename + rebalance) — renomeado para **Lightsaber** (`FireMode "lightsaber"`); **stun
  removido** (era OP) e migrado para a Energy Blast.
- **2026-06-25 (v2, playtest)** — o **knockback + blink branco + fumaça** no acerto **voltaram** (a
  pancada satisfatória), mas **continua SEM stun** (não trava tiro nem interrompe o canal da vítima).
  `SABER_IMPACT_FLASH=0.6s`, client-side (`applyStaggerVisual`/`bot.flash`, sem `meleehit`). Ver
  [`weapons-energy-blast.md`](weapons-energy-blast.md) e [`../balance-log.md`](../balance-log.md).
