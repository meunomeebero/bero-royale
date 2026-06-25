# Peso das armas → velocidade de movimento

**Keywords:** peso, weight, arma, weapon, velocidade, speed, movimento, movement, balance,
balanceamento, pistol, pistola, energy blast, tiro concentrado, canalizar, channeling, lightsaber,
sabre, leve, pesada, run speed, multiplicador.

> Domínio: balanceamento de combate / movimento. Para a arma de melee veja
> [`weapons-melee-saber.md`](weapons-melee-saber.md); para a Energy Blast (super canalizado) veja
> [`weapons-energy-blast.md`](weapons-energy-blast.md); para o modelo de rede veja
> [`netcode-trust-model.md`](netcode-trust-model.md).

## O que é
Cada arma da hotbar tem um **peso** que escala a velocidade de corrida do jogador **enquanto
aquela arma está ativa**. É uma alavanca de balanceamento: a **Pistol** é a arma de run-and-gun
(leve → rápida); a **Energy Blast** é tão rápida quanto a Pistol enquanto IDLE e só fica lenta
durante o canal (custo do super); o **Lightsaber** é pesado.

## Números canônicos
| Slot | Arma | Peso | Multiplicador de velocidade |
|---|---|---|---|
| 1 | Pistol | leve | **×1.30** (+30%) |
| 2 | Energy Blast (idle / sem canalizar) | leve | **×1.30** (+30%, igual à Pistol) |
| 2 | Energy Blast **canalizando/carregada** | muito pesada | **×0.80** (−20%, mais lento que o Lightsaber) |
| 3 | Lightsaber | pesada | **×0.90** (−10%) |
| — | boss (easter egg "bero") | neutro | ×1.00 |

## Regras
- **Energy Blast rápida quando idle, lenta ao canalizar (nerf do kite):** parada/em deslocamento
  normal a Energy Blast anda à velocidade da Pistol (**×1.30**). Mas enquanto o super está
  **carregando OU carregado/pronto** (`kameState !== "idle"`), o jogador cai para **×0.80 (−20%)** —
  _mais lento que o Lightsaber_. Knob próprio (`SUPER_LOADED_SPEED_MULT`), não acoplado ao saber.
  Objetivo: a arma é livre pra se reposicionar quando não comprometida, mas pagar mobilidade no
  exato momento em que canaliza (vulnerável). Vale para **carregando E pronto** (todo o tempo em que
  o super está comprometido).
- **Composição:** o multiplicador de peso **multiplica** o power-up "speed" (×1.6). Ex.: Pistol +
  speed = `MOVE_SPEED × 1.6 × 1.3 = 2.08×`.
- **Escopo:** afeta só a **velocidade de corrida sustentada**. O **dash** (impulso fixo) NÃO é
  afetado.
- **Rede:** mudança **client-side apenas** — sem mudança de protocolo. Remotos mostram o peso
  naturalmente pela interpolação dos snapshots de posição (a velocidade já está embutida no
  movimento que eles reportam).

## Onde está o código (mapa)
| Peça | Arquivo | O quê |
|---|---|---|
| Tabela de peso | `src/game/Player.ts` → `WEAPON_SPEED_MULT` | `Record<FireMode, number>` (`pistol:1.3`, `energyBlast:1.3`, `lightsaber:0.9`) |
| Aplicação | `src/game/Player.ts` → `update()` (cálculo de `effSpeed`) | `MOVE_SPEED × speedPowerup × weaponWeight` |
| Override canalizando | `src/game/Player.ts` → `update()` (`superLoaded`) | `fireMode === "energyBlast" && kameState !== "idle"` → usa `SUPER_LOADED_SPEED_MULT` (×0.80) |
| Estado do super | `src/game/Player.ts` → `kameState` (`idle`/`charging`/`ready`) | dirige o `superLoaded` |
| Slots da hotbar | `src/game/Player.ts` → `SLOT_MODES`, `FireMode` | `["pistol","energyBlast","lightsaber"]`; índice → modo |

## Histórico
- **2026-06-25** — adicionado como alavanca de balanceamento; Pistol iterada +10% → +20% → +30% em
  playtest; Energy Blast carregando/carregada pesa pra nerfar o kite, iterado −10% → −20% (mais lento
  que o Lightsaber).
- **2026-06-25** (rename + rebalance) — nomenclatura padronizada: Pistol / Energy Blast / Lightsaber.
  A Energy Blast deixou de ser "normal (×1.00)" e passou a **×1.30 enquanto idle** (igual à Pistol),
  caindo a ×0.80 só durante o canal. Ver [`../balance-log.md`](../balance-log.md).
