# Sabre — Stun no acerto + Clash (bloqueio) — coerente em TODO contexto

**Keywords:** saber, sabre, lightsaber, clash, choque, bloqueio, block, stun, atordoar, fire-lock,
travar tiro, interromper canal, energy blast, recoil, knockback, bot melee, lunge, coerência,
golden rule, player↔bot, bot↔bot, player↔player, server-bot, meleehit, clash event.

> Domínio: combate / sabre (slot 3). Regras gerais do sabre: [`weapons-melee-saber.md`](weapons-melee-saber.md).
> Netcode/autoridade: [`netcode-trust-model.md`](netcode-trust-model.md). Fidelidade online:
> [`netcode-fidelity-golden-rule.md`](netcode-fidelity-golden-rule.md). Bots: [`server-bots-ai.md`](server-bots-ai.md).
> Regra de coerência: [`mechanic-coherence-golden-rule.md`](mechanic-coherence-golden-rule.md).

## Regras de negócio (2026-06-26)
Duas mecânicas do sabre, ambas **100% coerentes em todos os contextos** (offline/online, bots/humanos,
todas as direções):

1. **Stun no acerto (re-adicionado).** Um acerto de sabre **atordoa** a vítima: freeze de ação curto
   (`MELEE_STUN=0.25s`) + **trava o tiro** (`MELEE_FIRE_LOCK=1.0s`) + **interrompe a canalização da
   Energy Blast** (`interruptCharge=true` → `cancelKameCharge`). É o pedido "se eu chego perto e te
   acerto com o sabre, você não consegue atirar". O stun foi removido do sabre em 2026-06-25 (era OP)
   e migrou pra Energy Blast; agora **volta ao sabre** — as duas armas atordoam (aditivo). O
   contrapeso ao "OP" é o **clash** (bloqueio) + **dash** (recuperar).
2. **Clash (bloqueio).** Quando **dois sabres se cruzam no meio do strike** (segmentos das lâminas a
   ≤`CLASH_RADIUS` E direções de swing **opostas**, dot ≤ `CLASH_DOT_MAX`), **ambos** levam recuo
   (`CLASH_KNOCKBACK=12`, mútuo) + **fumaça branca** + **som de clang**, e **nenhum** leva dano ou
   stun. O clash **vence** o acerto (roda antes; suprime o hit). Bloquear = cruzar o sabre.

### Contrapartidas (counterplay)
- **Bloquear:** golpeie no tempo certo → clash (ninguém atordoa).
- **Dash:** `MELEE_STUN(0.25)` < `MELEE_FIRE_LOCK(1.0)`, então o dash libera assim que o freeze de
  0.25s acaba (mesmo ainda travado pra tiro) → recua e recupera distância.
- O re-arm da Energy Blast foi fechado (`Player.ts`): com fire-lock ativo você **não recomeça** a
  canalizar até o lock acabar — senão o "quebrar o canal" só custaria 0.25s.

## Matriz de autoridade (quem detecta / resolve / renderiza)
A **chamada de stun é idêntica em todo lugar** (0.25s/1.0s/interrupt); só o **detector** muda por contexto.

| Contexto | Stun: detecta/resolve | Clash: detecta/resolve | Render |
|---|---|---|---|
| Offline player↔bot | Cliente (`handleMeleeSample` bot loop → `bot.applyMeleeStagger`; `handleBotMeleeSample` → `player.applyMeleeStagger`) | Cliente, lâmina×lâmina, dedup `clashedThisFrame` | direto |
| Offline bot↔bot | Cliente (`handleBotMeleeSample` → `other.applyMeleeStagger`) | Cliente, lâmina×lâmina | direto |
| Online player↔player | Client-broadcast (`sendMeleeHit` → receptor com clamps) | Client-broadcast (`sendClash`); cada cliente recua o SEU player | `melee`→arco, `clash`→fumaça |
| Online player↔server-bot | Server-authoritative (bot→player: server emite `meleehit`; player→bot: server intercepta `meleehit`→`staggerBot`) | Cliente declara `clash`; o server cancela o swing do bot (`clashBot`) | bot é um `RemotePlayer` |
| Online server-bot↔server-bot | Totalmente server-authoritative (`damageBot`+`staggerBot`; detecta+emite `clash`) | Server detecta + emite `clash` | clientes renderizam 2 arcos + clash |

**Fidelidade:** uma vítima de sabre (player remoto OU bot) **pisca/recua em todos os observadores** —
o `meleehit` é renderizado em remotos via `rp.applyStaggerVisual` (não só no alvo local), e o server
emite `meleehit` também pra vítima-bot (que não tem cliente próprio pra honrar o `staggerBot`).

## Números canônicos
- Stun: `MELEE_STUN=0.25s`, `MELEE_FIRE_LOCK=1.0s`, `interruptCharge=true` (cliente `Game.ts`; server
  `MELEE_STUN_T`/`MELEE_FIRE_LOCK_T`). Clamps do receptor (anti stun-lock): `MELEE_MAX_STUN_MS=400`,
  `MELEE_MAX_FIRE_LOCK_MS=1500`, `STAGGER_FREE_WINDOW_MS=500` (+ `Bot.staggerFreeT`, server `staggerOkAt`).
- Clash: `CLASH_RADIUS=0.7` (> `MELEE_SWEEP_RADIUS=0.6`), `CLASH_DOT_MAX=-0.2` (opostas),
  `CLASH_KNOCKBACK=12`, `CLASH_SMOKE_COUNT=18`. Sem dano, sem stun.
- Bot melee (cliente): `BOT_SABER_REACH=2.8`, `BOT_MELEE_LUNGE_RANGE=8`, `BOT_MELEE_INTENT_DUR=2.2s`,
  lunge cooldown `4.5–8.5s`, `BOT_SABER_SWING_CD=0.6s`.

## Mapa de arquivos
| Peça | Arquivo | O quê |
|---|---|---|
| Stun re-add (player swing) | `src/game/Game.ts` → `handleMeleeSample` | bot loop: `bot.applyMeleeStagger`; remote loop: `sendMeleeHit` |
| Resolver do swing do bot | `src/game/Game.ts` → `handleBotMeleeSample` | varre a lâmina do bot vs player + outros bots (hit+stun ou clash) |
| Clash (helpers) | `src/game/Game.ts` → `bladesCross`, `applyClash`, `spawnClashFx`, `segSegDistXZ`, `clashedThisFrame` | detecção, recuo mútuo + FX, dedup por par/frame |
| Acessor de strike (clash) | `Player.ts`/`RemotePlayer.ts`/`Bot.ts` → `getSaberStrike`/`isSaberStriking` | segmento da lâmina + dir de swing durante o strike |
| Rig + swing + IA do bot | `src/game/Bot.ts` | mesh do sabre + cinemática compartilhada + lunge (`meleeIntentT`) + emit por frame + `BotMeleeSample` |
| Fecha o re-arm do canal | `src/game/Player.ts` (kameState idle gated em `fireLockTimer<=0`) | o quebrar-canal "gruda" pelo lock todo |
| Render da vítima remota | `src/game/Game.ts` → `setMeleeHitHandler` (branch remoto) | `rp.applyStaggerVisual` p/ observar o stun |
| Evento de rede `clash` | `src/game/net/Multiplayer.ts` → `ClashEvent`, `setClashHandler`, `sendClash` | `{a,b,x,z}` |
| Som do clash | `src/game/AudioEngine.ts` → `playClash` | clang metálico (2 blips) |
| Server: swing/stun/clash do bot | `server/src/ws/bots.ts` → `startSaberSwing`, `resolveSaberSwing`, `strikePlayer`/`strikeBot`, `clashBot` | autoritativo; emite `melee`/`meleehit`/`clash` |
| Server: intercept do clash | `server/src/ws/index.ts` (branch `clash`) | relay + cancela swing de bot clashado |

## Limitações conhecidas (diferidas — postura anti-cheat diferida do projeto)
- **Clash online é best-effort sob jitter** (detecção local-simétrica; sem lag-comp). Pior caso: um
  lado bloqueia e o outro come um **stun** — nunca um kill (clash não dá dano). Mitigado: o recuo+FX é
  deduplicado por par (`clashPairUntil`, TTL `CLASH_DEDUP_MS`) e o participante que NÃO detectou ainda
  recebe recuo+FX ao receber o `clash` relayado (coerência de tela).
- **player↔server-bot (bot→player):** o strike do bot resolve no servidor em ~72ms
  (`MELEE_SWING_DUR*SWING_WINDUP_END_T`); o `clash` declarado pelo cliente viaja ~RTT de volta, então
  `clashBot` **só cancela o hit do bot de forma confiável em latência baixa** (< ~72ms). A metade
  confiável é player→bot (o jogador segura o próprio hit no clash). Endurecer (refund do hit / atrasar
  o strike / árbitro de clash no server) fica diferido.
- **Superfície cosmética de forja:** `clash{a,b,x,z}` e `meleehit{target}` são cues client-trusted
  relayadas. Um `clash` forjado pode **cancelar o swing (não-letal) de um bot** (sem dano a ninguém); um
  `meleehit{target=outro}` forjado pode fazer um remoto **piscar/recuar** na tela dos observadores —
  **nenhum** tem efeito autoritativo (HP/stun são do cliente da vítima / `staggerBot`; o recuo
  autocorrige contra os snapshots). Aceito sob a postura diferida; endurecer quando validação de
  swing/rewind entrar.

## Histórico
- **2026-06-26** — re-add do stun no sabre + clash, coerente em todos os contextos (bots viram usuários
  de sabre no cliente e no servidor). Ver [`../balance-log.md`](../balance-log.md).
