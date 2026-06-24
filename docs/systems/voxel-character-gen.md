# Geração de personagens voxel via IA

**Keywords:** personagem, character, voxel, gerar, AI, IA, owl, coruja, modelo 3D, OBJ, MTL,
paleta, palette, greedy mesh, proporção, coerência, MagicaVoxel, novo animal, skin, avatar.

Pipeline para **criar novos personagens jogáveis por código/IA** mantendo coerência com o pack
existente — sem MagicaVoxel, sem rig, sem animação (a animação é toda em código, ver `Avatar.ts`).

## O que é um personagem no Bero (formato do pack)
Cada animal jogável é um trio em `public/models/animals/<nome>/`:
- `<nome>.vox.obj` — malha voxel (triângulos `f v/vt/vn`, normais nas 6 direções).
- `<nome>.vox.mtl` — **1 material** `palette`, flat, aponta pro PNG.
- `<nome>.vox.png` — **paleta 256×1**; cada cor numa coluna; UV = `(coluna+0.5)/256`, v=0.5.

Convenções canônicas (medidas do pack): voxel = **0.1** unidade; pés em **y=0**; centrado em X/Z.
O jogo renormaliza tudo p/ **altura = 1** (`ModelLibrary`), então só **proporção** importa, não
tamanho absoluto. Envelope de coerência (dos 11 em uso): `W/H ≈ 0.6–0.95`, `D/H ≈ 0.6–0.95`,
footprint quase quadrado. **Estilo: blocky** (caixas retangulares, ~200–300 tris — estilo
Crossy-Road), **não** elipsoides suaves (geram superfície "escadinha" e ~10× mais tris/bytes).

## Como gerar um novo personagem (fluxo "IA desenha")
1. Crie `scripts/voxelgen/animals/<nome>.mjs` exportando `name` + `build()` que devolve um
   `VoxelGrid` montado com **caixas** (`box`), simetria via `symmetrizeX()`. Front = **+Z**.
2. `node scripts/voxelgen/gen.mjs <nome>` → escreve o trio em `public/models/animals/<nome>/` e
   **valida** a proporção contra o envelope (falha = ajustar antes de aceitar).
3. Preview offline (sem browser): `render.mjs` rasteriza o grid em PNG isométrico p/ inspeção/iter.
4. Para entrar no jogo: adicionar `"<nome>"` a `ANIMAL_NAMES` em `src/game/ModelLibrary.ts`.
   Nada mais muda — `Avatar`/`Player`/`Bot`/`RemotePlayer` já são genéricos.

## Mapa de arquivos
| Arquivo | Papel |
|---|---|
| `scripts/voxelgen/voxel.mjs` | `VoxelGrid` + primitivas (`box`, `ellipsoid`, `sphere`, `symmetrizeX`, `bounds`). |
| `scripts/voxelgen/exporter.mjs` | grid → OBJ+MTL+PNG no formato do pack; **greedy meshing** (funde faces coplanares). |
| `scripts/voxelgen/png.mjs` | encoder PNG RGB (256×1) só com `zlib` nativo (zero deps). |
| `scripts/voxelgen/measure.mjs` | parse do OBJ + validação de proporção vs `ENVELOPE`. |
| `scripts/voxelgen/render.mjs` | preview isométrico offline (painter's) → PNG; aceita cor de fundo (`renderIso(grid,out,scale,bg)` — use fundo claro p/ personagens escuros). |
| `scripts/voxelgen/gen.mjs` | CLI: build → export → valida. |
| `scripts/voxelgen/animals/<nome>.mjs` | definição paramétrica de um personagem. |
| `src/game/ModelLibrary.ts` | `ANIMAL_NAMES` (allowlist do roster) + loader/normalização. |
| `src/game/Avatar.ts` | consome o modelo no rig (facing, dash-stretch, tint). |

## Limitações conhecidas
- Sem rig/skeleton (intencional): toda animação é código. Modelos são estáticos.
- O validador checa **proporção**, não estética — a qualidade do desenho é revisão humana/iteração.
- Winding das faces é corrigido por produto vetorial (material é single-sided); confirmar visual
  in-game na 1ª vez que um modelo novo entra no roster.
- Exemplos gerados: `owl` (coruja, animal) e `rabbi` (rabino, **humano** — corpo+cabeça
  num cubo só, **sem pernas/braços/pés**; cartola/barba/óculos como blocos grandes). Humanos
  seguem a mesma regra dos bichos: um cubo fundido, sem membros separados. **Ambos já estão
  no roster** (`ANIMAL_NAMES`); para um personagem novo, basta adicionar o nome lá.
- Personagens altos (ex.: com cartola) tendem a estourar o envelope (`W/H < 0.6`): encorpar
  (alargar corpo+cabeça, encurtar o topo) mantém a hitbox justa, já que o jogo normaliza a altura.
