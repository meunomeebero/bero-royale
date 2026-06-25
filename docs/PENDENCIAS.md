# PENDÊNCIAS — backlog vivo do Bero Royale

> Arquivo de pendências/sprint. **Regra inegociável:** toda modificação deve ser documentada,
> refletida na documentação e bem indexada (ver `docs/INDEX.md` quando existir + a regra em
> `CLAUDE.md`/`README.md`). Qualquer agente novo começa por aqui e pelo índice de docs.

## FASE A — feature do sabre (gate antes de ir ao ar) — ✅ CONCLUÍDA (2026-06-24)
> Review GPT-5.5 Max limpo na rodada 7 ("No actionable correctness issues found"). Push em
> `origin/main` (commits d792ce3..2287608) + deploy em prod (bundle `index-Bu1sRSLz.js`, restart OK,
> servidor 200). No ar em https://beroroyale.shardweb.app.

- [x] Implementar sabre (slot 3): swing baseball, 2× alcance, parry de projéteis, stun/interrupção.
- [x] Mega Brain: design council (DeepSeek V4 Pro + GLM 5.2 + GPT-5.5) + 3 rodadas de review adversarial.
- [x] Commit em `main` (d792ce3). Build cliente+servidor verde, tsc+eslint limpos.
- [~] **Review GPT-5.5 (modo Max via Codex) → consertar tudo → re-review.** 6 rodadas feitas; sem
  blockers (P1) desde a rodada 4; rodadas 5–6 foram polimento P2, tudo corrigido (commits de fix).
  ⏸️ **Rodada 7 bloqueada:** Codex bateu o limite de uso (reseta ~03:17). Retomar e confirmar limpo.
- [ ] Quando o review fechar limpo: `git push origin main` (GitHub) + deploy/go-live (restart shardcloud).
- Nota: o deploy PUT já subiu os arquivos de um build antigo, mas o **restart foi retido** até o review
  passar (não está no ar). No go-live, **rebuildar o bundle** (inclui as mudanças do servidor) antes do PUT.
- [x] Documentação da feature do sabre + sistema de docs/índice + regra inegociável (CLAUDE.md/README)
  — `docs/systems/weapons-melee-saber.md`, `docs/systems/netcode-trust-model.md`, índice em `docs/README.md`.

### Follow-ups do sabre (diferidos nos reviews — revisitar na Fase B com o netcode)
- Parry PvP é **best-effort** sob latência; parry server-authoritative com shot-id está diferido
  (exige validação no servidor + lag-comp). Hoje: cancela o tiro do atirador humano por proximidade.
- Contra **bots do servidor**, o parry não escuda (autoridade do servidor); só reflete dano.

## FASE B — sprint em looping (melhoria contínua de código, docs e testes)
### 1. Code review distribuído
- Quebrar o código em blocos; despachar vários agentes (GPT-5.5 + GLM 5.2) por pedaço pequeno;
  ao final, disparar um Workflow para aplicar todas as correções.
### 2. Documentação & indexação
- Um `.md` pequeno por domínio/regra-de-negócio/lógica, com propósito único + keywords específicas.
- Índice (`docs/INDEX.md`) mapeando "lógica X → arquivo do doc" para contexto imediato.
- `CLAUDE.md` + `README.md`: regra inegociável de documentar+indexar toda mudança.
- Qualquer agente novo sabe exatamente onde procurar.
### 3. Refatoração (arquitetura/qualidade/performance/estrutura/desacoplamento)
- Arquitetura: eliminar código macarrônico; SOLID, Clean Architecture, Clean Code.
- Qualidade: simples, idiomático, DRY, boas abstrações.
- Performance: best practices de game dev; escalabilidade e eficiência.
- Estruturação: interfaces/types/pacotes; modularização com boundaries bem definidos.
- Desacoplamento: comunicação entre pacotes via abstrações (evitar dominó de dependências).
- Dúvidas → consultar GLM 5.2 no console (`scripts/openrouter.mjs`) ou usar Workflow.

## 🔴→🛠️ URGENTE — modo online: "tiros invisíveis", lag e morte súbita
**✅ DIAGNOSTICADO 2026-06-24** (read-only, verificado) → [`systems/online-invisible-shots-diagnosis.md`](systems/online-invisible-shots-diagnosis.md).
**🛠️ Arquitetura da correção (faseada) → [`systems/netcode-hit-sync-plan.md`](systems/netcode-hit-sync-plan.md).**
- **Causa raiz #1 (primária):** bots do servidor aplicavam **dano hitscan instantâneo** em `fire()`
  enquanto o **tracer visual viaja** (≈0.3–0.4 s) → "tiro invisível". Online é majoritariamente bot.
- **Causa raiz #2 (rara):** token-bucket (80/s) pode dropar tracers sob fogo irreal (`index.ts` L144).
- [x] **Fases 0–2 + 4 (server damage-on-arrival + apresentação direcionada + super beam-front).** No código (commits `66686cd`/`727c7e8`/`5ab6509`).
- [x] **Fase 3 — gate de impacto no cliente (keystone do invariante).** 2026-06-25. `seq` plumbado ao cliente;
      tracer letal sinaliza chegada (`Bullets.onLethalArrive`); `Game.ts` `LethalGate` segura a morte do player
      local até a bala chegar (ou timeout → impacto sintetizado + morte ≥1 frame depois); `"hit"` local virou
      presentation-only (servidor) / mantém `takeHit` no `?local`. `tsc`+eslint+build verdes; **review GPT-5.5
      limpo (4 rodadas, 2 P1 corrigidos)**; commit `64559cb` em `main`; **deployado em prod** (bundle
      `index-XMfMsiLb.js`, restart OK, site + API 200). **Falta:** playtest do feel in-game (morte coincidindo com a bala).
- [ ] **Fase 5 — PvP throttle/loss** (`hit` letal não-dropável; `applyAt` PvP clampado; correlacionar `shot`↔`hit`).
- [ ] Opção barata complementar: subir levemente a velocidade do tracer.
- [ ] Telemetria de perda+latência antes de mexer em transporte/throttle (#2).
