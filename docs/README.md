# Índice de documentação — Bero Royale

> **Regra inegociável (ver também `/CLAUDE.md` + `/README.md`):** toda modificação de código deve
> vir acompanhada de documentação **atualizada e indexada aqui**. Cada domínio/regra-de-negócio/
> lógica vive num `.md` **pequeno e de propósito único** em `docs/systems/`, com **keywords** no
> topo. Antes de mexer na lógica X, ache o doc por keyword nesta tabela → você tem o contexto e o
> mapa de arquivos sem ler o código todo. Doc faltando ou desatualizado = mudança incompleta.

## Sistemas / domínios (`docs/systems/` — docs pequenos, 1 propósito, com keywords)
| Doc | Domínio | Keywords |
|---|---|---|
| [`systems/netcode-fidelity-golden-rule.md`](systems/netcode-fidelity-golden-rule.md) | 🥇 **Regra de ouro:** fidelidade 100% no online | fidelidade, golden rule, regra de ouro, espelhar, 100%, sabre invisível, o que me matou, parry visível, presentation |
| [`systems/weapons-melee-saber.md`](systems/weapons-melee-saber.md) | Arma corpo a corpo (slot 3) | sabre, saber, melee, swing, parry, reflect, stun, stagger, knockback |
| [`systems/weapons-weight-speed.md`](systems/weapons-weight-speed.md) | Peso das armas → velocidade | peso, weight, arma, velocidade, speed, movimento, balance, leve, pesada |
| [`systems/netcode-trust-model.md`](systems/netcode-trust-model.md) | Autoridade de rede | netcode, online, servidor, autoritativo, broadcast, hit, parry, tiros invisíveis, interpolação |
| [`systems/online-invisible-shots-diagnosis.md`](systems/online-invisible-shots-diagnosis.md) | 🔴 Bug online (diagnosticado) | tiros invisíveis, morte súbita, hitscan, tracer, dano vs visual, bot, throttle |
| [`systems/netcode-hit-sync-plan.md`](systems/netcode-hit-sync-plan.md) | 🔴→🛠️ Arquitetura da correção (tiro↔dano) | tiros invisíveis, hit sync, damage-on-arrival, scheduler, applyAt, impact gate, shotSeq, beam-front, favor-the-victim |
| [`systems/powerups-hp-shield.md`](systems/powerups-hp-shield.md) | Power-ups ↔ HP/escudo (autoridade) | powerup, putake, heal, cura, shield, escudo, super, HP, autoritativo, hp event, desync, morrer com escudo, cura some |
| [`systems/server-bots-ai.md`](systems/server-bots-ai.md) | Bots do servidor (IA + combate) | bot, srvbot, IA, engager, hitscan, fire, super, telegraph, stagger, tick |
| [`systems/voxel-character-gen.md`](systems/voxel-character-gen.md) | Gerar personagens voxel via IA | personagem, character, voxel, gerar, IA, owl, coruja, OBJ, paleta, proporção, coerência, novo animal |
| [`systems/secret-characters-easter-egg.md`](systems/secret-characters-easter-egg.md) | Personagens secretos (easter egg do username) | easter egg, secret, owl, coruja, rabbi, rabino, _jew, bero, roster escondido, unlock, randomAnimalName |

> _Em construção (sprint de docs — ver `PENDENCIAS.md`): indexar os demais domínios (movimento/dash,
> super/kamehameha, power-ups, voz/WebRTC, HUD, leaderboard) em `docs/systems/`._

## Docs gerais
| Doc | O que é |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | **Fonte de verdade** as-built: engine Three.js, netcode relay, servidor Node, build/deploy, threading. |
| [`PERFORMANCE.md`](PERFORMANCE.md) | Auditoria de performance/latência + roadmap priorizado (34 itens). Saída de um workflow multi-agente. |
| [`mega-brain.md`](mega-brain.md) | **Playbook de orquestração multi-agente** ("mega brain"): fan-out, conselhos (council), verificação adversarial, agentes específicos por tarefa/modelo/provedor. Portável para outros agentes/projetos. |
| [`shardcloud.md`](shardcloud.md) | Deploy/ops na Shard Cloud (app Node) — runbook, config, DB. |
| [`mp-sync-plan.md`](mp-sync-plan.md) | 🗂️ Histórico — plano de sync multiplayer (implementado; ver ARCHITECTURE.md). |
| [`mp-wave2-plan.md`](mp-wave2-plan.md) | 🗂️ Histórico — plano da wave 2 (implementado). |
| [`balance-log.md`](balance-log.md) | **Log de balanceamento** — sessões de balance (nerf/buff/tuning), raciocínio e histórico. Números canônicos ficam nos docs de sistema. |
| [`PENDENCIAS.md`](PENDENCIAS.md) | **Backlog vivo / sprint** — pendências, gate de review, dívida técnica, bug urgente do online. |
| [`sprints.md`](sprints.md) | 🗂️ Histórico superado — log de sprints sob o nome antigo "VoxelCube" (menciona Supabase, hoje é Node WS). |

## Como navegar (e onde um agente novo começa)
1. **Vou mexer na lógica X** → ache X por **keyword** na tabela "Sistemas / domínios" → o doc tem o
   mapa de arquivos + os números canônicos. Se não existir doc do domínio, **crie um** (`docs/systems/`).
2. **Entender o sistema todo** → `ARCHITECTURE.md`. **Latência/perf** → `PERFORMANCE.md`.
   **Deploy** → `shardcloud.md`. **Backlog/pendências** → `PENDENCIAS.md`.
3. **Método multi-agente** (council, fan-out, review adversarial) → `mega-brain.md`.
4. **Convenções de código** → [`../CodeGuideline.md`](../CodeGuideline.md).
5. **Ao terminar uma mudança:** atualize/crie o doc do domínio + esta tabela (regra inegociável acima).
