<!--
  Gerado por auditoria multi-agente (19 agentes, 84 findings, 12 subsistemas) em 2026-06-19.
  Fonte de verdade para o roadmap de performance/latência. Pareie com docs/ARCHITECTURE.md.
  NOTA: números de linha (file:NNN) são aproximados — do estado no momento da auditoria.
  Prefira buscar pelo símbolo/identificador citado; a estrutura é estável, as linhas derivam.
-->

# Auditoria de Performance — Bero Royale

Relatório de engenharia priorizado. Foco nº 1 do dono: **latência online percebida próxima de zero**. Segundos próximos: FPS/GC-hitch do cliente e tempo de carga.

---

## Resumo executivo (maiores ganhos)

- **`socket.setNoDelay(true)` no servidor é o conserto de melhor relação alavancagem/custo**: hoje o Nagle pode segurar frames pequenos (`s`/shot/hit) por até ~40ms na pior hipótese, em cada perna (upload e download). Uma linha em `server/src/ws/index.ts:67-95` elimina esse stall. Importante: esses ~40ms são **pico de pior caso** (sender esperando ACK atrasado sem dados em voo); num stream estável de 20Hz com eventos one-shot frequentes, o atraso típico incorrido é bem menor e intermitente. O ganho real é **eliminar spikes de até ~40ms por perna**, não uma economia fixa por ação.
- **Teto de transporte (o maior ponto cego para "near zero"):** o canal quente roda **WebSocket sobre TCP**. Mesmo com `setNoDelay`, sob **qualquer perda de pacote** o TCP faz *head-of-line blocking*: o snapshot perdido trava **todos** os snapshots posteriores (que já o superam) até o retransmit — exatamente o tradeoff errado para um relay de estado, onde snapshot velho deveria ser **descartado**, não esperado. Para o objetivo nº 1, o lever de maior teto é mover o canal quente (`s` + eventos one-shot) para um transporte **não-confiável/não-ordenado** (WebRTC DataChannel em modo unreliable, ou WebTransport/QUIC datagrams), mantendo WS/TCP só para chat/presence/handshake. O split fanout/Multiplayer já isola o canal quente, o que torna isso viável (`server/src/ws/index.ts`, `Room.ts`). Esforço grande, mas é o único lever que ataca os spikes de latência em links móveis com perda — que nenhum ajuste de Nagle/interp resolve.
- **`INTERP_DELAY_MS=80` fixo é o maior contribuinte de latência *redutível* no transporte atual**: todo remoto é renderizado 80ms no passado. A 20Hz bastam ~1 tick + jitter (~40-50ms). Baixar para uma almofada adaptativa de ~40-45ms reduz o atraso **do valor fixo atual (80ms) para a almofada residual (~40-45ms)** — ou seja, **~35-40ms percebidos a menos** ao ver movimento/mira de cada oponente (`RemotePlayer.ts:542`, `consts.ts:43`). (A almofada residual continua existindo por design; o ganho é o delta entre 80ms e ela.)
- **Bug de buffer de interpolação corrompe a suavidade**: `rp.setState()` é chamado a 60Hz sobre um Map que só guarda o último pacote, então cada pacote real de 50ms é empurrado ~3x com timestamps diferentes e x/y/z idênticos. Isso colapsa a janela de ~400ms para ~130ms e gera micro-stutter (`Game.ts:1200` + `RemotePlayer.ts:211`). Conserto pequeno (guard de sequência), **0ms de latência adicional**, remotos visivelmente mais suaves — o que o dono lê como "lag".
- **Cliente: re-render React acoplado ao mousemove é o maior custo de FPS em estado estável** — `setCursor` re-renderiza toda a árvore HUD a cada evento de mouse (60-1000Hz) em `Index.tsx:157`. Mover o crosshair para escrita imperativa via ref elimina 100% dessa reconciliação durante a mira.
- **Carga: bundle único de 1.18MB sem code-splitting + servidor sem compressão** — `dist/assets/index-*.js` é 1.182.599 bytes (328KB gz) e `server/src/static.ts` serve tudo sem `Content-Encoding`. Comprimir + lazy-load do engine tira ~600KB de three.js do caminho crítico do menu e economiza **~1.2MB por carga fria**.
- **Bug crítico de correção:** `Avatar.dispose()` chama `geometry.dispose()` na geometria de template **compartilhada** (`Avatar.ts:94-100`), corrompendo todos os outros avatares vivos do mesmo animal sempre que um player/bot/remoto sai. Some/quebra modelos no meio da partida.

> **Nota de metodologia (importante):** Todos os números de draw-call, sort de transparência e "% de trabalho de fragmento" abaixo são **estimativas de análise estática**, não baseline medido. Não há captura de `renderer.info.render.calls`, perfil de frame-time, nem flamegraph neste relatório. Antes de executar os fixes de FPS/draw-call (ranks 4, 12, 13), **instrumentar `renderer.info.render` (calls/triangles) + um HUD de frame-time rolante** e capturar em device mid-tier para estabelecer baseline e validar antes/depois. As estimativas são direcionalmente úteis para priorizar, mas não substituem medição.

---

## Arquitetura "as-built"

**Cliente (Three.js).** O jogo roda inteiramente fora do React: `Index.tsx:223` monta um `Game` Three.js num `<div>` e `Game.runLoop` (`Game.ts:1437-1668`) dirige um `requestAnimationFrame` com **timestep variável** (`dt = min(clock.getDelta(), 1/30)`, `Game.ts:1451`). Não há accumulator de passo fixo para gameplay — só o broadcast de rede usa passo fixo. Entidades (Player, Bot, RemotePlayer) renderizam um `Avatar` (`Avatar.ts`) que clona templates OBJ MagicaVoxel pré-carregados por `ModelLibrary` (`ModelLibrary.ts`); a geometria é compartilhada entre clones (bom), só materiais são clonados. Sombras são quads planos fake (`Shadow.ts`), sem shadow map. O chão usa `InstancedMesh` (`Platform.ts`); decor (240 props) **não** é instanciado. **Toda a thread principal é compartilhada** entre o `onmessage` da WebSocket + `JSON.parse`, a matemática de interpolação, a reconciliação do React e o render WebGL — não há OffscreenCanvas nem worker de rede.

**Netcode (modelo relay).** Modelo servidor-autoritativo via **relay puro sobre WebSocket JSON-text (TCP)**. O player local é totalmente client-predicted: `player.update()` aplica movimento e spawna balas localmente (`Game.ts:1493`, `Player.ts:645-648,830`) **antes** de qualquer rede (`Game.ts:1511`). O snapshot de pose (`s`) é enviado a `NET_TICK_HZ=20` (`Game.ts:1147-1172`), cada um ~286B de JSON re-incluindo UUID+name+animal a cada tick. Remotos são reconstruídos em `RemotePlayer.ts` a partir de um buffer de 8 snapshots, renderizados `INTERP_DELAY_MS=80` no passado, com extrapolação dead-reckoning até `EXTRAP_MAX_MS=180`. Eventos discretos (shot/dash/jump/died/chat/kill/kame) são instantâneos. Hit é **client-claimed-then-server-validated** sem rewind: o cliente do atirador detecta o hit localmente e envia `{t:'hit',target}`; o servidor aplica 1 de dano sem re-validação geométrica (`rooms.ts:220-233`), mas **gateando para alvos vivos** (não é instant-kill). Existe um `ping`/`pong` de aplicação stubbado (`index.ts:205-207`) e um heartbeat TCP `ws.on("pong")` (`index.ts:213`) — o RTT medido ainda não é fiado na interpolação.

**Servidor.** Um único `http.Server` Node hospeda a API HTTP Elysia, o static do SPA e o relay WS `ws` na mesma porta (`server/src/index.ts`). A camada WS (`server/src/ws/index.ts`) é quase um relay JSON puro: parse, allowlist de 6 tipos, token-bucket (80 frames/s), fan-out. A **única** simulação no servidor é a de bots (`bots.ts`), 20Hz. Postgres (`db.ts`) só é tocado pelas rotas HTTP de leaderboard, nunca no caminho WS (correto). permessage-deflate está OFF (correto para latência). **Não** há `TCP_NODELAY`, nem tratamento de backpressure/`bufferedAmount`, nem batching de frames, nem detecção de socket idle ligada a visibilidade.

**Build.** Vite 7 + React 19, config quase default (`vite.config.ts:32-34`: só `outDir`). Sem `manualChunks`, sem `import()` dinâmico — three.js (~600KB) + React + Radix + engine colapsam num único chunk de 1.18MB. Assets em `public/models`: 34 modelos OBJ/MTL/PNG verbosos (748KB, 328KB de texto OBJ). Deploy como app Node (`deploy.shardcloud`: `LANGUAGE=node`), static handler artesanal sem gzip/brotli.

---

## Latência (a seção mais importante)

### Caminho crítico

- **SELF (própria ação → própria tela):** já no piso de hardware. `InputManager` captura `justPressed` sem debounce (`InputManager.ts:80-94`); `player.update()` aplica velocidade e spawna balas no mesmo frame, **antes** da rede (`Game.ts:1493,1511`). Piso = um gap de poll do rAF (≤16,7ms) + render. **Nada a melhorar aqui — não regredir** (nunca aguardar ack do servidor antes de aplicar movimento local).
- **VER OUTROS (oponente age → minha tela):** tick-quantize(0-50ms) + JSON.stringify + Nagle(pico 0-40) + relay-CPU + Nagle(pico 0-40) + JSON.parse + 80ms de interp-behind, **mais qualquer stall de HOL do TCP sob perda**. É aqui que mora toda a história de latência.
- **HIT/MORTE (eu atiro → kill confirmado):** flash do hit é instantâneo localmente (`RemotePlayer.ts:143`), mas o kill-confirm autoritativo espera **1 RTT completo + até 1 tick** porque o crédito é observado num frame `s` posterior dentro da janela de 2s (`Game.ts:1250-1266`).

### Tabela de orçamento de latência (ao ver outros)

| Hop | est ms | Redutível | Como |
|---|---|---|---|
| Quantização do tick remoto (próxima borda de 50ms, `Game.ts:1150-1153`, `NET_TICK_HZ=20`) | 0-50 (~25 avg) | Sim | Subir para 30Hz (33ms, ~17 avg) no canal de posição; eventos one-shot já bypassam o tick (`Game.ts:1176-1184`). Retornos decrescentes acima de 30Hz. |
| `JSON.stringify` do snapshot `s` (~286B, sender) (`Room.ts:165-169`) | ~0.5-2 | Sim | Pack binário (slot-index uint8 + float32 pose) → ~28B, remove o encode; parar de reenviar id/name/animal (chavear por `from`, `index.ts:172`). |
| **Nagle no upload (sem `setNoDelay`)** (`server/src/ws/index.ts:67-95`) | **pico 0-40 (intermitente, não fixo)** | **Sim** | **`socket.setNoDelay(true)` no upgrade handler. Conserto trivial; elimina o spike de pior caso, não uma taxa fixa por frame.** |
| **HOL blocking do TCP sob perda** (canal `s` em WS/TCP, `server/src/ws/index.ts`, `Room.ts`) | **0 em link limpo; dezenas-centenas de ms em burst de perda (mobile)** | **Sim (só trocando de transporte)** | **Mover canal quente `s`+one-shot para DataChannel unreliable / WebTransport datagrams. Snapshot velho passa a ser dropado em vez de bloquear o novo. `setNoDelay` NÃO resolve isto.** |
| Propagação up (cliente→servidor) | 5-40 (~RTT/2) | Não | Físico; só edge POPs ajudam. |
| Server inbound: `raw.toString()`+`JSON.parse` antes de qualquer reject barato (`index.ts:117-146`) | ~0.5-2 | Sim | Throttle antes do parse; parsear o Buffer direto; frame binário remove a maior parte do parse. |
| Server fanout: 1 `JSON.stringify` + loop síncrono de `.send`, sem guarda de `bufferedAmount` (`rooms.ts:361-369`) | ~0.5-3 (cresce com sala) | Sim | Pular sockets com `bufferedAmount` alto (snapshot velho é superseded); batch player+bot em um frame. |
| **Nagle no download** (mesmo socket, `server/src/ws/index.ts`) | **pico 0-40 (intermitente)** | **Sim** | Mesmo `setNoDelay(true)` cobre as duas direções (é por-socket). |
| Propagação down (servidor→eu) | 5-40 (~RTT/2) | Não | Físico. |
| Meu `JSON.parse` + `remote.set` (`Room.ts:107-113`, `Multiplayer.ts:268-281`) | ~0.5-2 | Sim | Decode binário em struct tipada remove o parse por snapshot. |
| Quantização do frame de render (`getRemoteStates` só consumido 1x/rAF, `Game.ts:1195-1200`) | 0-16.7 (~8 avg) | Não | Limitado pela cadência de 60fps. |
| Contenção main-thread (net+parse+interp+React+WebGL na mesma thread) | variável (spikes durante re-render HUD) | Sim (estrutural) | Mover net/decode para worker (SharedArrayBuffer ring) e/ou render via OffscreenCanvas; desacopla cadência de frame do jank de JS. |
| **`INTERP_DELAY_MS` render-behind (now-80ms)** (`RemotePlayer.ts:542`, `consts.ts:43`) | **80 (fixo, todo remoto)** | **Sim (até a almofada residual ~40-45ms)** | **Interp adaptativo a partir de jitter/RTT medido (fiar o ping/pong stubbado em `index.ts:205`, `Room.ts:133`). Em link limpo a almofada cai a ~40-45ms → ganho líquido ~35-40ms.** |
| Corrupção do buffer pelo re-push a 60Hz (janela ~400ms→~130ms, micro-stutter) (`RemotePlayer.ts:211-212`, `Game.ts:1200-1245`) | ~2-de-3 frames em segmento plano + step duro | Sim | Carimbar cada `NetState` com `recvSeq` em `onMessage.s` e só chamar `setState` em pacote novo. **0ms de latência adicional**, restaura o glide suave. |

### Levers de latência ranqueadas

1. **`socket.setNoDelay(true)` em todo socket WS upgraded** — `server/src/ws/index.ts:67-95`. Desliga Nagle nas duas pernas. **Elimina spikes de até ~40ms/perna** (não uma economia fixa por ação). Esforço **trivial**. Risco **nenhum** (mais pacotes na rede, que é o tradeoff desejado).
2. **`INTERP_DELAY_MS` adaptativo (almofada ~40-45ms)** — `RemotePlayer.ts:542`, `consts.ts:43`. **~35-40ms percebidos a menos** (delta entre o fixo de 80ms e a almofada residual). Esforço **médio**. Risco: delay baixo demais sob jitter causa stutter — clampar 35-90ms e crescer com jitter medido. **Depende de antes consertar o bug de re-push** para que o buffer seja real.
3. **Push em `snaps` só em pacote genuinamente novo (guard de `recvSeq`)** — `Multiplayer.onMessage.s` + early-return no loop de reconcile `Game.ts:1200`. **0ms de latência, mas remove o stutter de ~2-de-3 frames** e ~40 allocs de snapshot/s/remoto. Melhora *percebida* direta. Esforço **pequeno**. Risco baixo (manter o respawn-teleport limpo quando seq reseta, `RemotePlayer.ts:200`).
4. **Transporte unreliable para o canal quente (DataChannel/WebTransport)** — `server/src/ws/index.ts`, `Room.ts`. Remove o HOL do TCP sob perda; é o **único lever que abaixa o teto em links móveis com loss**. Esforço **grande** (novo path de sinalização/handshake; fallback p/ WS). Risco médio-alto (compatibilidade, complexidade). Lever de maior **teto** para o objetivo nº 1; recomendado como trabalho estrutural depois dos quick wins.
5. **Pack binário do canal `s` + dropar id/name/animal redundante** — `Room.ts:165-184`, chavear por `from` (`index.ts:172`). ~286B→~28-32B. **-2 a -6ms CPU/frame** no relay+recv (compõe com N peers) e ~5KB/s/cliente de upload. Esforço **médio**. Risco: mudança de formato de fio exige deploy coordenado cliente+servidor (versionar/handshake).
6. **Gatear broadcasts idle/dead + batch do fanout bot/player** — `Game.ts:1153-1172`, `rooms.ts:356-369`, `bots.ts:593`. Previne jitter de relay de dezenas de ms por saturação de CPU numa sala de 64 sockets. Esforço **pequeno**. Risco: idle gating precisa de heartbeat (~1s) para não podar AFK.
7. **Hitack unicast imediato ao atirador com HP pós-hit** — `index.ts:186-196`. **-até ~50ms (1 tick)** na responsividade de kill-confirm/feed. Esforço **médio**. Risco: deduplicar contra o caminho `s`-observado (`Game.ts:1250`) para não contar kill em dobro.

### Análise de piso

Com os levers redutíveis do transporte atual aplicados (setNoDelay on, interp adaptativo, buffer seq-gated, frames binários, tick 30Hz), o piso realista para **ver outros** é ≈ tick-quantize(~17ms) + serialize/parse(~1ms) + RTT(~10-40ms, irredutível) + render-quantize(~8ms) + interp-cushion(~40-45ms residual) = **~75-110ms**, dos quais ~40-45ms é a almofada de interpolação inerente e ~10-40ms é RTT físico. Hoje o mesmo caminho é ~130-200ms por causa do interp fixo de 80ms, dos spikes de Nagle e do stutter do re-push. **Ressalva:** esse piso pressupõe link limpo — sob perda de pacote no transporte TCP, o HOL adiciona spikes que **nenhum** desses ajustes remove (só a troca de transporte do lever 4).

**Por que "near zero" é impossível nesta arquitetura:** três pisos duros se somam. (1) **Interpolação** renderiza o remoto no passado de propósito (esconder spacing de 20Hz e jitter) — almofada que se troca contra suavidade. (2) **RTT** é física. (3) **O transporte TCP** impõe HOL sob perda — irredutível enquanto o canal quente for WS/TCP; só migra para DataChannel/WebTransport. **Para ir abaixo do piso de interp** seria preciso: (a) **predição de remotos** (extrapolação forward do pacote mais novo via velocidade — o branch já existe como fallback em `RemotePlayer.ts:564-571`), renderizando ~now em vez de now-80ms, ao custo de snap-back em mudanças de direção (mitigar com decay de velocidade + o `posError` existente); (b) para hits, **lag compensation server-side** (ring buffer + rewind do alvo na validação do ray — hoje `damagePlayer` não valida geometria, `rooms.ts:220`), exigindo time-sync via o ping/pong stubbado. Alvo pragmático: setNoDelay + interp adaptativo + buffer seq-gated chegam aos ~75-110ms barato; o transporte unreliable abaixa o **teto** sob perda; predição de remotos é opcional depois se ainda parecer laggy.

---

## Performance do cliente (FPS / GC hitches)

> Os números de draw-call e "% de fragmento" desta seção são estimativas estáticas — ver nota de metodologia no topo. Instrumentar `renderer.info` antes de executar os fixes correspondentes.

### Piores alocações por frame
Padrão recorrente em todo subsystem: `new THREE.Vector3(...)` no hot path. Hoistar para campos/scratch reutilizáveis com `.set()`:
- **Player local:** `updateAim()` aloca `new Raycaster` + `new Plane` + `Vector3` todo frame (`Player.ts:481-484`); `getMoveVector()` aloca `new Vector3` por poll (`InputManager.ts:189-209`, chamado em `Player.ts:550,799`); squash/stretch/shake alocam 1-3 `Vector3`/frame (`Player.ts:704,708,711,728`). **~300-420 allocs/s** só no player local.
- **Remotos:** `computeTargetPos()` aloca `new Vector3` sempre (`RemotePlayer.ts:535`); squash/airborne/hit-shake 1-2 (`395,399,402,423`); `getVelocityXZ` aloca (`309`). **~1.500-3.600 Vector3/s com 8-15 remotos**, somado ao churn de snapshots duplicados do bug de re-push.
- **Bots/Bullets (local/ambient):** `Bot.update` aloca ~5 `Vector3`/frame (`Bot.ts:357,549,554,557,572`); `Bullets.update` aloca `new Vector3` por bala por frame no loop de colisão (`Bullets.ts:250-254`).
- **Game.ts updateMultiplayer:** anchor de charge `new Vector3` por remoto carregando, por frame (`Game.ts:1287`); FX dash/jump/land/step alocam por evento (`1305-1356`).

### Draw-calls / instancing
- **Decor: 240 props clonados individualmente + 240 quads de sombra** = **estimado** ~480 draw calls (`Decor.ts:85-130`), quando há só ~8 modelos distintos. **Não verificado contra `renderer.info`**, e three.js não faz auto-merge de clones, então é um teto plausível mas não confirmado — **inclusive falta confirmar se o decor é renderizado durante o gameplay ou só no mundo ambiente do menu**. Se confirmado, bucketar por modelo em `InstancedMesh` (padrão já provado em `Platform.ts:165-184`) colapsa para ~16 draw calls.
- **Pixel ratio sem cap:** `setPixelRatio(window.devicePixelRatio)` sem `Math.min` (`Game.ts:184-185`), ao contrário das previews (`CharacterStage.ts:54`, `PlayerPreview.ts:41` que capam em 2). Capar em 2 (1.5 no mobile) + `powerPreference:'high-performance'`. **Ressalva:** o "~55% menos trabalho de fragmento" só vale **se** o device for 3x-DPR **e** a cena for fragment-bound. Numa cena voxel simples, com antialias off e sem shadow maps, o gargalo pode ser vertex/draw-call ou CPU na main thread — caso em que capar DPR rende bem menos. É um ganho device- e bottleneck-específico; **medir antes de tratar como "o maior ganho de FPS mobile".**
- **Bullets não instanciados** (1 mesh/bala) e **bots não batcheados** (avatar+gun+shadow+label separados).

### Pooling de partículas
6 dos 8 sistemas de FX usam o pior padrão: 1 Mesh por partícula + `new Material()` + `new Color()` por emit, `dispose()` por morte. **Rain (`Rain.ts`) e Butterflies (`Butterflies.ts`) são a referência correta** (InstancedMesh / sprites pré-alocados).
- **SmokePuffs** (mais frequente): cada tiro spawna 7 meshes+materiais (`SmokePuffs.ts:34-39,78-83`); a 8 tiros/s = ~56 par/s por atirador, ~224/s numa briga de 4. Pool + InstancedMesh.
- **Gore:** 20-48 meshes+materiais num único frame por morte (`Gore.ts:34-73`) — hitch exatamente quando o player quer suavidade. 4 InstancedMesh (uma por tamanho).
- **Kamehameha:** ~100 cubos/s por feixe ativo (`Kamehameha.ts:253-276`). Pool em InstancedMesh.
- **DustParticles** (cor constante `#efe0c8`, deveria compartilhar 1 material) e **GrassPoof** (4 cores → 4 materiais compartilhados) — `DustParticles.ts:20-41`, `GrassPoof.ts:42-70`.
- Renderer fica com `sortObjects=true` default — cada partícula transparente entra no sort por frame; instanciar tira do sort.

### Decoupling React-HUD
- **`mousemove`→`setCursor` re-renderiza toda a árvore HUD a cada evento (60-1000Hz)** — `Index.tsx:61,157,166,570`. Crosshair só consome `cursor.x/y`. **Conserto crítico, esforço pequeno:** renderizar o crosshair uma vez e escrever `el.style.transform` direto via ref, sem `setState`.
- **`notifyStats` dispara ~20x/s ao carregar o special** porque `chargeC = Math.round(progress*100)` muda 100x num hold de 5s (`Game.ts:1637,1647`). Cada disparo: `setStats` + re-render full HUD + `buildLeaderboard()` (spread+sort) + `buildRoster()` (array+sort), tudo numa ação latency-sensitive. Quantizar grosso (5-10%) ou dirigir a barra imperativamente via ref.
- **Estado HUD monolítico sem memoização:** um `useState<GameStats>` (`Index.tsx:64`); zero `React.memo`/`useMemo` em `src/components/hud/*`. Cada tick re-renderiza toda a árvore. Splittar em slices + `useSyncExternalStore` ou `React.memo` com props primitivas.
- **`buildRoster`/`buildLeaderboard` alocam arrays novos todo tick** (`Game.ts:892-921,926-967`), quebrando memoização por desigualdade referencial. Cachear e só recomputar quando presence muda; emitir num canal separado mais lento (2-4Hz).
- **Contenção main-thread é amplificadora:** como net/parse/interp/React/WebGL dividem a thread, um spike de re-render do HUD **atrasa diretamente** o processamento de snapshot e o pacing de frame. Os fixes de HUD acima reduzem essa contenção; o lever estrutural (worker de net/decode + OffscreenCanvas) a elimina.

### Lifecycle de visibilidade (aba em background) — defeito omitido
Não há **nenhum** tratamento de `visibilitychange`/`document.hidden`/`visibilityState` em `src/` nem `server/` (grep confirma zero ocorrências). Quando o player coloca a aba em background (alt-tab, segundo monitor), o browser throttla o rAF para ~1Hz: o cap de `mpBroadcastAccum` (`Game.ts:1220`) evita um burst de catch-up, mas o player ainda emite poses congeladas/velhas, e no refocus `clock.getDelta()` retorna um dt enorme clampado a 1/30. Enquanto isso, **todo outro cliente segue simulando aquele avatar** com dead-reckoning até `EXTRAP_MAX_MS=180` e depois dá um snap duro — rubber-banding/teleporte visível para todos que observam o AFK, mais relay desperdiçado. Não há detecção server-side de idle ligada a isso. **Conserto:** gatear broadcast por `document.visibilityState` no `runLoop`/`Multiplayer`; opcionalmente marcar socket idle no servidor via heartbeat perdido (`index.ts:213`). Distinto do idle-gating de banda (rank 15) — este é lifecycle/correção.

---

## Tempo de carga / bundle

| Conserto | Onde | Economia quantificada |
|---|---|---|
| **Comprimir assets (brotli/gzip) no static handler** | `server/src/static.ts:82-92` (sem `Content-Encoding`) | JS 1.18MB→328KB (-854KB), CSS 83KB→14KB (-69KB), OBJ 328KB→59KB (-269KB) ≈ **-1.2MB por carga fria** (~2.4s a 4Mbps). Pré-comprimir `.br`/`.gz` no build + negociar `Accept-Encoding`. |
| **Code-splitting + lazy game engine** | `vite.config.ts:32-34` (só `outDir`); `Menu.tsx:5-6`, `Index.tsx:15-16` importam `Game` estático; `Game.ts:1` `import * as THREE` | Menu TTI cai de ~328KB-gz blocking para ~60-90KB-gz; difere ~600KB de three.js do caminho crítico. **~0.5-1.5s de first-paint do menu em mobile mid-tier**. `manualChunks` (`vendor-three`/`vendor-react`) + `React.lazy(import('@/game/Game'))`. |
| **Desacoplar background ambiente do menu** | `Menu.tsx:45-72`, `ModelLibrary.ts:64-77` | Menu pinta com a UI pequena; iniciar `Game` ambiente + `ModelLibrary.preload` só após first-paint (requestIdleCallback); pular em reduced-data. Remove ~600KB do caminho crítico do menu. |
| **OBJ/MTL texto → GLB+Draco/meshopt** | `public/models` (748KB, 328KB OBJ texto); `ModelLibrary.ts:79-91` | GLB+Draco corta geometria voxel para ~20-40% (328KB→~80-130KB) e elimina parse ASCII na main thread; merge de atlas colapsa ~102 requests em poucos. |
| **`preload()` carrega todos os 34 modelos (102 requests) antes do first render** | `ModelLibrary.ts:70-77`, `Index.tsx:124`, `Menu.tsx:51` | Splittar em set crítico (tiles env + animal escolhido) + stream do resto; buscar modelo de remoto ao chegar o join, não upfront. Time-to-first-playable cai proporcional, sobretudo em links de alta latência (request count domina). |
| **Remover 2º link de fonts (Inter/Poppins/Roboto, 100-950) injetado** | `vite-plugin-enter-dev/dist/index.js:473`; `tailwind.config.ts:77-81` só usa Baloo 2/Fraunces/Hanken | Remove 1 request cross-origin render-blocking + ~30 font-faces nunca usados (1 DNS+TLS RTT). |
| **Garantir build de produção** | `package.json:8` `build` = `NODE_ENV=development vite build --mode development` | React prod + minify/DCE removem **100-200KB** vs dev build. `build:deploy` já encadeia `build:prod` (ok); renomear/remover o `build` dev para não vazar. Pinar `build.target` (es2020). |
| **Adicionar `vite-plugin-compression` + visualizer** | `vite.config.ts:7-12,25` | Brotli pré-comprimido: JS ~270KB, OBJ ~55KB no fio sem CPU por-request no servidor. |

---

## Servidor / escala

- **`setNoDelay` (ver Latência)** é também o conserto de servidor de maior prioridade entre os quick wins.
- **Transporte unreliable para o canal quente (ver Latência, lever 4)** é o trabalho estrutural de servidor de maior teto: WS/TCP sofre HOL sob perda; mover `s`+one-shot para DataChannel/WebTransport mantém WS só para chat/presence/handshake.
- **Backpressure ausente** — todo send só checa `readyState===OPEN`, sem `bufferedAmount` (`rooms.ts:347-372`). Um socket lento acumula fila ilimitada em memória e atrasa a entrega aos sockets saudáveis depois dele no loop. Pular/dropar sockets com `bufferedAmount` acima de ~64KB (snapshot velho é superseded). Bound de memória até o cap de 512 sockets.
- **Fanout de bots O(bots×recipients)** — cada bot faz seu próprio `JSON.stringify` no tick (`bots.ts:593`, `rooms.ts:356-364`). Numa sala cheia (64 sockets) ≈ 80k sends/s + 1280 stringify/s. Batchar todos os snapshots de bot num único frame (1 serialize + R sends em vez de B serializes + B×R sends); estender batching aos frames `s` de players.
- **`broadcastPresence` reconstrói o roster inteiro (players+bots) em cada join/leave/`track`** (`rooms.ts:295-350`) — `track` é reenviado pelo cliente em todo welcome/respawn/kill. Debounce (~250ms) + skip quando byte-idêntico ao último; não broadcastar presence em updates de meta de rotina.
- **Parse antes de reject barato** — `raw.toString()`+`JSON.parse` em todo frame antes do token-bucket (`index.ts:117-119`). Aplicar token-bucket por contador de frame antes do parse; parsear Buffer direto. Definir `maxPayload` explícito (16-32KB; default é 100MB — gap de DoS).
- **Bot loop 20Hz acorda o event loop mesmo com servidor vazio** (`index.ts:231-262`). Gatear o intervalo (criar no 1º join / limpar no último leave) para idle ≈ zero CPU. `tick` é O(bots²) interno mas negligível a `MIN_COMBATANTS=5`.
- **Detecção de socket idle por visibilidade** (ver seção cliente) — quando o player background a aba e congela poses, marcar o socket como idle (via heartbeat perdido em `index.ts:213`) para que o servidor pare de relayar pose velha e sinalize aos peers, evitando dead-reckoning de um avatar parado.
- **Hit registration é furo de cheat, não só de latência** — `damagePlayer` aplica dano por `id` sem validação geométrica (`rooms.ts:220`), confiando no id/aim do cliente. **Pertence a uma seção de segurança/correção.** Mitigantes reais: o servidor **gateia para alvos vivos** e aplica só **1 HP**, então **não é instant-kill arbitrário** — é dano incremental falsificável, não one-shot. (A face de latência — o offset de 80ms+ping na mira causando tiros desperdiçados — continua válida e é tratada pelo interp adaptativo.) Fix de fundo: lag compensation com rewind.
- **Postgres corretamente fora do hot path WS** (`db.ts`) — manter. Só HTTP de leaderboard toca; `getTop` (`db.ts:88`) faz sort por falta de índice composto — adicionar índice em `(kills DESC, alive_seconds DESC, ended_at DESC)` (impacto só em latência HTTP de leaderboard, não realtime).
- **permessage-deflate OFF é correto** para latência — manter.
- **WebRTC voice é mesh O(N²)** (`VoiceChat.ts:485-520`) — 8 players = 28 conexões globais, 7 pipelines de decode por cliente. Gatear `createPeer` por `HEARING_RADIUS`+margem (derrubar conexões de longe) reduz custo por-cliente de O(N) para O(vizinhos audíveis), tipicamente 1-3. Longo prazo: SFU.

---

## ROADMAP priorizado (impacto-por-esforço, quick wins primeiro)

| Rank | Mudança | Categoria | Impacto | Esforço | Risco |
|---|---|---|---|---|---|
| 1 | `socket.setNoDelay(true)` em todo upgrade WS (`server/src/ws/index.ts:67-95`) | Latência | Elimina spikes de até ~40ms/perna (pico, não taxa fixa) | Trivial | Nenhum |
| 2 | Guard de `recvSeq`: push em `snaps` só em pacote novo (`Multiplayer.onMessage.s` + `Game.ts:1200`, `RemotePlayer.ts:211`) | Latência/GC | Remove stutter de ~2-de-3 frames + ~40 allocs/s/remoto; restaura janela 400ms | Pequeno | Baixo (respawn-teleport) |
| 3 | Crosshair imperativo via ref, fora do React (`Index.tsx:61,157,166,570`) | FPS | Remove reconciliação full-HUD por mousemove (60-1000Hz) | Pequeno | Nenhum |
| 4 | Capar `setPixelRatio(Math.min(dpr,2))` + `powerPreference:'high-performance'` (`Game.ts:184-185`) — **medir bottleneck antes** | FPS | Ganho device/bottleneck-específico (até ~55% só se fragment-bound em 3x-DPR) | Trivial | Nenhum |
| 5 | **NÃO** dispor geometria compartilhada em `Avatar.dispose()` — só materiais (`Avatar.ts:94-100`) | Correção | Elimina modelos sumindo/corrompendo no meio da partida + re-uploads de GPU | Pequeno | Nenhum |
| 6 | Comprimir assets (brotli/gzip) no static handler (`server/src/static.ts:82-92`) | Carga | -1.2MB/carga fria (~2.4s a 4Mbps) | Pequeno | Nenhum |
| 7 | Gatear broadcast por `visibilityState` (cliente) + marcar socket idle no servidor (`Game.ts:1437-1668`, `Multiplayer.ts`, `index.ts:213`) | Latência/Correção | Acaba rubber-banding/teleporte do AFK p/ observadores + relay desperdiçado | Pequeno | Baixo |
| 8 | `INTERP_DELAY_MS` adaptativo (almofada ~40-45ms) (`RemotePlayer.ts:542`, `consts.ts:43`) — **após rank 2** | Latência | ~35-40ms percebidos a menos ao ver oponentes | Médio | Médio (clampar 35-90ms) |
| 9 | Hoistar scratch Vector3 nos hot paths (Player/RemotePlayer/Bot/Bullets/Game) | GC | Remove ~centenas-milhares de allocs/s; corta hitches | Pequeno | Nenhum |
| 10 | Throttle/split `notifyStats` (canal rápido HP/charge vs lento leaderboard/roster) + quantizar charge (`Game.ts:1637-1660,892-921`) | FPS/GC | Remove ~20 re-renders full-HUD/s no charge + 2 arrays+2 sorts/frame | Pequeno | Nenhum |
| 11 | Code-splitting + lazy game engine + background ambiente diferido (`vite.config.ts`, `Menu.tsx`, `Index.tsx`) | Carga | -600KB do caminho crítico; -0.5-1.5s first-paint menu | Médio | Baixo |
| 12 | Backpressure guard (`bufferedAmount`) no fanout (`rooms.ts:347-372`) | Escala/Latência | Bound de memória; impede slow client degradar peers | Pequeno | Baixo |
| 13 | Pool/instanciar partículas churny (Smoke/Gore/Dust/Grass/Kamehameha) usando Rain como referência | FPS/GC | Remove ~200+ allocs/s sob fogo; burst de 48 por kill → 4 draw calls | Médio | Baixo |
| 14 | Instanciar decor (240 props + sombras) via `InstancedMesh` (`Decor.ts:85-130`) — **confirmar com `renderer.info` se é desenhado no gameplay** | FPS | ~480→~16 draw calls (estimativa não-verificada) | Médio | Baixo |
| 15 | Pack binário do canal `s` + dropar id/name/animal (`Room.ts:165-184`, `index.ts:172`) | Banda/Latência | ~286B→~28B; -5KB/s/cliente; -2 a -6ms CPU/frame | Médio | Médio (deploy coordenado) |
| 16 | Gatear broadcasts idle/dead + batch fanout bot/player (`Game.ts:1153-1172`, `bots.ts:593`, `rooms.ts:356-369`) | Escala | 5-10x menos serializes/syscalls em sala cheia | Pequeno | Baixo (heartbeat) |
| 17 | Memoizar HUD (React.memo + props primitivas / useSyncExternalStore) + refs estáveis de roster/leaderboard (`Index.tsx`, `Game.ts:892-921`) | FPS/GC | -70-90% de DOM diffs por tick | Médio | Baixo |
| 18 | Debounce/consolidar resize+orientation (3 pares → 1, matchMedia) (`Index.tsx:70-85`, `useIsMobile.ts:46-62`) | FPS | Remove re-render storms no mobile | Pequeno | Nenhum |
| 19 | Hitack unicast imediato ao atirador (`index.ts:186-196`) | Latência | -até ~50ms no kill-confirm/feed | Médio | Médio (dedup) |
| 20 | Splittar `ModelLibrary.preload` (crítico vs lazy) + GLB/Draco (`ModelLibrary.ts:70-91`) | Carga | ~102 requests → poucos; geometria a ~20-40% | Médio-Grande | Médio |
| 21 | `NET_TICK_HZ` 20→30 no canal de posição (`consts.ts:41`) | Latência | -8ms avg de tick-quantize | Trivial | Baixo (banda) |
| 22 | Garantir prod build / `build.target` (`package.json:8`) + `maxPayload` no WS (`index.ts:52`) | Carga/Escala | -100-200KB; bound de parse | Trivial | Nenhum |
| 23 | Token-bucket antes do parse + parsear Buffer direto (`index.ts:117-119`) | Escala | -1 alloc/frame (~1280/s sala cheia) | Pequeno | Baixo |
| 24 | Gatear bot interval quando sala sem players (`index.ts:231-262`) | Escala | Idle ≈ zero CPU | Pequeno | Baixo |
| 25 | Distance/frustum culling de remotos/bots/partículas (`Game.ts:1495-1504,1200-1362`) | FPS | Custo cai proporcional a entidades off-screen | Médio | Baixo |
| 26 | Gatear voice mesh por proximidade (`VoiceChat.ts:485-520`); throttle `updateProximity` ~12Hz | Escala/FPS | O(N)→O(vizinhos audíveis); -4-6x trabalho de proximidade | Médio | Médio |
| 27 | Vizinhança/pré-warm de voice + paralelizar `/api/turn` (`VoiceChat.ts:111-128,225-238`) | Latência | -centenas de ms no first-talk | Médio | Médio |
| 28 | Cachear noise buffer único do `playExplosion` (`AudioEngine.ts:205-211`) + pool de nós | GC | Remove alloc de ~13k floats por kill | Pequeno | Baixo |
| 29 | Reconnect imediato no 1º close + baixar cap do backoff 5s→2s (`Room.ts:153-163`) | Latência | -até ~4.5s em queda transitória | Pequeno | Baixo |
| 30 | Vazamentos: name-label CanvasTexture do Bot + material da gun (`Bot.ts:145-152,645-652`, `Player.ts:843`) | Memória | ~64KB GPU/bot vazado; material/entidade | Trivial | Nenhum |
| 31 | Índice composto no leaderboard `(kills,alive_seconds,ended_at) DESC` (`db.ts:88`) | Escala | Sort→index scan (só HTTP) | Pequeno | Nenhum |
| 32 | Worker de net/decode (SharedArrayBuffer ring) + avaliar OffscreenCanvas (`Game.ts:184`, `Room.ts` onmessage) | Latência/FPS | Desacopla parse/interp/render do jank de React; remove contenção main-thread | Grande | Médio-Alto |
| 33 | **Transporte unreliable do canal quente** (DataChannel/WebTransport p/ `s`+one-shot; WS só p/ chat/presence) (`server/src/ws/index.ts`, `Room.ts`) | Latência (maior teto) | Remove HOL do TCP sob perda — único lever que abaixa o teto em mobile com loss | Grande | Médio-Alto |
| 34 | Accumulator de passo fixo (60Hz) para gameplay (`Game.ts:1451,1493-1495`) | Correção | Remove divergência de movimento por framerate; menos snaps de reconciliação | Grande | Médio |

**Notas de merge de duplicatas:** os achados de Vector3 por-frame de `net-client`, `game-loop`, `player-input`, `remote-interp`, `bullets-bots` foram consolidados no rank 9. O cap de DPR aparece em `game-loop` e `render-models` (rank 4). O re-push de snapshot aparece em `net-client`, `remote-interp` e na análise de caminho crítico (rank 2). `INTERP_DELAY` adaptativo aparece em `net-client` e `remote-interp` (rank 8). O ping/pong stubbado é pré-requisito do interp adaptativo. **Itens estruturais de maior teto (ranks 32-34)** são trabalho de médio prazo após os quick wins — alta alavancagem para o objetivo nº 1 mas alto custo/risco. **Sobre dead code:** o saving de bundle de remover `buildPig`/`TextureFactory.ts` foi **removido do roadmap** — com esbuild minify + tree-shaking (default do `build:prod` do Vite), módulos não-referenciados normalmente caem, então a economia de bytes em produção é provavelmente ~0. Vale como higiene de código, não como ganho de carga. **Não-redutível / não-acionável:** RTT físico, quantização de render a 60fps e a almofada de interpolação residual (deixados de fora por design). **Pendência de medição:** ranks 4, 13, 14 dependem de baseline de `renderer.info`/frame-time antes da execução.

---

## Docs a atualizar (staleness)

- **README.md e CodeGuideline.md** — boilerplate cru do Enter.pro; não descrevem o jogo Three.js nem o servidor WS. Recomendação: **reescrever ambos**. README: o que é Bero Royale, fluxo pnpm (`dev:all`, `build:deploy`/`stage`), split cliente/servidor, deploy Shard Cloud. CodeGuideline: virar doc de arquitetura refletindo `src/game/`, `src/game/net/`, `src/components/hud/`, `server/` — remover exemplos dashboard/profile e o padrão `<Route>` no App.tsx que não existem.
- **docs/shardcloud.md** — metade inferior **stale/contraditória**: ainda descreve deploy estático-NGINX (`pnpm build`→`dist/`, `LANGUAGE static`, "/play 404 fix later") contradizendo o próprio topo. O deploy real é Node (`LANGUAGE=node`, `node server.js`), com SPA fallback já implementado em `server/src/static.ts`. Reescrever a metade inferior para descrever só o app Node; topo está correto. Anotar que deploys node-mode precisam comprimir in-app.
- **docs/sprints.md** — **stale**: descreve multiplayer via "Supabase Realtime" e `net/supabaseClient.ts`, que não existem mais. Hoje é servidor Node WS customizado (`server/src/ws/index.ts`, sala `voxelcube-ffa`) + leaderboard Postgres. Marcar como histórico superado ou atualizar GOAL/ARCHITECTURE NOTES/S3.
- **docs/mp-sync-plan.md e docs/mp-wave2-plan.md** — **acurados** (cada claim load-bearing verificado contra o código), mas não descrevem mais o escopo total (faltam kamehameha, kill feed, server BotSim, `REVIVE_FALLBACK_MS`, campos `charging`/`chargeT`). Recomendação: manter como planos históricos com banner "IMPLEMENTADO — ver ARCHITECTURE.md" e **criar `docs/ARCHITECTURE.md`** como fonte de verdade viva (incluir: transporte WS/TCP atual e o roadmap de transporte unreliable, lifecycle de visibilidade, modelo de threading da main thread).
- **Comentários in-code stale a corrigir:** `RemotePlayer.ts:531-532` afirma janela "~400ms / sem flipping interpolate/extrapolate" — falso por causa do re-push a 60Hz (atualizar junto com o rank 2). `consts.ts` JSDoc cita números de linha de `Player.ts` desatualizados e referencia um `VOICE_RADIUS` inexistente (`consts.ts:38-39`). `protocol.ts:64-65` ("relays by opaque event name with no allowlist") desatualizado vs a interceptação hit/kamehit server-authoritative. `index.ts:181` ("Server-authoritative damage") **superestima**: é autoritativo só sobre HP (gateia alvo vivo, aplica 1 dano), confia no id/aim do cliente sem rewind — não é one-shot arbitrário, mas é falsificável; documentar como furo de cheat conhecido. `PigParts.ts` header descreve um "voxel pig" que não é mais o modelo de entidade.
- **Memória do usuário:** a nota "Supabase Realtime FFA + leaderboard" está stale — atualizar para "servidor Node WS customizado + leaderboard Postgres, sem Supabase". A nota "voxel pig models for entities" também está stale vs o approach atual de animais OBJ via Avatar/ModelLibrary.
