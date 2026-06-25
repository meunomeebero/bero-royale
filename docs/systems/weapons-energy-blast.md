# Energy Blast — super canalizado (hotbar slot 2)

**Keywords:** energy blast, super, mega tiro, kamehameha, canalizar, channel, channeling, carregar,
charge, bare-handed, sem arma, mão livre, stun, stagger, fire-lock, interromper super, knockback,
flash, stun, fire-lock, knockback, slot 2.

> Domínio: combate / arma 2 (super canalizado). Para peso/velocidade veja
> [`weapons-weight-speed.md`](weapons-weight-speed.md); o stun migrou do
> [`weapons-melee-saber.md`](weapons-melee-saber.md) (Lightsaber) para cá; dano é
> server-authoritative — ver [`netcode-trust-model.md`](netcode-trust-model.md).

## O que é
A 2ª arma da hotbar (`FireMode "energyBlast"`): um **super canalizado**. O jogador **segura** o tiro
para CANALIZAR e **solta** quando pronto para disparar o feixe (estilo Kamehameha). É uma arma de
**alto risco / alta recompensa**: durante o canal você está **lento e exposto**, mas um acerto
**STAGGERA** a vítima (knockback + flash + stun que interrompe o canal dela e trava o tiro).

**Bare-handed (sem arma na mão):** a Energy Blast **não segura nada** — canaliza de mãos vazias. O
mesh da gun fica **escondido**, mas o feixe ainda sai do **anchor da ponta do cano** (a transform do
anchor não é afetada pela visibilidade). Nos remotos o campo `weapon: "blast"` faz o oponente
**não mostrar arma nenhuma** (fidelidade: você vê o oponente de mãos livres canalizando).

## Números canônicos
| Parâmetro | Valor | Onde |
|---|---|---|
| Tempo de canal (charge → ready) | `KAME_CHARGE = 3.0s` (voltou pra 3.0 — 1.5 ficou forte demais) | `Player.ts` |
| Dano (server-authoritative, **não** insta-kill) | `SUPER_DAMAGE = 3` | `Game.ts` / servidor |
| Knockback no acerto | `MELEE_KNOCKBACK = 16` | `Game.ts` |
| Stun (freeze de ação) | `MELEE_STUN = 0.25s` | `Game.ts` / `Player.ts` |
| Fire-lock (trava tiro constante) | `MELEE_FIRE_LOCK = 1.0s` | `Game.ts` / `Player.ts` |
| Interrompe canal/super da vítima | sim (`interruptCharge = true`) | `applyMeleeStagger(..., true)` |
| Velocidade canalizando | **×0.80** (−20%, mais lento que o saber) | `SUPER_LOADED_SPEED_MULT` |
| Velocidade idle (sem canalizar) | **×1.30** (+30%, igual à Pistol) | `WEAPON_SPEED_MULT.energyBlast` |

## Regras
- **Modelo de movimento:** rápida quando idle (igual à Pistol, ×1.30), lenta só enquanto canaliza
  (×0.80). Custo de mobilidade no exato momento vulnerável. Ver
  [`weapons-weight-speed.md`](weapons-weight-speed.md).
- **Stun-on-hit (migrou do Lightsaber):** um acerto STAGGERA a vítima — `applyKnockback` +
  `applyMeleeStagger(MELEE_STUN, MELEE_FIRE_LOCK, true)`: pulinho/knockback, flash branco, freeze
  breve, **interrompe o canal** dela e trava o tiro constante ~1s. Vale offline (bot local), e
  online via os caminhos `setKameHitHandler` (vítima local) e `onKameHit` (bots/remotos).
- **Dano autoritativo:** o stagger é um **cue client-trusted**; o **dano (SUPER_DAMAGE=3) é resolvido
  no servidor** (`kamehit` shield-first, HP empurrado via `hp`/`died`). Dois acertos matam — **não é
  insta-kill**. Durações de stun são clampadas no receptor (anti stun-lock).
- **Indicação de canal:** apenas a **barra de carga** sob o slot 2 da hotbar (`WeaponHotbar`). O
  overlay de texto **"Channeling…" foi REMOVIDO** (rejeitado em playtest — poluía a tela).

## Onde está o código (mapa)
| Peça | Arquivo | O quê |
|---|---|---|
| FireMode + slot | `src/game/Player.ts` → `FireMode "energyBlast"`, `SLOT_MODES[1]` | arma 2 da hotbar |
| Tempo de canal | `src/game/Player.ts` → `KAME_CHARGE = 1.5` | charge → ready |
| Bare-handed (esconde a gun) | `src/game/Player.ts` → `setFireMode()` | `gun.visible = pistol\|boss` → escondida na Energy Blast; o anchor do cano ainda dá a origem do feixe |
| Velocidade idle vs canal | `src/game/Player.ts` → `WEAPON_SPEED_MULT.energyBlast` (1.3), `SUPER_LOADED_SPEED_MULT` (0.8) | ver weapons-weight-speed |
| Feixe / VFX do super | `src/game/Kamehameha.ts` | carga (orb) + feixe damaging + `onHit` |
| Stun + dano (offline / local-bot) | `src/game/Game.ts` → `onKameHit()` | `SUPER_DAMAGE` + `applyKnockback` + `applyMeleeStagger(..., true)` no jogador/bot sobrevivente |
| Stun da vítima local (online) | `src/game/Game.ts` → `setKameHitHandler()` | knockback + flash + stun que interrompe nosso canal |
| Stagger visual de remoto (atacante) | `src/game/Game.ts` → `onKameHit()` (ramo RemotePlayer) | `applyMeleeStagger` visual + `sendKameHit` (dano server-authoritative) |
| Snapshot `weapon: "blast"` | `src/game/Game.ts` (mapeia `energyBlast → "blast"`) + `src/game/net/Multiplayer.ts` → `NetState.weapon` | remoto não mostra arma |
| Barra de carga + rótulo do slot | `src/components/hud/WeaponHotbar.tsx` | "Energy Blast" + fill sob o slot 2 (overlay de texto "Channeling…" removido) |

## Limitações conhecidas (diferidas — ver [`../PENDENCIAS.md`](../PENDENCIAS.md))
- O stagger PvP é **best-effort** sob latência (cue client-trusted + clamps no receptor; sem
  lag-comp). Dano e morte continuam autoritativos no servidor.

## Histórico
- **2026-06-25** (rename + rebalance) — a antiga "tiro concentrado" virou **Energy Blast**: passa a
  **não segurar nada** (mãos livres; `weapon: "blast"`), fica **rápida quando idle** (×1.30) e só
  lenta ao canalizar, e ganhou o **stun-on-hit** que migrou do Lightsaber. Dano server-authoritative
  (`SUPER_DAMAGE=3`).
- **2026-06-25 (v2, playtest)** — canal **voltou pra 3.0s** (o −50% deixou a arma forte demais) e o
  **overlay de texto "Channeling…" foi removido** (poluía a tela; ficou só a barra de carga do slot).
  Ver [`../balance-log.md`](../balance-log.md).
