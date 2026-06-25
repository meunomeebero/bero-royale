# 🥇 Regra de ouro — Fidelidade 100% no online

**Keywords:** fidelidade, fidelity, golden rule, regra de ouro, online, multiplayer, espelhar,
mirror, 100%, o que eu vejo, what I see, sabre invisível, invisible saber, swing, trail, smoke,
luz, reflexão, parry, bullet reflected, "o que me matou", whatkilledme, presentation, visual sync.

> Princípio que rege todo o netcode visual. Para autoridade de dano veja
> [`netcode-trust-model.md`](netcode-trust-model.md); para a arma de melee veja
> [`weapons-melee-saber.md`](weapons-melee-saber.md).

## A regra (inegociável)
**O que o jogador vê na própria tela DEVE aparecer 100% na tela de todos os outros.** Se na minha
tela eu vejo um sabre de luz com a lâmina, a animação de swing, o rastro azul, a luz e a fumaça,
então **cada oponente vê exatamente isso** — mesma arma, mesma animação, mesmo VFX, no mesmo
momento. O mesmo vale para: o tiro, o super (carga + feixe), o dash, o pulo, o stagger, e **balas
refletidas no parry** (se eu reflito a bala na hora certa, o atirador VÊ a bala voltar).

**Falta de fidelidade é BUG, não detalhe.** O sintoma clássico: "morri e não sei o que me matou".
Isso destrói o jogo competitivo. Toda ação com representação visual local precisa de uma
representação visual equivalente em todos os clientes.

## Por que isso importa
Num battle-royale a leitura do combate é tudo: você reage ao que vê. Se o sabre do oponente é
invisível, se a bala refletida não aparece, se o super não tem feixe — você morre sem informação e
o jogo parece injusto/quebrado. Fidelidade total = combate legível = jogo justo.

## Como aplicar (checklist para qualquer ação nova ou existente)
Para CADA ação que o ator vê localmente, pergunte:
1. **A arma/objeto certo aparece no remoto?** (ex.: sabre montado quando o slot 3 está ativo, arma
   quando é tiro). Se o remoto não sabe qual arma, **transmita** (campo no snapshot `NetState`).
   **Sem mudança no servidor:** o `s` é parseado só para os campos autoritativos (`health`/`alive`,
   sobrescritos pelo servidor); **campos desconhecidos passam intactos**. Já os eventos `melee`/`parry`
   são relay **verbatim**. Então adicionar `weapon` ao snapshot é seguro e backward-compatible.
2. **A animação aparece?** (swing de 180°, recuo do tiro, carga do super). Reutilize a MESMA função
   de animação do local (ex.: `sampleSaberYaw`) para ficar idêntico.
3. **O VFX aparece?** (rastro/`SaberTrail`, fumaça, luz, flash, tracer, feixe).
4. **A consequência aparece?** (knockback, stagger, bala refletida voltando, morte).
5. **No momento certo?** (respeitar interpolação/`damage-on-arrival`; ver
   [`netcode-hit-sync-plan.md`](netcode-hit-sync-plan.md)).

Se qualquer resposta for "não", é uma lacuna de fidelidade → **corrija** (não é opcional).

## Limites legítimos (não confundir com furo de fidelidade)
- **Autoridade de dano** continua no servidor (`hit`/`kamehit`) — fidelidade é sobre o **visual**,
  não sobre confiar no cliente para dano. Ver [`netcode-trust-model.md`](netcode-trust-model.md).
- **Latência/ordenação:** o remoto renderiza com o atraso de interpolação; "mesmo momento" significa
  "no mesmo instante lógico do evento", não literalmente o mesmo frame de relógio.

## Lacunas conhecidas (rastrear até zerar)
- [x] **Sabre invisível no online** — ✅ 2026-06-25: remotos montam a arma + animam o **swing
      completo de 180°** (mesma cinemática via `saberKinematics`) + **rastro azul** + **fumaça** de
      fim de swing. Ver [`weapons-melee-saber.md`](weapons-melee-saber.md).
- [x] **Bala refletida** — ✅ 2026-06-25: o atirador **e os observadores** veem a bala refletida
      voltar do parry (o tracer pra frente é cancelado em todos os clientes; visual azul-sabre; o
      dano real continua via `hit` autoritativo).
- [x] **Arma segurada** (gun vs sabre) — ✅ 2026-06-25: transmitida no snapshot
      (`NetState.weapon`); o remoto mostra a arma certa (o sabre aparece assim que o slot 3 é
      selecionado) + recuo da arma no tiro.
- [x] **Recoil do super/boss no remoto** — ✅ 2026-06-25: a arma do remoto recua no super também.
- [ ] **DRY (dívida técnica, não-bug):** o driver de swing + settle + decay-de-recoil ainda é
      duplicado entre `Player` e `RemotePlayer` (só a cinemática pura foi extraída pra
      `saberKinematics`). Próximo passo: extrair um `SaberRig` (gun+saber+estado do swing) que ambos
      deleguem. Comportamento idêntico hoje; diferido.

## Mapa de arquivos (onde a fidelidade vive)
| Peça | Arquivo |
|---|---|
| Snapshot por-frame (campos espelhados: pose, `charging`/`chargeT`, …) | `src/game/net/Multiplayer.ts` → `NetState` |
| Render do oponente (corpo, deformação, eventos) | `src/game/RemotePlayer.ts` |
| Handlers de eventos remotos (shot/kame/melee/parry → VFX) | `src/game/Game.ts` |
| Animação de swing compartilhada local↔remoto | `src/game/Player.ts` → `sampleSaberYaw()` |
| Rastro do sabre | `src/game/SaberTrail.ts` |
