# Índice de documentação — Bero Royale

| Doc | O que é |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | **Fonte de verdade** as-built: engine Three.js, netcode relay, servidor Node, build/deploy, threading. |
| [`PERFORMANCE.md`](PERFORMANCE.md) | Auditoria de performance/latência + roadmap priorizado (34 itens). Saída de um workflow multi-agente. |
| [`mega-brain.md`](mega-brain.md) | **Playbook de orquestração multi-agente** ("mega brain"): fan-out, conselhos (council), verificação adversarial, agentes específicos por tarefa/modelo/provedor. Portável para outros agentes/projetos. |
| [`shardcloud.md`](shardcloud.md) | Deploy/ops na Shard Cloud (app Node) — runbook, config, DB. |
| [`mp-sync-plan.md`](mp-sync-plan.md) | 🗂️ Histórico — plano de sync multiplayer (implementado; ver ARCHITECTURE.md). |
| [`mp-wave2-plan.md`](mp-wave2-plan.md) | 🗂️ Histórico — plano da wave 2 (implementado). |
| [`sprints.md`](sprints.md) | 🗂️ Histórico superado — log de sprints sob o nome antigo "VoxelCube" (menciona Supabase, hoje é Node WS). |

## Como navegar
- **Entender o sistema** → `ARCHITECTURE.md`.
- **Otimizar / latência** → `PERFORMANCE.md`.
- **Deploy** → `shardcloud.md`.
- **Reusar o método de agentes** (conselho/council, fan-out, review adversarial) em outro projeto/agente → `mega-brain.md`.
- **Convenções de código** → [`../CodeGuideline.md`](../CodeGuideline.md).
