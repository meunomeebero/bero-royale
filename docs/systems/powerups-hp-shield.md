# Power-ups ↔ HP/escudo (autoridade + sincronização)

**Keywords:** powerup, power-up, putake, heal, cura, shield, escudo, super, speed, rapid, dash, HP,
vida, hitpoints, autoritativo, sincronização, hp event, snapshot, desync, morrer com escudo, cura some.

> Autoridade de dano: [`netcode-trust-model.md`](netcode-trust-model.md). Power-ups do servidor:
> `server/src/ws/powerups.ts` (`PowerUpSim`). HP/escudo autoritativos: `server/src/ws/rooms.ts`.

## Regra de autoridade
O **servidor é autoritativo** para `health` e `shield` (`rooms.ts` `Player`). O **cliente prediz**
todo efeito de power-up na hora (no `"putake"`) e **reconcilia** com a verdade do servidor por:
- **`"hp"`** (unicast ao dono, `syncOwnerHP`) — emitido a cada mutação de HP/escudo; o cliente roteia
  pra `Player.setHealthShield` que **sobrescreve** `health`+`shield` locais.
- **`"s"`** (snapshot relay) — o servidor sobrescreve `health`/`alive` (NÃO o `shield`) antes do fan-out.

**Princípio inegociável:** todo power-up que mexe em HP/escudo **tem que mutar o estado do servidor** —
senão o próximo `"hp"` reverte a predição do cliente.

## Aplicação por kind
| Kind | Server | Cliente | Observação |
|---|---|---|---|
| `shield` / `super` | `hub.addShield` (escudo +1, cap `MAX_SHIELD`) | `Player.applyShield` | `super` é repurposed como escudo |
| `heal` | **`hub.healPlayer`** (HP→`MAX_HEALTH`) | `Player.heal` (→ `getMaxHealth`) | server-autoritativo desde o fix abaixo |
| `speed` / `rapid` / `dash` | — (nenhum) | buff client-only | não tocam HP/escudo; sem canal de reconciliação |

## Bugs corrigidos (2026-06-24)
1. **"Cura some após 1 tiro":** o servidor **não aplicava `heal`** (só `addShield`); o HP autoritativo
   ficava sem cura e o 1º `damagePlayer` sincronizava o valor antigo de volta. **Fix:** `RoomHub.healPlayer`
   (espelha `addShield`) + ligado no pickup de `heal` em `powerups.ts`. Sem mudança de cliente.
2. **"Morro e continuo com escudo":** (a) `Player.die()` **não zerava** `shieldPoints` (só `serverKilled`/
   `respawn`) → pip de escudo num cadáver via morte prevista localmente; (b) `Player.applyShield` **sem
   guarda de vivo** (o `addShield` do server tem) → `"putake"` tardio re-armava escudo num morto.
   **Fix:** `die()` virou o **chokepoint único** que zera o escudo; `applyShield` early-return se `state!=="alive"`.

## Follow-ups conhecidos (deferidos — validar o núcleo primeiro)
- **Race B (escudo "não protegeu"):** se o cue `"hit"` local chega ANTES do `"putake"` do escudo, o cliente
  soa o dano no HP e **prevê a morte** localmente; depois `setHealthShield` ignora o eco autoritativo
  (`state!=="alive"`). Fix correto (mais arriscado): permitir reviver de uma morte mal-prevista quando o eco
  trouxer `health>0`, e/ou tornar o cue `"hit"` local **presentation-only** (deixar o `"hp"` ser a única
  autoridade de HP/escudo). Toca o modelo de morte/revive — fazer com cuidado e teste.
- **Boss-mode cap:** `getMaxHealth()` = `MAX_HEALTH*BOSS_HP_MULT` (30) no cliente vs flat 10 no server →
  desync por frame pra boss online. Carregar a flag de boss no join meta + cap por jogador no server.
- **Escudo fora do `"s"`:** escudo só chega por `"hp"` (unicast, no-op em grace) — não se auto-cura pelo
  snapshot como o HP. Opcional: carregar `shield` no `"s"`.

## Mapa de arquivos
| Arquivo | Papel |
|---|---|
| `server/src/ws/powerups.ts` | `PowerUpSim`: spawn + detecção de pickup → `addShield`/`healPlayer` + fanout `"putake"` |
| `server/src/ws/rooms.ts` | `Player{health,shield}`, `damagePlayer` (shield-first), `addShield`, **`healPlayer`**, `syncOwnerHP` |
| `src/game/Player.ts` | predição: `heal`, `applyShield` (guarda de vivo), `applyDamage` shield-first, `die` (zera escudo), `setHealthShield` (reconcilia) |
| `src/game/Game.ts` | handlers `putake`/`hp`/`died`; aplica power-up local |
