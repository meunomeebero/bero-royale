# Bero Royale — Arquitetura (as-built)

Fonte de verdade **viva** sobre a forma atual do sistema. Os planos `docs/mp-sync-plan.md`
e `docs/mp-wave2-plan.md` foram **implementados** e ficam como design docs históricos; este
documento descreve o que efetivamente roda hoje. Para o roadmap de performance/latência veja
`docs/PERFORMANCE.md`; para operação/deploy veja `docs/shardcloud.md`.

> Marca/título no produto: **Cozy Killer** (`index.html`); o repositório/infra chama-se
> **Bero Royale**. São o mesmo jogo.

---

## Visão geral

Battle-royale free-for-all voxel em 3D no navegador. Um único processo Node serve o SPA, a API
HTTP e o relay de multiplayer/voz por WebSocket — tudo na mesma porta. O jogo roda inteiramente
em Three.js **fora** da árvore React; o React só desenha o HUD por cima do `<canvas>`.

```
┌─────────────────────────── Browser ───────────────────────────┐
│  React (HUD overlays)        Three.js engine (src/game/*)      │
│  src/components/hud/*  ◄──┐   Game.ts  → runLoop (rAF)          │
│                          │   Player / Bot / RemotePlayer        │
│   GameStats (setState) ──┘   Bullets / FX / Avatar / Audio      │
│                              net/ (Room, Multiplayer, Voice)    │
└───────────────┬───────────────────────────────┬───────────────┘
                │ WebSocket /ws (JSON, TCP)      │ WebRTC (voz P2P, mesh)
                ▼                                 ▼
┌──────────────────────── Node (server/) ───────────────────────┐
│  Elysia (HTTP)  ·  ws WebSocketServer  ·  postgres.js          │
│  /api/leaderboard /api/score /api/turn /api/online            │
│  /ws  → relay de presença + fan-out + sig de voz + BotSim     │
│  static.ts → SPA (com fallback de deep-link /play)            │
└───────────────────────────────────────────────────────────────┘
                │
                ▼  Postgres (leaderboard) — fora do hot path de jogo
```

---

## Cliente — engine Three.js (`src/game/`)

- **Entrada/montagem:** `src/pages/Index.tsx` (rota `/play`) instancia `new Game(container, {mode, username})`
  num `<div>`. A rota `/` é `src/pages/Menu.tsx` (input de username persistido em `localStorage`,
  cards de modo). Roteamento por array `routers` em `src/router.tsx` (páginas planas, não
  subdiretórios) — `App.tsx` só passa o array para `createBrowserRouter`.
- **Loop:** `Game.runLoop` dirige um `requestAnimationFrame` com **timestep variável**
  (`dt = min(clock.getDelta(), 1/30)`). Não há accumulator de passo fixo para o gameplay — só o
  **broadcast de rede** usa passo fixo (`1/NET_TICK_HZ`). O player local é simulado e renderizado
  no mesmo frame, **antes** de qualquer rede (client-side prediction total para si mesmo).
- **Entidades:** `Player`, `Bot`, `RemotePlayer`. Todas renderizam um `Avatar` (`Avatar.ts`) que
  **clona** templates OBJ MagicaVoxel pré-carregados por `ModelLibrary` (`ModelLibrary.ts`).
  Geometria é **compartilhada** entre clones; só materiais são clonados.
- **Mundo:** `Platform.ts` (chão via `InstancedMesh`, gerado a partir do *world seed*), `Decor.ts`
  (props), `Shadow.ts` (sombras fake = quads planos, sem shadow map). Assets em `public/models/`
  (34 modelos OBJ/MTL/PNG, ~748KB).
- **FX/partículas:** `Bullets`, `SmokePuffs`, `DustParticles`, `GrassPoof`, `Gore`, `Kamehameha`,
  `Rain`, `FogPatches`, `Butterflies`. (`Rain`/`Butterflies` usam o padrão correto de
  `InstancedMesh`/sprites pré-alocados; os demais ainda alocam por emit — ver `PERFORMANCE.md`.)
- **Áudio:** `AudioEngine.ts` (SFX procedural Web Audio). Voz por proximidade em `net/VoiceChat.ts`.
- **Modos (`GameMode`):** `local` (sobrevivência contra bots de IA), `multiplayer` (FFA online, sem
  bots de IA locais — o servidor injeta bots), `ambient` (mundo de fundo borrado do menu, com bots
  lutando + avatar em destaque).

### Threading
**Tudo na main thread:** `onmessage` da WebSocket + `JSON.parse`, matemática de interpolação,
reconciliação do React e render WebGL dividem a mesma thread. Não há Web Worker de rede nem
OffscreenCanvas. Um spike de re-render do HUD atrasa diretamente o processamento de snapshots.
(Lever estrutural no roadmap — `PERFORMANCE.md` ranks 32.)

---

## Netcode — modelo *relay* (`src/game/net/`, `server/src/ws/`)

Servidor-autoritativo via **relay puro sobre WebSocket JSON-text (TCP)**. O servidor é
autoritativo em **uma** coisa de fato (o *world seed* por sala) + HP/alive (autoridade AFK); o
resto é fan-out opaco por nome de evento.

| Constante (`src/game/consts.ts`) | Valor | Papel |
|---|---|---|
| `NET_TICK_HZ` | 20 | Taxa de broadcast do snapshot de pose `s` (50ms entre ticks) |
| `INTERP_DELAY_MS` | 80 | Remotos renderizados 80ms no passado (interpolação) |
| `EXTRAP_MAX_MS` | 180 | Janela máxima de dead-reckoning/extrapolação |
| `HEARING_RADIUS` | 5 | Raio de áudio espacial + anel de voz |
| `MOVE_SPEED` / `JUMP_VELOCITY` / `GRAVITY` | 6.5 / 6.0 / 18.0 | Física (compartilhada SP↔MP para evitar drift) |

- **Camada de transporte (`net/Room.ts`):** `createRoom(name,id)` retorna **`ServerRoom`**
  (WebSocket same-origin para `/ws?room=&id=`) por padrão; **`LocalRoom`** (BroadcastChannel,
  mesmo browser) é fallback offline opt-in via `?local`. Salas permitidas no servidor:
  `voxelcube-ffa` (jogo) e `voxelcube-voice` (sinalização de voz). Auto-reconnect com backoff
  exponencial reenviando `join`+`track`.
- **`Multiplayer.ts`:** envia o snapshot `s` (x,y,z,yaw,health,vx,vz,vy,grounded,state,charging,…)
  a 20Hz; eventos discretos one-shot (`shot`/`dash`/`jump`/`died`/`hit`/`chat`/`kill`/`kame`/
  `kamehit`) são instantâneos (bypassam o tick). Presença carrega metadados de leaderboard
  (nome/aliveSince/kills/alive).
- **`RemotePlayer.ts`:** reconstrói remotos de um buffer de 8 snapshots; interpola em `now − 80ms`
  e faz dead-reckoning por velocidade até `EXTRAP_MAX_MS`. Replica squash/stretch/lean/dash/jump e
  faz *audio inference* (footstep/jump/land/death) para remotos.
- **Hit:** **client-claimed-then-server-validated, sem rewind.** O cliente do atirador detecta o
  acerto localmente (flash instantâneo) e envia `{t:'hit',target}`; o servidor (`rooms.ts`
  `damagePlayer`) aplica **1 de dano** sem revalidação geométrica, mas **gateando para alvos vivos**
  (não é instant-kill). É um furo de cheat conhecido (dano incremental falsificável) — ver
  `PERFORMANCE.md` (seção Servidor/escala) e `docs/mp-wave2-plan.md` item 5.
- **Self:** player local nunca espera ack — movimento e balas aplicados no mesmo frame.

### Caminhos de latência (resumo — detalhe em `PERFORMANCE.md`)
- **Próprio movimento:** ~0ms de rede (piso = 1 poll do rAF).
- **Ver outros:** tick-quantize(0–50) + serialize + Nagle + relay + Nagle + parse + **80ms de
  interp**, mais HOL do TCP sob perda. É aqui que mora a latência percebida.
- **Kill confirmado:** flash instantâneo, mas crédito autoritativo espera ~1 RTT + 1 tick.

---

## Servidor (`server/`)

Workspace pnpm separado (`server/package.json`). Um único `http.Server` Node hospeda tudo:

- **`index.ts`** — monta o Elysia (adapter Node), faz bridge para `app.handle()`, e
  `attachWebSocket(server)` compartilha a mesma porta. Listen **sem hostname** (dual-stack — ver
  gotcha em `docs/shardcloud.md`).
- **`ws/index.ts`** — relay WS: parse, allowlist de tipos de frame, token-bucket (~80 frames/s),
  fan-out por sala, unicast de `sig` de voz por `to`, heartbeat, autoridade AFK de HP/alive
  (sobrescreve health/alive no relay de `s`, sweep de 1s, `GRACE_MS=45000`).
- **`ws/bots.ts`** — **BotSim** server-side a 20Hz (a única simulação real no servidor; bots de
  multiplayer vêm daqui, não do cliente).
- **`ws/rooms.ts` / `ws/protocol.ts`** — registro de presença/Player por sala e schema do protocolo.
- **`db.ts`** — postgres.js + `migrate()` idempotente (tabela leaderboard). Tocado **só** pelas
  rotas HTTP — nunca no caminho WS.
- **`leaderboard.ts` / `turn.ts` / `static.ts`** — REST de leaderboard, credenciais TURN
  (HMAC-SHA1, degrada para STUN), e SPA static com fallback `/play`.
- **Notas de latência:** `permessage-deflate` está OFF (correto). **Falta `socket.setNoDelay`**
  (Nagle ligado), backpressure (`bufferedAmount`) e gating por visibilidade — ver `PERFORMANCE.md`.

---

## Build & deploy

- **Stack:** Vite 7 + React 19 + TypeScript; Tailwind 3 + shadcn/ui (Radix) para o HUD; Three.js
  0.184 para render; `ws` + Elysia + postgres.js no servidor.
- **Scripts (`package.json`):** `pnpm dev:all` (web :8080 + server :3000 com proxy `/api` e `/ws`),
  `pnpm build:deploy` (`build:prod` + `copy:spa` + `build:server`), `pnpm stage` (monta `deploy/`
  + gera o manifest via `scripts/gen-shardcloud.mjs`), `pnpm start` (roda `server/dist/index.js`).
  ⚠️ O script `build` usa `--mode development` — para produção use `build:prod`/`build:deploy`.
- **Bundle (estado atual):** chunk único de ~1.18MB (sem code-splitting; Three.js + React + Radix +
  engine juntos), CSS ~83KB. Static handler **sem compressão**. Alvos de otimização em
  `PERFORMANCE.md` (ranks 6, 11).
- **Deploy:** app **Node** na Shard Cloud (`deploy.shardcloud`: `LANGUAGE=node`,
  `CUSTOM_COMMAND` roda `node server.js`). Runbook completo em `docs/shardcloud.md`.
  Produção: https://beroroyale.shardweb.app (canônico `cozykiller.io`).

---

## Mapa de diretórios

```
src/
  game/            engine Three.js (Game.ts, Player, Bot, RemotePlayer, Avatar, ModelLibrary,
    net/           transporte + netcode (Room, Multiplayer, VoiceChat, LeaderboardClient)
    consts.ts      constantes de física + rede compartilhadas (SP == MP)
  components/hud/   ~16 overlays React (StatsBar, KillFeed, Leaderboard, ChatPanel, MobileControls…)
  pages/            Menu.tsx (/), Index.tsx (/play), NotFound.tsx — planas + router.tsx
  components/ui/    primitivos shadcn/Radix
server/src/         Node: index, ws/*, db, leaderboard, turn, static, env
public/models/      pack de assets voxel (OBJ/MTL/PNG)
docs/               ARCHITECTURE.md (este), PERFORMANCE.md, shardcloud.md, mp-*-plan.md, sprints.md
```
