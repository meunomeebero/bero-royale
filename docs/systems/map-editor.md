# Map Editor — editor de mapa oficial (v1, só decor)

**Keywords:** map editor, editor de mapa, /editor, decor, decoração, árvores, props, MapDefinition,
DecorEntry, senha, password, super-user, super-usuário, persistência, active.json, snap-to-grid,
overhead, top-down, placeAt, removeAt, validateMapDef, MAP_EDITOR_PASSWORD, x-editor-password.

> Domínio: autoria do mapa único oficial. O decor autoral chega ao jogo online pelo `welcome`
> (ver [`netcode-trust-model.md`](netcode-trust-model.md) — o **seed** é o estado server-authoritative
> compartilhado; o `decor` viaja ao lado dele). Terreno (`Platform`) continua 100% derivado do seed.

## O que é
Uma rota **secreta e gated por senha** (`/editor`, não linkada — estilo `/hudlab`) onde um
**super-usuário** coloca/remove decor numa **vista de cima** (ortográfica) para **autorar o mapa único
oficial**. O mapa salvo substitui o scatter procedural para **todos** os jogadores online.

### Escopo v1 (limitado de propósito — o caminho mais fácil primeiro)
- **Só DECOR.** O **terreno não muda** — continua gerado pelo **seed** (`Platform`). O editor só
  adiciona/remove props.
- **Mapa único ativo** (um arquivo, um layout — não há lista/seleção de mapas).
- **Snap-to-grid** (uma célula = um prop). **Sem rotação** por prop (yaw fixo 0 no caminho de dados).
- **Mapa ausente/vazio ⇒ scatter seedado de sempre (zero regressão).**

## `MapDefinition` — a forma serializável
`{ version: 1, decor: DecorEntry[] }`, onde `DecorEntry = { id, asset, ix, iz }`
(`src/game/map/MapDefinition.ts`).

| Campo | Regra |
|---|---|
| `version` | exatamente `1` (qualquer outro valor ⇒ inválido) |
| `decor` | array, `length ≤ MAX_DECOR (2000)` |
| `id` | string **única**, não-vazia, **≤ 64 chars** (protege render keyed + place/delete + limita o payload) |
| `asset` | um dos **7 env props** editáveis (`ENV_PROPS`): `tree1, tree2, box1, box2, grassflower1, grassflower2, grassmushroom` |
| `ix, iz` | inteiros em `[0, GRID)` com `GRID = 180` (= `Platform.PLATFORM_GRID`) |

- `makeDecorEntry(asset, ix, iz)` gera o `id` (`d<base36 timestamp><seq>`).
- Validado **no cliente** (`validateMapDef`) e **no servidor** (`validateDef`) de forma
  **independente** — por design o servidor **NÃO importa** `src/` do cliente; a forma do wire é
  acordada por convenção e re-checada dos dois lados (corpo forjado/grande/inválido é rejeitado).

## Decor data-driven (`src/game/Decor.ts`)
`Decor` virou **data-driven + endereçável** sem regressão:
- **Construtor** `new Decor(platform, source)` aceita **um `number`** (= seed → roda o **scatter
  legado**, byte-for-byte idêntico) **OU** um **`DecorEntry[]`** (constrói exatamente essas entradas).
  As duas vias passam pelo mesmo `instantiate`, e o `welcome` sem decor ⇒ via do seed ⇒ **zero
  regressão**.
- **API endereçável** (usada pelo editor): `placeAt(asset, ix, iz)` (retorna entry ou `null` se a
  célula falhar algum gate), `removeAt(ix, iz)`, `canPlaceAt(asset, ix, iz)` (teste não-mutante que
  pinta o ghost verde/vermelho), `entryAt(ix, iz)`, `serialize()`.
- **Gates de célula** (iguais aos do scatter): célula in-bounds, **grass**, **`cellHeight === 0`** (sem
  morro), **≥ `EDGE_MARGIN (0.6)`** da borda, e **livre** (1 prop por célula). Boxes são **só do editor**
  (não aparecem no scatter); só **`tree1`/`tree2`** carregam obstáculo de bala.
- **Fonte de verdade única:** um `Map<id, DecorRecord>`; `group.children` e o array `obstacles[]` são
  **views derivadas** com as mesmas refs. **`obstacles` é mutado in-place** (push/splice), **nunca
  reatribuído** — a ref é entregue uma vez a `Bullets.setObstacles` e reatribuir quebraria a colisão.
- **`disposeObject` libera só os MATERIAIS por-instância** (o `ModelLibrary.create` faz `clone(true)`,
  então a **BufferGeometry é um template COMPARTILHADO** entre todas as instâncias do asset — dar
  dispose nela quebraria todos os outros/futuros props daquele tipo).
- Build de mundo compartilhado = `src/game/map/buildWorld.ts`: `buildWorld(scene, { seed, decor? })`
  constrói `Platform(seed)` + `Decor(platform, decor ?? seed)`, adiciona ambos à cena e devolve os
  dois. **Mesmo código no jogo e no editor.**

## O editor (cliente)
`src/pages/Editor.tsx` + `src/game/editor/MapEditor.ts` + `src/components/editor/PropPalette.tsx`:
- **Gate de senha:** card centrado → `POST /api/editor/auth`. No 200, a senha fica em **state React
  (memória)** e o canvas monta; ela é enviada como header `x-editor-password` no Save. **O gate do
  cliente é cosmético** — a regra real é re-checada no servidor a cada write.
- **Canvas overhead:** `MapEditor` é um engine Three.js **enxuto** (renderer + scene + luzes brancas
  neutras + `buildWorld` + **OrthographicCamera** olhando reto pra baixo), **sem** Player/bots/balas/
  netcode. Picking **barato**: um único **plano invisível** é o alvo do raycast → célula = inverso de
  `Platform.cellCenter` (props nunca são raycast).
- **Controles:** **clique-esquerdo** coloca/remove na célula sob o cursor; **clique-direito + arrasto**
  faz **pan** (target clampado em ±45); **roda do mouse** faz **zoom** (clamp 1.0–8.0). **Ghost**
  translúcido do prop selecionado no hover + tile de hover **verde/vermelho** indicando validade.
- **Undo/redo:** **Ctrl/Cmd+Z** desfaz, **Ctrl/Cmd+Shift+Z** refaz. Pilhas de **snapshot completo**
  (`decor.serialize()`) — a grade é pequena; undo/redo **reconstroem o `Decor`** a partir do snapshot.
- **Save:** `PUT /api/map` com `{ def: { version:1, decor: serialize() } }` + header
  `x-editor-password`; toast em 200, erro em 401/400.
- A rota é registrada em `src/router.tsx` (`/editor`, não linkada).

## Servidor (`server/src/map.ts` + `env.ts` + `index.ts`)
- **Senha:** `MAP_EDITOR_PASSWORD` (`server/src/env.ts`), default **`29981721`** só pra dev.
  **Em PROD a senha DEVE ser injetada** via `deploy.shardcloud` `CUSTOM_COMMAND` — **prepend**
  `MAP_EDITOR_PASSWORD='…'` (ver [`../shardcloud.md`](../shardcloud.md); atenção: `CUSTOM_COMMAND` tem
  teto de 250 chars). Sem injeção, prod cai no default — **trocar antes do deploy**.
- **Endpoints** (registrados em `server/src/index.ts` antes do catch-all SPA):
  - `POST /api/editor/auth` — gate de UX; 200 `{ok:true}` se `body.password` bate, senão 401.
  - `GET /api/map` — **público**; sempre 200 `{ def }` (ou `{ def: null }` se não há mapa).
  - `PUT /api/map` — header `x-editor-password` re-checado **server-side** (**a regra de verdade**);
    401 se errado, 400 se `validateDef` falhar, senão grava + 200 `{ok:true}`.
- **Persistência:** arquivo JSON **`server/public/maps/active.json`** (**gitignored** — `server/public`
  inteiro está no `.gitignore`). Em memória há o **`activeMapCache`**, semeado no boot por
  `initMapCache()` e **atualizado em todo PUT** bem-sucedido (rooms leem dele sem tocar o disco).
- **Limitação (v1):** em prod as edições persistem **no disco do container** até o **próximo redeploy
  sobrescrever `server/public`** (perde-se o `active.json` no rebuild do bundle). Aceitável pra um
  curador único "por enquanto".

## Wiring ao vivo (o decor chega ao jogo)
- O servidor inclui o `decor` do mapa ativo no payload **`welcome`**, ao lado do `seed`
  (`server/src/ws/index.ts` → `decor: activeMapCache?.decor ?? null`; tipo em
  `server/src/ws/protocol.ts`).
- O cliente lê o `decor` do welcome (`src/game/net/Multiplayer.ts`), **re-valida** com `validateMapDef`
  e alimenta `buildWorld(seed, decor)` (`src/game/Game.ts`). **Terreno ainda vem do seed.**
- **Sem mapa ativo (`decor: null`) ⇒ scatter seedado de sempre** (idêntico ao mundo de antes do
  editor existir). Decor inválido ⇒ ignorado (cai no scatter).

## Onde está o código (mapa)
| Peça | Arquivo | O quê |
|---|---|---|
| Schema + validação (cliente) | `src/game/map/MapDefinition.ts` | `MapDefinition`/`DecorEntry`, `ENV_PROPS` (7), `MAX_DECOR=2000`, `validateMapDef`, `makeDecorEntry` |
| Decor data-driven + endereçável | `src/game/Decor.ts` | construtor seed **OU** `DecorEntry[]`; `placeAt`/`removeAt`/`canPlaceAt`/`entryAt`/`serialize`; `obstacles` in-place; `disposeObject` (só materiais) |
| Build de mundo compartilhado | `src/game/map/buildWorld.ts` | `buildWorld(scene,{seed,decor?})` → `{platform,decor}` (jogo + editor) |
| Rota `/editor` | `src/router.tsx` | rota secreta não-linkada |
| Página + gate + UI | `src/pages/Editor.tsx` | gate de senha, mount do canvas, sidebar/toolbar, save/undo/redo/toast |
| Engine do editor | `src/game/editor/MapEditor.ts` | overhead ortho, pan/zoom, raycast→célula, ghost, hover verde/vermelho, undo/redo snapshot |
| Paleta de props | `src/components/editor/PropPalette.tsx` | tiles de texto/cor dos 7 env props |
| Store + handlers (servidor) | `server/src/map.ts` | `validateDef`, `readActiveMap`/`writeActiveMap`, `activeMapCache`+`initMapCache`, `authHandler`/`getMapHandler`/`putMapHandler` |
| Senha (env) | `server/src/env.ts` | `MAP_EDITOR_PASSWORD` (default `29981721`; injetar em prod) |
| Registro de rotas | `server/src/index.ts` | `POST /api/editor/auth`, `GET/PUT /api/map`, `initMapCache()` no boot |
| Decor no `welcome` (servidor) | `server/src/ws/index.ts` + `server/src/ws/protocol.ts` | `decor: activeMapCache?.decor ?? null` ao lado do seed |
| Consumo do `welcome` (cliente) | `src/game/net/Multiplayer.ts` + `src/game/Game.ts` | re-valida `decor` → `buildWorld(seed, decor)`; terreno do seed |
| Persistência (arquivo) | `server/public/maps/active.json` | mapa ativo (gitignored — `server/public` no `.gitignore`) |

## Limitações conhecidas (v1)
- **Só decor; mapa único; sem rotação por prop** (yaw 0 no caminho de dados).
- **Persistência efêmera em prod:** `active.json` mora em `server/public` (gitignored) e é
  **sobrescrito no próximo redeploy** — o curador re-salva, ou um passo futuro promove o arquivo a
  um asset versionado/DB.
- O stagger PvP e afins não se aplicam aqui (editor não roda netcode).

## Verificação
- **Playwright (headed):** fluxo auth → mount do editor → place → Save → persiste (reload carrega o
  layout), **0 erros de console**.
- **Revisado por codex/GPT-5.5.**
- Testes puros: `MapDefinition.test.ts` (cliente) + `server/test/map.test.ts` (`validateDef`).

## Histórico
- **2026-06-25/26** — Map Editor v1 entregue (plano em `docs/superpowers/plans/2026-06-25-map-editor.md`,
  8 tasks). `Decor` virou data-driven (zero regressão no scatter), `buildWorld` extraído e compartilhado,
  rota `/editor` gated, persistência em arquivo + decor no `welcome`.
</content>
</invoke>
