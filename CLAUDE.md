# CLAUDE.md — instruções do projeto Bero Royale

Jogo battle-royale voxel 3D no navegador (Three.js + React HUD; servidor Node WS em `server/`).
Produção: https://beroroyale.shardweb.app

## 📌 Regra inegociável: documentar + indexar TODA mudança
Toda modificação de código **deve** vir com a documentação correspondente atualizada e indexada.
Não é opcional — uma mudança sem doc é uma mudança **incompleta**.

1. Cada **domínio / regra de negócio / lógica** vive num `.md` **pequeno e de propósito único** em
   **`docs/systems/`**, com uma linha de **keywords** no topo e um **mapa de arquivos** (qual código
   implementa o quê).
2. Registre/atualize o doc no **índice**: [`docs/README.md`](docs/README.md) (tabela "Sistemas /
   domínios"). É por ali que se acha "lógica X → arquivo do doc" por keyword.
3. Antes de mexer na lógica X: **ache o doc por keyword** no índice → você tem contexto + localização
   sem ler o código inteiro. Se o domínio não tiver doc, **crie um** como parte da mudança.
4. Mantenha o doc curto e factual (números canônicos, mapa de arquivos, limitações conhecidas).

## Onde um agente novo começa
- **Índice de docs:** [`docs/README.md`](docs/README.md) — ponto de partida e mapa logic→doc.
- **Arquitetura as-built:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
- **Backlog / pendências / bug urgente do online:** [`docs/PENDENCIAS.md`](docs/PENDENCIAS.md).
- **Convenções de código:** [`CodeGuideline.md`](CodeGuideline.md).
- **Modelo de confiança do netcode** (quem é autoritativo): [`docs/systems/netcode-trust-model.md`](docs/systems/netcode-trust-model.md).

## Qualidade (alvo do sprint atual — ver PENDENCIAS.md)
SOLID, Clean Architecture, Clean Code; simples, idiomático, DRY, bons boundaries entre pacotes;
comunicação entre módulos via abstrações (evitar dependências fortes). Performance: best practices
de game dev (sem alocação no hot path, etc.).

## Build / verificação
- Cliente: `corepack pnpm exec tsc --noEmit -p tsconfig.json` + `corepack pnpm exec eslint .` + `pnpm build:prod`.
- Servidor: `corepack pnpm -C server exec tsc --noEmit` + `pnpm build:server`.
- Deploy: ver [`docs/shardcloud.md`](docs/shardcloud.md) (não fazer deploy sem o gate de review combinado).
