# Netcode — modelo de confiança (quem é autoritativo)

**Keywords:** netcode, multiplayer, online, servidor, autoritativo, broadcast, relay, hit, dano,
shield, kamehit, meleehit, parry, cue, confiança, trust, anti-cheat, shot, tiros invisíveis,
interpolação, reconciliação, dessincronização.

> Para a forma geral do sistema veja [`../ARCHITECTURE.md`](../ARCHITECTURE.md). Para a arma de
> melee veja [`weapons-melee-saber.md`](weapons-melee-saber.md). Decisões de responsividade em
> `docs/PERFORMANCE.md`.

## Regra central
O servidor (`server/src/ws`) é **relay** para quase tudo e **autoritativo** só para dano:

- **`hit`** (tipo de mensagem dedicado): o servidor resolve dano **shield-first** e emite `died`.
  É o ÚNICO caminho de dano autoritativo. Player→bot, bot→player e reflexão de parry usam `hit`.
- **`kamehit`** (evento `broadcast` interceptado): super resolvido server-side (bot ou player).
- **`meleehit`** (evento `broadcast` interceptado p/ bots): aplica stagger server-side a bots.
- **Todos os outros** (`s` snapshot, `shot`, `melee`, `meleehit`, `kame`, `dash`, `jump`,
  `parry`, …) são **`broadcast` repassados verbatim** → **cues client-trusted** (como o knockback).

Tipos client→servidor aceitos: `join`, `track`, `broadcast`, `hit`, `leave`, `ping`
(`server/src/ws/protocol.ts` → `CLIENT_TYPES`).

## Implicações (importantes)
- Estender payload de um `broadcast` (ex.: campos de stun no `meleehit`) é **transparente** —
  o servidor não parseia, só repassa. Backward-compatible.
- Cues client-trusted devem ser **clampados/rate-limited no receptor** (um peer pode forjar valores).
- Anti-cheat (validação de swing, rewind/lag-comp, parry com shot-id) está **DIFERIDO** por decisão
  do projeto (ver `docs/PERFORMANCE.md` + [[netcode-responsiveness-decision]] na memória).

## Fluxo de dano PvP (por que "tiros invisíveis" acontecem)
Balas de remotos chegam como `shot` → `spawnVisual` (NÃO-damaging) no cliente do alvo. O dano é
detectado no cliente do ATIRADOR (o alvo é um `BulletTarget` remoto lá) que envia `hit`. O servidor
aplica e ecoa HP via `hp`/`died`. Logo o alvo pode **morrer sem ver a bala** se o tracer/anim do
evento do servidor não for interpolado/animado a tempo no front. Investigar em:
`src/game/Game.ts` (handlers de `shot`/`hit`/`died`), `src/game/RemotePlayer.ts` (interp),
`src/game/net/Multiplayer.ts`/`Room.ts`, e a cadência de `s` no servidor (`server/src/ws/bots.ts`,
`index.ts`). Pendência 🔴 em [`../PENDENCIAS.md`](../PENDENCIAS.md).
