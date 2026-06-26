# Netcode — testes determinísticos (harness + invariantes)

**Keywords:** teste, test, vitest, fast-check, property test, determinístico, simulação,
sim, harness, fault injection, latência, jitter, perda, reorder, duplicação, clock skew,
head-of-line, HOL, invariante, regressão, impact gate, LethalImpactGate, damage-on-arrival,
enqueueHit, drainPendingHits, tiros invisíveis, VibiNet.

> Origem: prática "roubada" do [VibiNet](https://github.com/StudioVibi/VibiNet) (lib de
> netcode determinístico) + pesquisa de best-practices (FoundationDB/TigerBeetle DST, Overwatch
> GDC 2017, Gaffer On Games, fast-check). Contexto: [`netcode-hit-sync-plan.md`](netcode-hit-sync-plan.md),
> [`netcode-trust-model.md`](netcode-trust-model.md).

## Princípio
Netcode é testado contra um **simulador determinístico em-processo**, NUNCA contra sockets reais.
Todo o não-determinismo é **injetado** (relógio + RNG + efeitos), então `mesmo seed ⇒ mesmo
resultado`, rápido (sem `sleep`), reproduzível e bisectável. O harness antigo
`server/test/hit-sync-harness.mjs` é o oposto (precisa de um servidor rodando, sockets reais,
`Date.now` real) e — pela própria nota dele — só prova o **espaçamento de envio do servidor**, não
a lógica do gate no cliente. Os testes abaixo cobrem a lógica de fato.

## Runner
- **Vitest** (`vitest.config.ts` na raiz, env `node`, sem os plugins de build) + **fast-check**
  (property testing). Rodar: **`pnpm test`** (ou `pnpm test:watch`). Inclui `src/**/*.test.ts`
  (cliente) e `server/**/*.test.ts` (servidor) — RoomHub é construível isolado (sem postgres/WS/DOM).
- `tsc --noEmit` + `eslint` continuam gates **separados** (o Vitest tira os tipos via esbuild, não
  type-checa). Ver [`/CLAUDE.md`](../../CLAUDE.md) "Build / verificação".

## O que NÃO transfere do VibiNet
VibiNet é **input-sync + rollback determinístico** (todo cliente recomputa o mesmo estado). Bero é
**state-sync + interpolação** (servidor é o único simulador, manda snapshots). Logo NÃO copiamos:
rollback, replay completo do log, "todo cliente == oráculo". Copiamos: o **scheduler de eventos
determinístico**, o **modelo de falhas por link** (latência/jitter/dup/clock-skew + **perda**, que o
VibiNet não modela porque o protocolo dele se auto-cura), a **RNG semeada**, e o estilo "**2ª
implementação burra como oráculo**" + "**bug+fix vira teste de regressão permanente nomeado**".

## Taxonomia de falhas a injetar (relay shooter sobre TCP/WS)
latência · **jitter** (o que mais afeta suavidade) · **perda** (no TCP vira stall de retransmissão) ·
reorder (causa **head-of-line blocking**) · duplicação (testar idempotência) · **clock skew** ·
bandwidth cap/coalescing. Para nós o canônico é o **HOL burst**: um segmento atrasado segura N
mensagens independentes que chegam juntas — não a perda de pacote isolada (UDP).

## Plano faseado (escopo honesto)
- ✅ **Tier 1 — unit + property do impact gate (cliente).** O gate foi **extraído** de `Game.ts` para
  um módulo puro e injetável (`src/game/net/LethalImpactGate.ts`); testado em
  `LethalImpactGate.test.ts` (16 casos: todas as ordens de chegada + a property de 2000 runs que
  codifica os 2 P1 do Codex — "impacto sintetizado **estritamente antes** da morte; nunca synth+morte
  no mesmo frame"). Relógio e efeitos são mocks; frames dirigidos 1-a-1.
- ✅ **Tier 2 — scheduler do servidor (damage-on-arrival).** `server/test/pending-hits.test.ts`
  testa `RoomHub.enqueueHit`/`drainPendingHits` com `now` injetado: resolve em/após `applyAt`, ordem
  de inserção, drena 1×, cap defensivo de 512, e a relação `applyAt = fireTime + max(MIN_TRAVEL, dist/22*1000)`.
  `server/test/pvp-hit-seq.test.ts` testa o `resolvePlayerHit` da Fase 5 (dano PvP imediato + `seq` no `died`
  letal, super, `seq` monotônico/único, não-mata-cadáver) — síncrono, sem timers.
- ⏳ **Tier 3 — sim end-to-end com transporte lossy (DIFERIDO).** Liga o scheduler do servidor ao gate
  do cliente por um transporte simulado (SimScheduler + perda/jitter/HOL, ao estilo
  `.context/VibiNet/test/sim_network.ts`). Só vale quando a **telemetria de perda** mostrar regressão
  real — antes disso é over-engineering (precisa de fixture de sala, clock seam no produtor, etc.).

## Invariantes (alvo do suite)
1. **Autoridade do servidor:** cliente nunca reduz HP de outro nem declara kill; auto-morte por
   predição local é impossível (no servidor real). 2. **Nunca morrer de tiro não-visto** (Fase 3):
   toda morte autoritativa é precedida por um impacto visível (tracer que chegou, ou synth ≥1 frame
   antes). 3. **Idempotência** sob duplicação (hit/died 2× = 1×). 4. **Ordem** sob reorder/HOL (um
   `hit` nunca aplica antes do seu `shot`; snapshot velho é dropado, não aplicado). 5. **Conservação:**
   HP em [0,max]; morto continua morto até respawn autoritativo. 6. **Determinismo:** mesmo
   seed+schedule+inputs ⇒ log idêntico (printar o seed em property tests).

## Checklist (aplicar em toda mudança de netcode)
- [ ] Injetar relógio + RNG + efeitos (nada de `Date.now`/`Math.random`/socket no caminho testado).
- [ ] Todo teste de netcode roda sob **alguma falha** (não só zero-latência/zero-perda).
- [ ] Bug corrigido vira **teste de regressão nomeado** pelo bug (encode o sintoma antigo).
- [ ] Asserir **invariantes/limites** (`delta>=0`, "converge em K ticks"), não valores frágeis.
- [ ] Constante compartilhada entre prod e teste vem de **um módulo só** (evitar drift de `BULLET_SPEED`).
- [ ] `pnpm test` + `tsc` + `eslint` verdes antes de commit/deploy.

## Mapa de arquivos
| Arquivo | Papel |
|---|---|
| `vitest.config.ts` | Config do runner (env node, sem plugins de build) |
| `src/game/net/LethalImpactGate.ts` | **Gate puro** (state machine + efeitos injetados); extraído de `Game.ts` |
| `src/game/net/LethalImpactGate.test.ts` | Unit + property do gate (Tier 1) |
| `server/test/pending-hits.test.ts` | Scheduler damage-on-arrival do servidor (Tier 2) |
| `server/test/pvp-hit-seq.test.ts` | `RoomHub.resolvePlayerHit` da Fase 5 (PvP — `seq` no `died`) (Tier 2) |
| `server/src/ws/combat-consts.ts` | Consts de combate compartilhadas no server (BULLET_SPEED/MIN_TRAVEL_MS/…) |
| `server/src/ws/rooms.ts` | `RoomHub.enqueueHit`/`drainPendingHits`/`resolvePlayerHit` (sob teste) |
| `server/test/hit-sync-harness.mjs` | 🗂️ Legado: oráculo via socket real (precisa server vivo) — superseded pelos testes acima |
| `.context/VibiNet/` | 🗂️ Referência (gitignored): `test/sim_network.ts` é o molde do Tier 3 |
