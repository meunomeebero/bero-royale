# Diagnóstico — "tiros invisíveis" / morte súbita no online

**Keywords:** tiros invisíveis, invisible shots, morte súbita, sudden death, lag, hitscan, tracer,
bot, dano instantâneo, bullet travel, dano vs visual, throttle, token bucket, dessincronização,
animar eventos do back-end.

> Status: **diagnosticado (read-only) 2026-06-24, verificado no código.** Correção pendente (ver
> [`../PENDENCIAS.md`](../PENDENCIAS.md)). Contexto de autoridade: [`netcode-trust-model.md`](netcode-trust-model.md).

## Sintoma
No online o jogador morre de repente sem ver de onde veio o tiro; balas parecem "invisíveis".

## CAUSA RAIZ #1 (primária) — dano hitscan instantâneo do bot vs tracer que viaja
`server/src/ws/bots.ts` → `fire()` (~L1347–1387): o bot, no MESMO frame:
1. faz fanout de um **tracer "shot"** (bala VISUAL que **viaja** a `BULLET_SPEED=22` da posição do bot
   até o alvo — leva `dist/22` s, ~0.3–0.4 s a 7–9 u de distância), e
2. logo abaixo faz **hitscan**: passou no roll de `ACCURACY` → `damagePlayer(...)` **na hora** +
   fanout de `"hit"` (e `"died"` se matou).

Ou seja: **o dano é aplicado instantaneamente, mas a bala visível ainda está a caminho.** O jogador
toma dano / morre **antes** do tracer chegar. Como os oponentes online são majoritariamente bots do
servidor (`MAX_BOTS=5` backfill), isso acontece o tempo todo → "tiro invisível / morte do nada".
Evidência: `fire()` faz `damagePlayer` síncrono (L1366–1367) antes do tracer chegar; o tracer só
existe como `spawnVisual` no cliente (não-damaging) viajando devagar.

## CAUSA RAIZ #2 (secundária, rara) — throttle dropa tracers sob fogo extremo
`server/src/ws/index.ts` L34–52, L144–145: um único token-bucket (80 frames/s/socket) dropa **qualquer**
frame em excesso ANTES do parse — incluindo `broadcast "shot"`. Se um cliente excede ~80 frames/s, o
tracer "shot" pode ser dropado enquanto o `hit`/`died` ainda passa → tiro invisível. **Mas** as
cadências reais do jogo (~20 "s"/s + ~2–4 shots/s + esporádicos) ficam bem abaixo de 80/s, então isso
só morde em fogo irreal. Prioridade baixa vs #1.

## CONTRIBUINTE — atraso de interpolação
`INTERP_DELAY_MS`/adaptativo (40–90 ms, `consts.ts`): remotos são renderizados ~no passado, então o
tracer (quando existe) sai de uma posição já defasada — agrava a sensação, não é a causa.

## CORREÇÃO RECOMENDADA (não implementada ainda)
**Sincronizar o dano do bot com a chegada do tracer.** Em vez de `damagePlayer` síncrono em `fire()`,
enfileirar o hit com `applyAt = now + dist/BULLET_SPEED*1000` e resolvê-lo num scheduler por sala a
cada tick (quando `applyAt` passa). Assim o dano cai **junto com a bala visível** → o jogador VÊ o que
o mata. Determinístico, sem custo de abuso (só timing).
- Arquivos: `server/src/ws/bots.ts` (fila de hits pendentes + resolução no `tick`), talvez
  `server/src/ws/rooms.ts` se o scheduler morar lá.
- Tradeoff: TTK ganha ~0.3–0.4 s de atraso no impacto (mais legível e "dodgeable"); validar o feel.
- Opção complementar barata: subir levemente a velocidade do tracer visual para reduzir o gap.
- #2 (throttle): só priorizar se telemetria mostrar perda real; eventual fix = isentar eventos
  instantâneos ("shot"/"dash"/"jump"/"kame") do bucket OU escalar a capacidade por tamanho de sala.

## Verificação sugerida da correção
Cliente sintético via WebSocket (ver `docs/mega-brain.md` §6.4) que conecta numa sala, recebe `shot`
+ `hit` de um bot e mede o delta de tempo entre o `hit` e a chegada esperada do tracer.
