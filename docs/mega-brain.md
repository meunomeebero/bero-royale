# Mega Brain — Playbook de Orquestração Multi-Agente

> **O que é:** um método para resolver tarefas grandes usando **muitos subagentes** em vez de um só
> contexto — leques paralelos (fan-out), **conselhos** de perspectivas independentes, e **verificação
> adversarial** antes de confiar em qualquer resultado. O objetivo não é "ir mais rápido", é ser
> **mais abrangente**, **mais confiável** e dar conta de **escala que um contexto só não segura**.
>
> **Portável:** este doc é genérico de propósito. Foi escrito no repo do Bero Royale, mas o método
> serve para qualquer agente/projeto. Os exemplos vêm de workflows reais rodados aqui (auditoria de
> performance, implementação dos fixes, e a IA dos bots).
>
> **Honestidade sobre "LLM council / GLM 5.2 para design":** o conselho, na prática desta sessão, foi
> feito com **subagentes Claude diferenciados por papel/prompt/ênfase** (não por provedor). O Claude
> Code suporta **nativamente** agentes específicos por tarefa via `model` / `effort` / `agentType` por
> agente (ver §4 e §7). Usar um **provedor externo** (GLM, etc.) como membro do conselho é uma
> **extensão** (wiring via MCP ou custom agent) — documentada em §7.2, **ainda não fiada neste repo**.

---

## 1. Quando usar (e quando NÃO)

Orquestre quando a tarefa for **substancial** e cair num destes moldes:

| Forma | Por quê |
|---|---|
| **Entender** um subsistema grande | leitores paralelos cobrem mais em menos tempo de relógio |
| **Projetar** algo com espaço de solução amplo | conselho de N abordagens → síntese bate "uma tentativa iterada" |
| **Implementar** algo grande/migração | dividir por arquivo/área, isolar conflitos, verificar cada peça |
| **Revisar/auditar** com rigor | dimensões em paralelo + ceticismo adversarial pega o que 1 passada não pega |

**NÃO orquestre** para: perguntas triviais, edição mecânica de 1 arquivo, ou quando você já sabe o
arquivo/símbolo/valor exato. Fan-out tem custo (tokens + latência de barreira). Resolva direto.

Regra de bolso: **escale ao pedido.** "acha um bug" → poucos finders, voto único. "audita a fundo /
seja exaustivo" → pool maior de finders + verificação adversarial 3–5 votos + síntese.

---

## 2. A anatomia de um Mega Brain

```
DESCOBRIR (inline)  →  FAN-OUT (paralelo)  →  SÍNTESE  →  VERIFICAR (adversarial)  →  CONSOLIDAR
   scout o work-list    leitores/designers/    juiz/merge   reviewers céticos +         relatório +
   (liste antes de       implementadores                    re-verificação independente  re-verify
    orquestrar)
```

O movimento mais importante é **híbrido**: faça um *scout inline* primeiro (liste os arquivos, ache
os canais, meça o diff) para **descobrir o work-list**, e só então oriente a orquestração sobre ele.
Você não precisa saber a forma antes da *tarefa* — só antes do *passo de orquestração*.

---

## 3. As primitivas (ferramenta `Workflow` do Claude Code)

Um workflow é um script JS determinístico que coordena subagentes. Hooks do script:

- `agent(prompt, opts?)` → roda um subagente. Sem `schema`, retorna o texto final (string). Com
  `schema` (JSON Schema), o subagente é **forçado a devolver um objeto validado** — sem parsing.
  `opts`: `{ label, phase, schema, model, effort, agentType, isolation }`.
- `parallel(thunks)` → roda tudo concorrente. **É uma barreira** (espera todos). Thunk que falha vira
  `null` (filtre com `.filter(Boolean)`).
- `pipeline(items, stage1, stage2, ...)` → cada item passa por todos os estágios **sem barreira entre
  eles** (item A pode estar no estágio 3 enquanto B está no 1). **É o default** para multi-estágio.
- `phase(title)` → agrupa os próximos agentes numa fase (progresso/telemetria).
- `log(msg)` → linha de narração pro usuário.
- `budget` → alvo de tokens do turno (`budget.total`, `budget.remaining()`), para loops dinâmicos.

O `meta = {...}` no topo (literal puro) declara nome/descrição/fases. Concorrência por workflow é
limitada a ~`min(16, cores-2)`; itens excedentes enfileiram.

> **Custo de barreira:** se 5 finders rodam e o mais lento leva 3× o mais rápido, uma `parallel`
> desperdiça 2/3 do tempo ocioso dos rápidos. Use `pipeline` por default; só use `parallel` (barreira)
> quando o estágio N **realmente** precisa de TODOS os resultados do N-1 juntos (dedup/merge global,
> early-exit em zero, comparação cruzada).

---

## 4. Agentes específicos por tarefa (o lever nativo)

Cada `agent()` aceita overrides — **é assim que se faz "agente específico pra cada tarefa" sem sair do
Claude Code**:

| Override | Pra quê |
|---|---|
| `model: 'opus' \| 'sonnet' \| 'haiku' \| 'fable'` | modelo mais forte nos estágios difíceis (design/verify/juiz), mais barato nos mecânicos |
| `effort: 'low'..'max'` | esforço de raciocínio por estágio (low para varredura mecânica, alto para verify/juiz) |
| `agentType: 'Explore' \| 'code-reviewer' \| ...` | usa um **subagente especializado** (system prompt próprio) em vez do agente genérico; compõe com `schema` |
| `isolation: 'worktree'` | git worktree isolado — **só** quando agentes mutam arquivos em paralelo e conflitariam (caro: ~200-500ms + disco) |

> Default: **omita `model`** — o agente herda o modelo do loop principal, que quase sempre é o certo.
> Só fixe um modelo quando tiver muita confiança de que outro tier encaixa.

Exemplo: varredura barata em `haiku`/`low`, juiz final em `opus`/`high`:
```js
const hits   = await agent(scanPrompt,  { model: 'haiku', effort: 'low',  schema: HITS })
const ruling = await agent(judgePrompt,  { model: 'opus',  effort: 'high', schema: RULING })
```

---

## 5. Os padrões (o coração do método)

### 5.1 Entender — leitores paralelos → síntese
Um agente por subsistema, cada um devolve um mapa estruturado; um sintetizador junta. *Caso real:* a
auditoria de performance usou 12 leitores (1 por subsistema) → análise de latência → síntese →
crítica. Você fica com a conclusão, não com os dumps de arquivo.

### 5.2 Projetar — conselho de N abordagens → juiz/síntese ("LLM council")
Gere **N tentativas independentes de ângulos diferentes**, pontue/sintetize. Bate "uma tentativa
iterada" quando o espaço de solução é amplo. *Caso real:* a IA dos bots usou **2 designers** (um com
ênfase em **combate/agressão**, outro em **controle de mapa/itens**) → um **sintetizador** travou os
números num spec único. A diversidade vem da **ênfase/papel** no prompt — e pode vir de **modelo** ou
**provedor** (§7).

### 5.3 Implementar — duas táticas, escolha pela topologia de arquivos
- **Lanes file-disjuntas (paralelo):** particione por **dono de arquivo** para que dois agentes nunca
  toquem o mesmo arquivo. *Caso real:* os fixes de performance viraram 4 lanes (Server / Netcode /
  Entities / HUD+Build) com conjuntos de arquivos **provadamente disjuntos** → rodaram em paralelo no
  mesmo working tree sem conflito.
- **Sequencial num arquivo compartilhado:** quando é **um algoritmo coerente** (uma máquina de estados
  num arquivo só), fan-out fragmentaria. *Caso real:* a IA dos bots = 3 implementadores **sequenciais**
  no mesmo `bots.ts` (super → itens → targeting), cada um lendo o estado fresco antes de editar.

> Regra anti-conflito: cada agente edita **só os arquivos da sua lista**. Se precisar mexer em arquivo
> de outra lane, **reporta como handoff** em vez de editar. Mantenha **contratos compartilhados
> estáveis** (ex.: a forma de uma interface que uma lane emite e outra consome).

### 5.4 Verificar — gate centralizado + loop de fix (consciente da baseline)
Depois de implementar, **um** agente roda os gates (tsc/lint/build, cliente e servidor), ciente da
**baseline** (erros pré-existentes a ignorar). Se houver erro bloqueante → agente de fix → re-verifica,
até verde (máx N rodadas). *Lição:* "build verde" do workflow ≠ trabalho completo (ver §6).

### 5.5 Revisar — adversarial, perspectiva-diversa
Para cada achado/dimensão, gere céticos **independentes** instruídos a **refutar** (default = refutado
se incerto); mate o achado se ≥maioria refuta. Quando um achado pode falhar de várias formas, dê a cada
verificador uma **lente distinta** (correção / segurança / performance / reproduz?) em vez de N
idênticos. *Caso real:* a IA dos bots teve 3 reviewers (corretude do super / corretude+exploits de
itens / balanceamento+perf+navegação) → 1 finding crítico confirmado → fix → re-verify.

### 5.6 Loops de convergência
- **Loop-until-dry:** continue spawnando finders até K rodadas seguidas sem nada novo (o "rabo" de
  bugs/edge-cases mora aqui). Deduplique contra **tudo já visto**, não só contra os confirmados.
- **Loop-until-budget:** escale a profundidade ao alvo de tokens (`budget.remaining()`), com guarda em
  `budget.total` (sem alvo, `remaining()` é Infinity).

### 5.7 Crítico de completude
Um agente final pergunta "o que ficou de fora — modalidade não rodada, claim não verificado, fonte não
lida?". O que ele acha vira a próxima rodada.

---

## 6. Lições aprendidas (caras, deste repo)

1. **Subagentes morrem no meio ("Connection closed mid-response").** É erro de infra, não de lógica —
   e as edições via Edit **já persistiram em disco** antes da queda. **Nunca confie no `verifyGreen`
   automático.** Re-audite independente: `grep` das assinaturas esperadas + `tsc`/`build` por fora +
   leitura dos caminhos críticos. Nesta sessão, 3 de 4 lanes "morreram" mas as edições estavam no disco
   — e 2 itens tinham ficado pela metade (o build passava mesmo assim).
2. **"Compila" ≠ "implementado".** Um agente pode fazer 2 de 6 edições e o que ficou compila. Verifique
   a **presença de cada mudança pretendida** (grep do símbolo), não só o tsc.
3. **`git diff` mente com arquivos untracked.** Metade dos arquivos mudados aqui (`server/`, vários
   `src/game/*` novos) é **untracked** → não aparece em `git diff`. Reviewers que dependeram de
   `git diff` reviram menos do que pareceu. **Leia os arquivos direto.**
4. **Verifique no nível certo.** tsc/build prova que compila. Para lógica de runtime (ex.: a IA dos
   bots), **teste pelo fio**: um cliente sintético via WebSocket validou spawn/perseguição/super/itens
   **deterministicamente**, melhor que screenshots de WebGL. Para "feel", aí sim browser.
5. **Sem caps silenciosos.** Se a orquestração limita cobertura (top-N, amostragem, "deferi os
   estruturais"), **`log()` o que foi cortado** — senão lê-se como "cobri tudo" quando não cobriu.
6. **Saída estruturada > parsing.** Use `schema` em todo agente cujo resultado você vai processar; a
   validação acontece na chamada (o modelo re-tenta no mismatch).

---

## 7. Diversidade do conselho: papel, modelo, provedor

A força do conselho vem da **independência** dos membros. Três níveis de diversidade:

### 7.1 Por papel/prompt e por modelo/effort (NATIVO — usado aqui)
- **Papel/ênfase:** o mesmo modelo com prompts de ângulos opostos (combate vs controle de mapa;
  correção vs segurança vs reproduz). Foi o que esta sessão usou.
- **Modelo/effort/agentType:** `agent(p, { model, effort, agentType })` — membros em tiers diferentes,
  ou um membro = subagente especializado (`agentType: 'code-reviewer'`). Nativo, sem wiring extra.

### 7.2 Por provedor externo via OpenRouter (ex.: GLM 5.2 para design) — FIADO NESTE REPO

> **Preferência permanente do dono:** quando ele pedir "**megabrain**", os membros não-Claude do
> conselho devem ser puxados **via OpenRouter**. Use o helper `scripts/openrouter.mjs`. A chave fica
> em `OPENROUTER_API_KEY` no `.env` (gitignored) — **nunca** commitar nem imprimir o valor.

O helper deixa qualquer agente (ou o loop principal) chamar um modelo de outro provedor pelo shell —
a chave é lida de `$OPENROUTER_API_KEY` ou do `.env`, nunca passa na linha de comando:

```bash
echo "<prompt>" | node scripts/openrouter.mjs z-ai/glm-5.2 --system "Você é um designer de UI." [--json]
```

Slugs úteis no OpenRouter: `z-ai/glm-5.2` (design, texto), `z-ai/glm-5v-turbo`/`z-ai/glm-4.6v`
(vision — para crítica de screenshots). Liste todos com
`curl -s https://openrouter.ai/api/v1/models`.

**Como entra no conselho.** Dois caminhos:
1. **Loop principal chama o helper** (mais simples para one-offs): o agente principal roda
   `node scripts/openrouter.mjs ...` para obter a proposta do GLM, depois roda os membros Claude e a
   síntese normalmente. Foi assim no redesign da HUD.
2. **Custom `agentType`** ou **MCP server** que envelopa o helper, para que o `Workflow` chame
   `agent(p, { agentType: 'glm-designer', schema })` direto dentro do script.

> Padrão de council multi-provedor: cada membro propõe; um **juiz neutro** (de preferência um 3º
> modelo) pontua às cegas; o sintetizador funde o vencedor enxertando as melhores ideias dos demais.
> **Importante:** mantenha o juiz **independente** dos proponentes para o voto não ser enviesado.

```js
// Conselho multi-provedor (GLM via helper no loop principal → injeta como proposta):
const glm = /* node scripts/openrouter.mjs z-ai/glm-5.2 --json < brief */
const proposals = await parallel([
  () => agent(designPrompt + '\nÊNFASE: A', { schema: DESIGN }),                       // Claude
  () => agent(designPrompt + '\nÊNFASE: B', { model: 'opus', effort: 'high', schema: DESIGN }),
])
const spec = await agent(synthPrompt([glm, ...proposals]), { schema: SPEC })           // funde GLM + Claude
```

---

## 8. Templates reutilizáveis (copie e adapte)

### 8.1 Revisar mudanças (pipeline: dimensão → achados → verificação adversarial)
```js
export const meta = { name: 'review-changes', description: 'Revisa o diff por dimensão e verifica cada achado',
  phases: [{ title: 'Review' }, { title: 'Verify' }] }
const DIMENSIONS = [{ key: 'bugs', prompt: '...' }, { key: 'perf', prompt: '...' }]
const results = await pipeline(DIMENSIONS,
  d => agent(d.prompt, { label: `review:${d.key}`, phase: 'Review', schema: FINDINGS }),
  review => parallel((review.findings || []).map(f => () =>
    agent(`Refute adversarialmente: ${f.title}. Default = refutado se incerto.`, { phase: 'Verify', schema: VERDICT })
      .then(v => ({ ...f, verdict: v })))))
const confirmed = results.flat().filter(Boolean).filter(f => f.verdict?.isReal)
return { confirmed }
```

### 8.2 Conselho de design → spec → implementar → revisar
```js
phase('Design')
const designs = (await parallel([
  () => agent(base + '\nÊNFASE A', { schema: DESIGN }),
  () => agent(base + '\nÊNFASE B', { schema: DESIGN }),
])).filter(Boolean)
const spec = await agent(synth(designs), { schema: SPEC })

phase('Implement')              // sequencial se for um arquivo coerente; lanes se disjunto
const a = await agent(slice1(spec), { schema: IMPL })
const b = await agent(slice2(spec), { schema: IMPL })

phase('Verify');  let v = await agent(verifyPrompt, { schema: VERIFY })
let r = 0; while (v && !v.allClean && r++ < 3) { await agent(fix(v), { schema: FIX }); v = await agent(verifyPrompt, { schema: VERIFY }) }

phase('Review')
const reviews = (await parallel(LENSES.map(L => () => agent(reviewBase + L, { schema: REVIEW })))).filter(Boolean)
```

### 8.3 Leitores paralelos → síntese (entender)
```js
const maps = (await parallel(SUBSYSTEMS.map(s => () =>
  agent(`Mapeie ${s.name}: ${s.prompt}. Devolva findings, não dumps.`, { agentType: 'Explore', schema: MAP }))
)).filter(Boolean)
const overview = await agent(`Funda estes mapas num overview canônico:\n${JSON.stringify(maps)}`, { schema: OVERVIEW })
```

---

## 9. Anti-padrões

- **Barreira onde cabia pipeline** (desperdiça tempo dos agentes rápidos). `pipeline` por default.
- **Fan-out em arquivo compartilhado** (fragmenta o algoritmo / conflita). Sequencial ou lanes disjuntas.
- **`worktree` por reflexo** (caro). Só quando há mutação paralela do mesmo arquivo.
- **Confiar no auto-verify / no `git diff`.** Re-verifique independente; leia arquivos untracked.
- **Caps silenciosos.** `log()` o que foi cortado/deferido e por quê.
- **Juiz = proponente.** Mantenha o avaliador independente dos que ele avalia.

---

## 10. Checklist pra portar isto a OUTRO agente

1. O agente alvo tem uma ferramenta de orquestração (Workflow do Claude Code, ou equivalente que rode
   subagentes deterministicamente)? Se não, dá pra emular com chamadas sequenciais a um agente +
   esquemas, perdendo o paralelismo.
2. Defina os **schemas** de saída antes (são o contrato entre estágios).
3. Decida a **topologia**: entender (leitores‖) · projetar (conselho → síntese) · implementar (lanes
   disjuntas ‖ ou sequencial num arquivo) · revisar (lentes adversariais ‖) · consolidar.
4. Para conselho multi-provedor: exponha o provedor externo como **MCP tool** ou **custom agentType**
   (§7.2); mantenha o **juiz neutro**.
5. Ligue o **gate de verificação** + loop de fix, **ciente da baseline**.
6. **Re-verifique independente** no fim (não confie no status automático).
7. `log()` tudo que foi deferido/cortado.

---

### Veja também
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — arquitetura as-built do jogo (alvo dos workflows acima).
- [`PERFORMANCE.md`](PERFORMANCE.md) — saída de um Mega Brain real (auditoria de 19 agentes).
- Scripts de workflow desta sessão ficam persistidos em
  `.claude/projects/<proj>/<session>/workflows/scripts/*.js` — exemplos executáveis de §8.
