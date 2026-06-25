# Peso das armas → velocidade de movimento

**Keywords:** peso, weight, arma, weapon, velocidade, speed, movimento, movement, balance,
balanceamento, tiro constante, tiro concentrado, sabre, leve, pesada, run speed, multiplicador.

> Domínio: balanceamento de combate / movimento. Para a arma de melee veja
> [`weapons-melee-saber.md`](weapons-melee-saber.md); para o modelo de rede veja
> [`netcode-trust-model.md`](netcode-trust-model.md).

## O que é
Cada arma da hotbar tem um **peso** que escala a velocidade de corrida do jogador **enquanto
aquela arma está ativa**. É uma alavanca de balanceamento: o **tiro constante** é a arma mais
fraca, então seu peso leve recompensa a agressividade com mais mobilidade; o **sabre** é pesado.

## Números canônicos
| Slot | Arma | Peso | Multiplicador de velocidade |
|---|---|---|---|
| 1 | Tiro constante | leve | **×1.30** (+30%) |
| 2 | Tiro concentrado | normal | ×1.00 |
| 2 | Tiro concentrado **com super carregando/carregado** | muito pesada | **×0.80** (−20%, mais lento que o sabre) |
| 3 | Sabre de luz | pesada | **×0.90** (−10%) |
| — | boss (easter egg "bero") | neutro | ×1.00 |

## Regras
- **Super carregado pesa (nerf do kite):** enquanto o super concentrado está **carregando OU
  carregado/pronto** (`kameState !== "idle"`), o jogador anda a **×0.80 (−20%)** — _mais lento que o
  sabre_ — em vez do ×1.00 neutro. Knob próprio (`SUPER_LOADED_SPEED_MULT`), não acoplado ao sabre.
  Objetivo: punir o padrão "carrega no seguro → corre pra briga → atira → foge pra recarregar". Ele
  não pode se mover livremente enquanto segura um super carregado, nem fugir rápido enquanto
  recarrega. Vale para **carregando E pronto** (todo o tempo em que o super está comprometido), não
  só quando pronto.
- **Composição:** o multiplicador de peso **multiplica** o power-up "speed" (×1.6). Ex.: tiro
  constante + speed = `MOVE_SPEED × 1.6 × 1.3 = 2.08×`.
- **Escopo:** afeta só a **velocidade de corrida sustentada**. O **dash** (impulso fixo) NÃO é
  afetado.
- **Rede:** mudança **client-side apenas** — sem mudança de protocolo. Remotos mostram o peso
  naturalmente pela interpolação dos snapshots de posição (a velocidade já está embutida no
  movimento que eles reportam).

## Onde está o código (mapa)
| Peça | Arquivo | O quê |
|---|---|---|
| Tabela de peso | `src/game/Player.ts` → `WEAPON_SPEED_MULT` | `Record<FireMode, number>` com os multiplicadores |
| Aplicação | `src/game/Player.ts` → `update()` (cálculo de `effSpeed`) | `MOVE_SPEED × speedPowerup × weaponWeight` |
| Override super carregado | `src/game/Player.ts` → `update()` (`superLoaded`) | `fireMode === "concentrated" && kameState !== "idle"` → usa `SUPER_LOADED_SPEED_MULT` (×0.80) |
| Estado do super | `src/game/Player.ts` → `kameState` (`idle`/`charging`/`ready`) | dirige o `superLoaded` |
| Slots da hotbar | `src/game/Player.ts` → `SLOT_MODES`, `FireMode` | índice → modo de tiro |

## Histórico
- **2026-06-25** — adicionado como alavanca de balanceamento (constante fraca → mais mobilidade);
  constante iterado +10% → +20% → +30% em playtest; super carregando/carregado pesa pra nerfar o kite
  de carregar-e-fugir, iterado −10% → −20% (mais lento que o sabre). Ver
  [`../balance-log.md`](../balance-log.md).
