# Settings — sliders de sensibilidade do cursor + filtro VHS + contorno cartoon (cel shading)

**Keywords:** configurações, settings, slider, sensibilidade, cursor, mira, aim sensitivity, sensitivity,
gain, ganho, VHS, filtro retrô, modo desenho, intensidade, nível, level, cel shading, cel-shading,
contorno, outline, linha preta, inverted hull, casco invertido, cartoon, localStorage, persistência

Dois controles deslizantes na tela **Configurações**, acessível em **dois lugares**:
- **No menu** (`Menu.tsx` → `SettingsScreen`): pré-visualiza ao vivo na cena ambiente.
- **In-game** (overlay no menu de **pausa** do `Index.tsx`, botão "Configurações"): a mesma
  `SettingsScreen` em modo `inGame` — **aplica tudo AO VIVO** na partida (o slider de VHS
  pré-visualiza no frame que continua renderizando atrás do overlay, mesmo pausado).

Ambos persistem em `localStorage` e são lidos na construção do `Game`/`InputManager` (estado inicial
da próxima partida). Os setters (`Game.setVhsLevel` / `setAimSensitivity` / `setPixelFilter` /
`setSfxMuted`) aplicam ao vivo no `Game` atual.

### Acesso in-game (pausa)
- Botão **Configurações** no overlay de pausa abre a `SettingsScreen` com `inGame`.
- `inGame` **esconde a seção "Dispositivos"** (mic/alto-falante + "Testar som") e **pula o
  `getUserMedia`** — abrir as configs no meio da partida nunca dispara prompt de microfone nem
  rouba o mic de um stream de voz ativo. Ficam: Áudio (toggles), Vídeo (Modo desenho + VHS),
  Controles (sensibilidade).
- **Esc** fecha o overlay e volta pra pausa (não despausa); `P` é engolido enquanto aberto
  (`settingsOpenRef` evita closure stale no handler de teclado). O input do jogo é silenciado
  (`setInputEnabled(false)`) enquanto o overlay está aberto, então setas/cliques dos sliders não
  vazam pro jogo.

## Sensibilidade do cursor (mira)
- **O que é:** ganho *ancorado no centro* da tela aplicado à posição do cursor antes de virar mira:
  `efetivo = centro + (cursor − centro) × sensibilidade`, com clamp na viewport.
- **Por que assim:** a mira é **absoluta** (cursor do SO escondido + reticle virtual; `mouseNDC`
  faz raycast pro chão → o personagem encara o ponto sob o cursor). Não há delta relativo pra
  escalar, então o ganho centrado escala *quanto a mira deflete por deslocamento do cursor a
  partir do centro*. Em `1.0×` é idêntico ao comportamento antigo (cursor 1:1).
- **Faixa / default:** `0.4×`–`2.0×`, default `1.0×` (`AIM_SENSITIVITY_*` em `consts.ts`).
- **Fonte única:** `InputManager.gainCursor()` — usado tanto pela mira (`mouseNDC`/`mouseClient`)
  quanto pelo reticle do HUD (via `Game.aimCursorPos()` em `Index.tsx`), então o reticle sempre
  fica exatamente onde o tiro cai.

## Nível do filtro VHS ("Modo desenho")
- **O que é:** intensidade `0..1` da stack retrô (**pixelização + posterize**). Faz lerp de um
  endpoint quase-limpo (nível 0) até o visual atual (nível 1, os valores de `consts.ts`).
- **Importante:** só tem efeito enquanto o **toggle "Modo desenho"** (`PIXEL_FILTER_KEY`) está ON —
  o toggle liga/desliga toda a `PostFX`; o slider só ajusta a intensidade. Em nível 0 o passe ainda
  roda, mas neutro (blocos de 1px, banding fino).
- **Faixa / default:** `0%`–`100%`, default `15%` (retrô bem leve). `VHS_LEVEL_*` em `consts.ts`.
- **Ao vivo:** `PostFX.setLevel()` reusa `RenderPixelatedPass.setPixelSize()` + os uniforms do
  posterize — sem rebuild. As edges do `RenderPixelatedPass` ficam **OFF** (o contorno cartoon é
  geometria, abaixo — não post-process).

## Contorno cartoon (cel shading) — `Outline.ts`
- **O que é:** a **linha preta** em volta dos personagens + props. Técnica **inverted-hull**: para
  cada mesh, um "casco" preto = a mesma superfície renderizada como `BackSide` empurrada pra fora
  ao longo da normal (suavizada) em **view space**. Onde o casco passa da silhueta, aparece como
  borda preta; o resto é coberto pelo mesh real.
- **Por que NÃO post-process:** a câmera é **ortográfica** com near/far largo → o detector de edges
  por profundidade do `RenderPixelatedPass` quase não dispara (testado: nem a 3× saturava). O casco
  invertido é independente de câmera/resolução e dá um traço **sólido e nítido**.
- **Escopo:** **personagens** (`Avatar`: player, bots, remotes, preview) + **props sólidos**
  (crates, pickups, decor com `radius > 0`) + **só os blocos de terreno ELEVADOS** — os topos de
  morro (`baseY > 0`) que ficam "fora da terra" e servem de obstáculo pra pular. O chão plano
  (`baseY = 0`) e os under-layers de penhasco (`baseY < 0`) **não** levam contorno; o scatter de
  grama também não.
- **Terreno (instancing):** `Platform.addTileLayer` só adiciona o `makeInstancedOutline(inst)`
  quando `baseY > 0`. O shader trata `#ifdef USE_INSTANCING` aplicando o `instanceMatrix` (senão
  todos os blocos colapsariam num só). Cada bloco elevado leva o traço; o chão fica limpo.
- **Faixa / default:** `0%`–`100%`, default `20%`. Espessura em **unidades de mundo** (ortho ≈ px
  de tela constante), `OUTLINE_LEVEL_*` + `OUTLINE_THICKNESS_MAX` em `consts.ts`.
- **Independente do "Modo desenho":** é geometria, não PostFX — funciona com o filtro on **ou** off.
- **Ao vivo:** um **único material singleton** com uniform `thickness` global → `setOutlineThickness()`
  retoca todos os contornos de uma vez. Em `thickness 0` o fragment dá `discard` (sem borda, sem
  z-fight). `Game.setCelOutline(level)` → `thickness = level × OUTLINE_THICKNESS_MAX`.
- **Dispose-safe:** os cascos compartilham o material singleton + uma geometria suavizada em cache
  (`WeakMap` por geometria-fonte). Marcados `userData.isOutline`; os `disposeObject` de
  `Decor.ts`/`PowerUps.ts` **pulam** esses meshes pra nunca liberar o recurso compartilhado
  (mesma classe do bug de geometria-compartilhada do editor de mapa).

## Mapa de arquivos
| Arquivo | Papel |
|---|---|
| `src/game/consts.ts` | Chaves LS + faixas/defaults: `AIM_SENSITIVITY_*`, `VHS_LEVEL_*`, `OUTLINE_LEVEL_*`, `OUTLINE_THICKNESS_MAX`. |
| `src/game/Outline.ts` | **Contorno cel-shading**: material singleton (casco preto BackSide, shader instancing-aware + fog, uniform `thickness`), `addOutline()` (meshes), `makeInstancedOutline()` (terreno), `setOutlineThickness()`, cache de geometria suavizada. |
| `src/game/ModelLibrary.ts` | `create(..., outline)` chama `addOutline()` depois de clonar materiais. |
| `src/game/Platform.ts` | `addTileLayer()` adiciona um `makeInstancedOutline(inst)` paralelo → contorno em **todo bloco de terreno**. |
| `src/game/Avatar.ts` / `Crates.ts` / `PowerUps.ts` / `Decor.ts` | Passam `outline: true` (Decor só pra `radius > 0`); `disposeObject` de Decor/PowerUps/Crates pula `userData.isOutline`. Avatar esconde os cascos junto com o fade de opacidade do corpo. |
| `src/game/InputManager.ts` | `aimSensitivity`, `setAimSensitivity()`, `gainCursor()` (ganho centrado + clamp). |
| `src/game/PostFX.ts` | `paramsForLevel(level)` (pixel + posterize; edges OFF) + `setLevel()` ao vivo. |
| `src/game/Game.ts` | Lê as settings; `setVhsLevel()` / `setCelOutline()` / `setAimSensitivity()` / `aimCursorPos()`. |
| `src/pages/Index.tsx` | Reticle via `game.aimCursorPos()` + overlay **Configurações in-game** (pausa) + callbacks `onVhsLevelChange`/`onOutlineLevelChange`/`onAimSensitivityChange`. |
| `src/components/hud/SettingsScreen.tsx` | `SliderRow`s (Vídeo: VHS + Contorno; Controles: sensibilidade) + persistência + prop `inGame`. |
| `src/components/hud/menu-primitives.tsx` | Primitiva `SliderRow` (Radix slider no estilo cream/ink). |
| `src/pages/Menu.tsx` | Liga os callbacks de vídeo/contorno/sensibilidade ao `ambientGameRef`. |

## Limitações conhecidas
- In-game as configs abrem só pelo **menu de pausa** (não há acesso sem pausar). A sensibilidade
  aplica ao vivo, mas só é perceptível ao retomar (não se mira pausado); o VHS pré-visualiza no
  frame congelado.
- A seção **Dispositivos** (mic/alto-falante) existe **só no menu** — in-game use o atalho de voz
  (engrenagem do HUD, multiplayer) pra trocar dispositivo sem prompt redundante.
- O ganho da mira é ancorado no **centro da tela** (≈ posição do jogador), não no avatar exato —
  aproximação proposital, previsível e barata (sem pointer-lock, sem acúmulo/drift).
- O contorno usa **espessura de mundo constante**: objetos pequenos (crate, pickup) leem traço mais
  grosso que objetos grandes (árvore) — esperado num cel-shading (px de tela constante).
- O casco do `Avatar` é escondido (`visible=false`) quando o corpo some no fade (morte/respawn) —
  evita a silhueta preta sólida sem corpo dentro. Já tem fog (`fog: true`) pra sumir na névoa ao longe.
- **Todo bloco de terreno** leva contorno (casco instanciado). Tops planos viram uma grade fina;
  custo extra = ~1 draw call instanciado por camada + dobra o throughput de vértices do terreno
  (aceitável; baixe o slider se pesar em hardware fraco). Scatter de grama (tufos) fica sem contorno.
