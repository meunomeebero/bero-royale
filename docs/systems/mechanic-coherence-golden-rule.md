# 🥇 Regra de ouro — Coerência de mecânica em TODO contexto

**Keywords:** coerência, coherence, golden rule, regra de ouro, todo contexto, offline, online, bot,
humano, player, server-bot, todas as direções, PvP, single-player, não deferir contexto, completo.

> Regra de ouro irmã (apresentação): [`netcode-fidelity-golden-rule.md`](netcode-fidelity-golden-rule.md)
> — "o online renderiza 100% do que o ator vê". Esta regra é a versão de **mecânica**.

## A regra
**Toda mecânica que o jogo tem deve se comportar 100% em TODOS os contextos de jogo** — e em **todas
as direções**:

- **Contextos:** offline (bots locais), online (bots do servidor), humano vs humano.
- **Direções:** player→bot, bot→player, bot→bot, player→player.

Uma mecânica que funciona num contexto mas não em outro (ex.: "só PvP, bots depois") é uma
implementação **incompleta** — não está pronta. O jogador vive o jogo como **um mundo coerente**; uma
mecânica faltando offline ou contra bots quebra a imersão.

## Por quê
Enquanto o usuário joga, ele **espera coerência**. Se o sabre atordoa um humano mas não um bot, ou
funciona online mas não offline, o jogo parece quebrado/inconsistente — mesmo que cada pedaço
"funcione". Esta regra foi cravada depois de uma proposta de entregar o stun/clash do sabre como
"PvP-only, bots depois" — o que foi **rejeitado**.

## Como aplicar (checklist ao desenhar/implementar QUALQUER mecânica)
1. **Enumere os contextos:** offline vs bots locais, online vs bots do servidor, online vs humanos,
   bot vs bot. A mecânica existe e se comporta igual em cada um?
2. **Respeite a autoridade de cada contexto:** offline = client-authoritative; bots do servidor +
   fidelidade online = server-authoritative; PvP = client-broadcast (postura atual). A **mecânica** é
   a mesma; só o **detector/autoridade** muda. (Ver a matriz em [`saber-clash-and-stun.md`](saber-clash-and-stun.md)
   como referência.)
3. **Nunca defira um contexto.** Se um contexto precisa de encanamento novo (ex.: bots não tinham IA
   de melee), esse encanamento **faz parte** da tarefa — não é follow-up.
4. **Feche o loop com a fidelidade:** se a mecânica produz um efeito visível (stun, recuo, fumaça),
   ela tem que **renderizar em todos os observadores** (ver a regra irmã).

## Exemplo de referência
O sabre (stun no acerto + clash) foi implementado coerente nos 5 contextos de uma vez, incluindo dar
**IA de sabre aos bots** no cliente (`src/game/Bot.ts`) e no servidor (`server/src/ws/bots.ts`). Ver
[`saber-clash-and-stun.md`](saber-clash-and-stun.md).
