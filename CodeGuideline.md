# Code Guideline — Bero Royale

Convenções e mapa de estrutura **reais** deste repositório. Para a arquitetura completa
(netcode, servidor, fluxo de dados) veja [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
Índice de docs em [`docs/README.md`](docs/README.md); o método de orquestração multi-agente
("mega brain") usado para auditar/implementar partes deste repo está em
[`docs/mega-brain.md`](docs/mega-brain.md).

Este **não** é um app CRUD de páginas React. É um **jogo Three.js imperativo** (`src/game/`) com
um HUD React por cima e um **servidor Node** próprio (`server/`). As regras abaixo refletem isso.

## Estrutura do projeto

```
src/
  game/                 ENGINE — código imperativo Three.js, não componentes React
    Game.ts             orquestrador + runLoop (rAF). Núcleo do jogo.
    Player.ts Bot.ts RemotePlayer.ts   entidades
    Avatar.ts ModelLibrary.ts          modelos voxel (clones OBJ, geometria compartilhada)
    Bullets.ts + *FX (Smoke/Dust/Gore/Kamehameha/Rain/Fog/Butterflies/GrassPoof)
    Platform.ts Decor.ts Shadow.ts     mundo (gerado a partir do world seed)
    AudioEngine.ts      SFX procedural Web Audio
    consts.ts           constantes de física + rede COMPARTILHADAS (SP == MP)
    rng.ts              mulberry32 + hash determinístico (mundo a partir do seed)
    net/                netcode
      Room.ts           transporte (ServerRoom WebSocket / LocalRoom BroadcastChannel)
      Multiplayer.ts    snapshots de pose + eventos one-shot + presença
      VoiceChat.ts      voz por proximidade (WebRTC mesh)
      LeaderboardClient.ts  REST /api/leaderboard + /api/score
  components/
    hud/                ~16 overlays React do HUD (StatsBar, KillFeed, Leaderboard, ChatPanel,
                        MobileControls, Crosshair, …) — desenhados SOBRE o <canvas>
    ui/                 primitivos shadcn/Radix
  pages/                Menu.tsx (/) · Index.tsx (/play) · NotFound.tsx — PLANAS (1 arquivo cada)
  router.tsx            array `routers` (NÃO <Route> JSX); App.tsx só passa pro createBrowserRouter
  lib/ hooks/           utilitários e hooks React
server/src/             servidor Node: index, ws/*, db, leaderboard, turn, static, env
public/models/          pack de assets voxel (OBJ/MTL/PNG)
docs/                   ARCHITECTURE.md, PERFORMANCE.md, shardcloud.md, planos de design
```

> Páginas são arquivos **planos** (`pages/Menu.tsx`), registradas no array `routers` de
> `src/router.tsx`. Não há subdiretórios de página com `index.tsx` nem `<Route>` em `App.tsx`.

## Regras específicas do engine (`src/game/`)

- **A ponte React↔jogo é unidirecional e enxuta.** O jogo empurra um `GameStats` para o HUD; o HUD
  **não** dirige o jogo. Evite acoplar estado de jogo a `useState` que re-renderiza por frame —
  isso compete com o render loop. Prefira escrita imperativa via `ref` para coisas de alta
  frequência (ex.: crosshair). Ver `docs/PERFORMANCE.md`.
- **Sem alocação no hot path.** Nada de `new THREE.Vector3()` (ou Quaternion/Color/Array/objeto)
  dentro de `update()`/loop. Use campos *scratch* reutilizáveis com `.set(...)`. Alocação por frame
  = GC hitch = stutter.
- **Geometria/material/textura compartilhados NÃO se dispõem por entidade.** Templates de
  `ModelLibrary`/módulos de FX são compartilhados entre clones; chamar `geometry.dispose()` neles
  corrompe todas as outras entidades vivas. Disponha só o que a entidade **possui**.
- **Determinismo SP == MP.** Física e tuning vêm de `consts.ts`; geração de mundo vem de `rng.ts`
  semeado pelo *world seed* do servidor. Não duplique constantes nem use `Math.random` para o mundo.
- **Pooling/instancing para o que se repete.** Partículas, balas e props recorrentes devem usar
  `InstancedMesh`/pool (veja `Rain.ts`/`Butterflies.ts` como referência), não 1 mesh por item.

## Regras do netcode (`src/game/net/`, `server/src/ws/`)

- **Self é client-predicted; nunca espere ack do servidor** para aplicar movimento/tiro local.
- **Remotos são interpolados** (`now − INTERP_DELAY_MS`) a partir de um buffer de snapshots; só
  empurre um snapshot novo no buffer quando o pacote for **genuinamente novo** (guard de sequência).
- **O servidor é um relay** (+ autoridade de seed e HP/alive). Novos eventos one-shot só precisam de
  um nome de evento — o fan-out já é por nome opaco. Mantenha o caminho quente (`s` + eventos) sem
  trabalho bloqueante e sem tocar Postgres.

## Boas práticas gerais

- **TypeScript** em todo lado; tipos de rede espelhados entre cliente (`net/`) e
  `server/src/ws/protocol.ts` — mudança de formato de fio exige deploy coordenado.
- **Naming:** `PascalCase` para componentes/classes de jogo; `camelCase` para funções/utilitários.
- **Comentários:** documente o *porquê* de matemática não-óbvia (física, interpolação) no topo do
  módulo. Mantenha-os atualizados — comentários com números de linha cruzados tendem a derivar.
- **Arquivos de jogo são grandes por natureza** (um engine não é "1 componentinho por arquivo"):
  organize por responsabilidade de subsistema, não por contagem de linhas.
