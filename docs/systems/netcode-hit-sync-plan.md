# Netcode — plano de sincronização tiro↔dano ("nunca morrer de tiro invisível")

**Keywords:** tiros invisíveis, invisible shots, morte súbita, hit sync, damage-on-arrival, scheduler,
applyAt, impact gate, gate de impacto, shotSeq, tracer, bullet travel, interp, throttle, token bucket,
super, kame, beam-front, favor-the-victim, responsividade, netcode.

> **Origem:** saída de um MegaBrain (workflow de 17 agentes) + conselho externo **GLM 5.2** e
> **Codex GPT‑5.5** (ver `mega-brain.md`). Diagnóstico em
> [`online-invisible-shots-diagnosis.md`](online-invisible-shots-diagnosis.md); autoridade em
> [`netcode-trust-model.md`](netcode-trust-model.md). Status: **Fases 0–1 implementadas + verificadas**
> (oracle `server/test/hit-sync-harness.mjs`: BEFORE mediana **−284 ms** → AFTER tiro **+27 ms**, super **+35 ms**);
> **Fase 4 (super do bot) feita; Fases 2, 3, 5 pendentes.**

## Invariante (requisito inegociável do dono)
**Nunca morrer de um tiro que você não viu chegar.** É aceitável: servidor mais pesado, animação de
morte mais travada/atrasada, **+0,3–0,45 s de TTK**. Ping baixo **não** resolve hoje — é decoupling de
lógica, não latência.

## Decisão: HÍBRIDO (server agenda o dano + cliente trava a morte no impacto visível)
As 3 vozes convergiram no mecanismo primário (parar o dano síncrono; agendar `applyAt`; drenar no tick).
**GLM** propôs confiar só no WS ordenado e descartar o gate-no-cliente; **Codex verificou no código e
refutou:** TCP preserva ordem de *bytes*, não os *gaps de tempo* — head-of-line blocking entrega
`shot`(t=0) e `hit`(t=400ms) juntos, e o tracer ainda leva `dist/22` **depois** de receber
(`src/game/Room.ts:119`, `Bullets.ts:169`). Logo o server-only é **estatístico**, não determinístico → o
**gate no cliente é obrigatório**, com a correção do Codex para o furo do safety-timeout.

Três pilares (todos necessários; nenhum sozinho satisfaz o invariante):
1. **Server: impact-tick scheduler** — para de chamar `damagePlayer` síncrono; enfileira
   `{ applyAt = now + max(MIN_TRAVEL_MS, dist/BULLET_SPEED*1000), kind, shooterId, shotSeq, targetId, origin }`
   por sala e **drena no botLoop 20Hz**; só então aplica dano + fanout `hit`/`died`.
2. **Cliente: gate de impacto (obrigatório)** — carimba cada ataque com `{shooterId, shotSeq}`; constrói o
   sinal **"o tracer me alcançou"** que hoje **não existe** (`Bullets.ts:403`: colisão é pulada p/
   `damaging=false`); **segura morte/HP por chave de ataque** até o tracer/beam tocar o avatar.
   **No timeout NÃO solta a morte direto** — sintetiza um **impacto visível primeiro** e só solta
   HP/morte **≥1 frame depois** (correção do Codex: nunca timeout→morte; assim o invariante vale mesmo
   com tracer perdido).
3. **Apresentação direcionada** — o server manda `origin` autoritativo + `targetId` + `shotSeq` +
   endpoint/deadline; o cliente desenha o projétil **a partir dessa origem exata** e de modo que ele
   **intersecte de fato o alvo em movimento** no impacto. Hoje o cliente ancora o tracer na posição
   **interpolada** do remoto (`Game.ts:567`, interp 40–90 ms `consts.ts:76`) e mira no **lead point**
   (`bots.ts:1347`) → a estria passa **ao lado**. Mirar só na posição-do-disparo ainda erra alvo móvel.

## Mapa de arquivos (verificado no código pelo conselho)
| Camada | Onde | O quê |
|---|---|---|
| Server bot fire | `server/src/ws/bots.ts:1347` (lead aim), `:1366` (dano síncrono) | substituir por `enqueueHit` |
| Server super | `server/src/ws/bots.ts:1254` (loop dano síncrono) | beam-front reveal (não `dist/22`) |
| Server PvP | `server/src/ws/index.ts:262` (`hit` síncrono), `:208` (kame jogador) | enfileirar + correlacionar |
| Throttle | `server/src/ws/index.ts:138` (token bucket pré-parse, client→server) | isentar/priorizar `shot` letal |
| Server fanout | `server/src/ws/rooms.ts:443` (só dropa snapshot) | + `damagePlayer`, scheduler drena no tick |
| Cliente shot→visual | `src/game/Game.ts:566`, `src/game/Bullets.ts:31` (`BULLET_SPEED=22`), `:169` (travel), `:403` (gate `damaging`) | ancorar na origem; criar sinal de impacto |
| Cliente hit/died/hp | `src/game/Game.ts:397/590`, `src/game/net/Multiplayer.ts:379` | bufferizar por `{shooterId,shotSeq}` |
| Cliente interp | `src/game/RemotePlayer.ts`, `src/game/consts.ts:76` (`INTERP_DELAY` 40–90 ms) | origem absoluta evita interp |

## Plano faseado
- ✅ **Fase 0 — consts compartilhadas + harness de verificação (sem mudança de comportamento).** *(feito: `BULLET_SPEED`/`MIN_TRAVEL_MS` no server c/ comentário bidirecional; harness em `server/test/hit-sync-harness.mjs`. Módulo compartilhado real fica como follow-up.)*
  Hoistar `BULLET_SPEED`/`BULLET_LIFE`/`BULLET_MAX_RANGE` p/ um módulo importável por server+cliente (1 número só).
  Cliente WS sintético que força um bot a atirar e mede `delta = t_hit − tracerArrival` (deve ser `≥ 0`).
  **Aviso do Codex:** o WS sintético **só prova o espaçamento de envio do server** — não prova que o
  cliente *renderizou* o tracer antes da morte. Instrumentar **também** o callback de impacto real do
  cliente (headed browser / hook de teste). Rodar contra o código atual: deve **FALHAR** (delta ~ −350 ms) = reproduz o bug.
- ✅ **Fase 1 — fila de hits pendentes + drain (bot fire normal). Dano-na-chegada.** *(feito: `PendingHit`/`enqueueHit`/`drainPendingHits` no `rooms.ts`, drain no botLoop, `fire()`→`resolveShot` enfileirado, `seq` no `shot`/`hit`/`died`. Verificado: dano cai com o tracer (≤1 tick). Super/PvP ainda síncronos = Fases 4/5.)*
  `rooms.ts`: `pendingHits` por sala + `enqueueHit`/`drainPendingHits(now)`. `index.ts` botLoop: drenar após `botSim.tick`.
  `bots.ts fire()`: manter fanout `shot`+roll; trocar dano síncrono por `enqueueHit(applyAt = now + max(MIN_TRAVEL_MS, dist/22*1000))`, cap em `BULLET_LIFE`. `protocol.ts`: `shotSeq` no payload `shot`.
- **Fase 2 — apresentação direcionada (fecha o decoupling espacial).**
  Server manda `origin` autoritativo + `targetId` + `shotSeq` + endpoint/deadline no `shot` letal.
  `Game.ts`: tracer letal sai da `origin` recebida (não da interp) e é desenhado p/ **intersectar o alvo no impacto** (dropar lead p/ a bala correlacionada). `MIN_TRAVEL_MS` (~90 ms) p/ readability em close-range.
- **Fase 3 — gate de impacto no cliente (obrigatório).**
  `Bullets.ts`: teste de proximidade do tracer seq-taggeado vs player local (hoje pulado em `:403`) → `onLethalArrive({shooterId,shotSeq})`.
  `Game.ts` hit/died/hp do player local: **não** matar na hora; bufferizar por chave; soltar em `onLethalArrive` **ou** no timeout limitado — **e no timeout sintetizar impacto visível primeiro, soltar morte ≥1 frame depois.** Áudio/flash continuam instantâneos (cosméticos). Entradas pendentes **independentes** por atirador simultâneo.
- ✅ **Fase 4 — super/kame do BOT (beam-front, não bala de velocidade 22).** *(feito: `fireSuper()`→`resolveSuper()` enfileirado com `applyAt = now + SUPER_REVEAL_MS=120ms`, gate de esquiva mantido no fire-time, `seq` no `kame`. Verificado: super delta mediana 35ms (≥0). O `kamehit` do JOGADOR fica na Fase 5 (precisa o cliente carimbar `seq`).)*
  `bots.ts fireSuper()`: manter o gate de dodge no **fire time**; trocar dano síncrono por `enqueueHit(kind:'super', applyAt = now + SUPER_REVEAL_MS)` atado ao **blast-FX** (o feixe é quase instantâneo visualmente, não viaja a 22). `index.ts kamehit`: idem p/ super do jogador. `Game.ts`/`Kamehameha.ts`: morte/HP do super dirigida pelo `impactAt` do beam, com o mesmo fallback.
- **Fase 5 — PvP throttle/loss + docs (tranca o invariante).**
  `index.ts`: `shot` letal não-dropável enquanto seu `hit` passa (reestruturar o bucket pré-parse).
  `hit` PvP: `applyAt = now + dist/22`, **CLAMP a `BULLET_MAX_RANGE` e FLOOR a `MIN_TRAVEL_MS`** (dist forjada pequena não pode instant-kill nem grande agendar futuro). Correlacionar `shot`↔`hit` (hoje são mensagens **não relacionadas**, ambas dropáveis — Codex). Documentar a inversão deliberada (favor-the-VICTIM) aqui + em `netcode-trust-model.md`; cap defensivo no tamanho de `pendingHits`.

## Verificação (dupla, por causa do aviso do Codex)
1. **WS sintético** mede `t_hit − tracerArrival ≥ 0` (espaçamento de envio do server). 
2. **Callback de impacto do cliente** instrumentado (o tracer/beam realmente tocou o avatar antes de HP/morte).
Gate: `tsc --noEmit` + eslint (cliente+server) + `build:prod`/`build:server` verdes.

## Questões em aberto (decidir na implementação)
- Duração do safety-timeout: atrelar ao travel restante agendado vs cap fixo (~250 ms). Janela máxima de "vivo a mais" aceitável?
- `MIN_TRAVEL_MS`: piso só visual (~30–50 ms, posição do Codex/feel) vs ≥RTT (posição do GLM p/ cobrir 1 retransmissão). Decisão depende da telemetria de perda.
- `SUPER_REVEAL_MS` fixo vs escalado por distância p/ supers de longo alcance.
- Drain a 20Hz (50 ms) vs subir botLoop p/ 30–60Hz (dono aceita server mais pesado).
- `shotSeq` por-sala vs `{shooterId, seq}` (GLM + Codex preferem por-atirador p/ multi-shooter simultâneo).
