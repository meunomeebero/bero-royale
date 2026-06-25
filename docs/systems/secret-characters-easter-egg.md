# Personagens secretos (easter egg do username)

**Keywords:** easter egg, secret, secreto, owl, coruja, rabbi, rabino, _jew, bero, roster
escondido, unlock, personagem oculto, character select, randomAnimalName

## Regra de negócio
A `owl` (coruja) e o `rabbi` (rabino) são **personagens secretos**: ficam **escondidos em todo
lugar** até o username liberar o easter egg. Quando bloqueados, eles **não** aparecem:
- na grade/roster 3D do **Character Select**,
- no pool de spawn aleatório (bots locais, fallback de multiplayer, vitrine/ambient do menu),
- nos bots do servidor (o roster do server já os exclui — `server/src/ws/bots.ts`).

Eles continuam sendo **pré-carregados** (`ModelLibrary.preload`) para renderizar quando um jogador
desbloqueado os escolhe e para que **remotos** vejam o avatar correto.

### Quando desbloqueia
`unlocksSecretAnimals(name)` — o username, com `trim()` + `toLowerCase()`, é:
- exatamente **`bero`**, **ou**
- termina em **`_jew`** (ex.: `john_jew`, `John_JEW`).

Vazio → bloqueado. A revelação é **reativa**: o roster recomputa a cada tecla digitada no nome.

> Nota: `bero` também liga o easter egg de **boss** (double-tap Tab) — regra separada em
> `Game.ts` (`=== "bero"`). Nomes `_jew` liberam só os personagens secretos, não o boss.

## Mapa de arquivos
| Arquivo | Papel |
|---|---|
| `src/game/ModelLibrary.ts` | Fonte da verdade do roster: `ANIMAL_NAMES` (tudo), `SECRET_ANIMALS` (owl, rabbi), `PUBLIC_ANIMALS` (resto), `unlocksSecretAnimals()`. `randomAnimalName()` sorteia só de `PUBLIC_ANIMALS`. |
| `src/components/hud/CharacterSelect.tsx` | Reveal ao vivo: `roster = unlocked ? ANIMAL_NAMES : PUBLIC_ANIMALS`; grade + `setRoster` no 3D; reseta seleção se um secreto ficar escondido; nomes PT-BR `owl→Coruja`, `rabbi→Rabino`. |
| `src/game/CharacterStage.ts` | `setRoster(animals)` reconstrói os avatares do palco 3D sem recriar o contexto GL (sem flicker). |
| `server/src/ws/bots.ts` | Roster de bots do servidor — já exclui owl/rabbi (nenhuma mudança necessária). |

## Limitações conhecidas
- O protocolo de rede relaya o `animal` escolhido como string sem validar contra um allowlist; um
  jogador desbloqueado aparece como owl/rabbi para todos na partida (comportamento desejado).
- Não há persistência da escolha de animal (só do username em `localStorage`), então recarregar a
  página volta a seleção para o primeiro personagem público.
