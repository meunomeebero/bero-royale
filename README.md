# Bero Royale (Cozy Killer)

Um **battle-royale free-for-all voxel em 3D** que roda no navegador. Mundinho fofo, brigas
implacáveis. Render em Three.js, multiplayer online com servidor próprio, voz por proximidade
(WebRTC) e leaderboard persistente.

🎮 Produção: **https://beroroyale.shardweb.app** (canônico `cozykiller.io`)

---

## O que é

- **Engine 3D** em Three.js (`src/game/`) rodando **fora** do React; o React só desenha o HUD.
- **Multiplayer** servidor-autoritativo via relay WebSocket (snapshots de pose a 20Hz, interpolação
  de remotos, dead-reckoning). Modo `local` (sobrevivência contra bots de IA) e `multiplayer` (FFA
  online; bots vêm do servidor).
- **Voz por proximidade** P2P (WebRTC mesh, push-to-talk em `G`).
- **Leaderboard** persistente em Postgres, ranqueado por kills/tempo-vivo.
- **Servidor único** (`server/`): um processo Node serve o SPA, a API HTTP e o WebSocket na mesma
  porta.

> Documentação de arquitetura: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) ·
> Performance/latência: [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md) ·
> Deploy/ops: [`docs/shardcloud.md`](docs/shardcloud.md) ·
> Método multi-agente ("mega brain"): [`docs/mega-brain.md`](docs/mega-brain.md) ·
> Índice de docs: [`docs/README.md`](docs/README.md)

---

## Stack

| Camada | Tecnologias |
|---|---|
| Render | **Three.js 0.184** (WebGL) |
| UI/HUD | React 19, Vite 7, TypeScript, Tailwind 3, shadcn/ui (Radix) |
| Rede (cliente) | WebSocket (`net/Room.ts`, `net/Multiplayer.ts`), WebRTC (`net/VoiceChat.ts`) |
| Servidor | Node + **Elysia** (HTTP) + lib **`ws`** (WebSocket) + **postgres.js** |
| Deploy | Shard Cloud (app Node) — ver `docs/shardcloud.md` |

---

## Desenvolvimento local

Requer **pnpm** (o repo fixa `pnpm@8.6.12`; é um workspace com `server/`).

```bash
pnpm install

# Roda cliente (:8080) + servidor (:3000) juntos. O Vite faz proxy de /api e /ws para o server,
# então as URLs são idênticas em dev e prod (same-origin).
pnpm dev:all

# Ou separadamente:
pnpm dev          # só o cliente Vite (:8080) — suficiente para o modo local/single-player
pnpm dev:server   # só o servidor Node (:3000)
```

Abra http://localhost:8080. Modo `local` funciona sem servidor; `multiplayer` precisa do server.

### Fallback offline de multiplayer
`?local` na URL usa um `LocalRoom` via `BroadcastChannel` (multiplayer entre abas do mesmo
navegador, sem servidor) — útil para testar a camada de rede.

---

## Build & deploy

```bash
pnpm build:deploy   # build:prod (cliente) + copy:spa + build:server
pnpm stage          # monta deploy/ (server.js + public) e gera o manifest shardcloud
pnpm start          # roda o build do servidor (server/dist/index.js)
```

O deploy é um **app Node** na Shard Cloud (`deploy.shardcloud`: `LANGUAGE=node`). O passo a passo
de redeploy, credenciais e *gotchas* de produção estão em [`docs/shardcloud.md`](docs/shardcloud.md).

> ⚠️ O script `pnpm build` usa `--mode development` de propósito (preview/live-edit). Para
> produção use sempre `build:prod` ou `build:deploy`.

---

## Layout do repositório

```
src/game/            engine Three.js (loop, entidades, FX, áudio) + net/ (netcode)
src/components/hud/   overlays React do HUD
src/pages/            Menu.tsx (/) e Index.tsx (/play)
server/src/           servidor Node (HTTP + WebSocket + Postgres)
public/models/        pack de assets voxel (OBJ/MTL/PNG)
docs/                 ARCHITECTURE.md, PERFORMANCE.md, shardcloud.md, planos de design
```

Convenções de código e estrutura detalhada: [`CodeGuideline.md`](CodeGuideline.md) e
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
