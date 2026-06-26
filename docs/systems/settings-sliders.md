# Settings — sliders de sensibilidade do cursor + nível do filtro VHS

**Keywords:** configurações, settings, slider, sensibilidade, cursor, mira, aim sensitivity, sensitivity,
gain, ganho, VHS, filtro retrô, modo desenho, intensidade, nível, level, localStorage, persistência

Dois controles deslizantes na tela **Configurações** (menu). Ambos persistem em `localStorage` e são
lidos na construção do `Game`/`InputManager` (aplicam na próxima partida); o **VHS** também
pré-visualiza ao vivo na cena ambiente do menu.

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
- **O que é:** intensidade `0..1` da stack retrô (pixel + contorno + posterize). Faz lerp de um
  endpoint quase-limpo (nível 0) até o visual atual (nível 1, os valores de `consts.ts`).
- **Importante:** só tem efeito enquanto o **toggle "Modo desenho"** (`PIXEL_FILTER_KEY`) está ON —
  o toggle liga/desliga toda a `PostFX`; o slider só ajusta a intensidade. Em nível 0 o passe ainda
  roda, mas neutro (blocos de 1px, sem contorno, banding fino).
- **Faixa / default:** `0%`–`100%`, default `100%` (= como sempre foi). `VHS_LEVEL_*` em `consts.ts`.
- **Ao vivo:** `PostFX.setLevel()` reusa `RenderPixelatedPass.setPixelSize()` + campos de edge e os
  uniforms do posterize — sem rebuild.

## Mapa de arquivos
| Arquivo | Papel |
|---|---|
| `src/game/consts.ts` | Chaves LS + faixas/defaults: `AIM_SENSITIVITY_*`, `VHS_LEVEL_*`. |
| `src/game/InputManager.ts` | `aimSensitivity`, `setAimSensitivity()`, `gainCursor()` (ganho centrado + clamp). |
| `src/game/PostFX.ts` | `paramsForLevel(level)` (lerp limpo→cheio) + ctor `level` + `setLevel()` ao vivo. |
| `src/game/Game.ts` | Lê as settings na construção; `setVhsLevel()` / `setAimSensitivity()` / `aimCursorPos()`. |
| `src/pages/Index.tsx` | Reticle do HUD passa por `game.aimCursorPos()` (casa com a mira). |
| `src/components/hud/SettingsScreen.tsx` | As duas `SliderRow` (Vídeo: VHS; Controles: sensibilidade) + persistência. |
| `src/components/hud/menu-primitives.tsx` | Primitiva `SliderRow` (Radix slider no estilo cream/ink). |
| `src/pages/Menu.tsx` | Liga `onVhsLevelChange`/`onAimSensitivityChange` ao `ambientGameRef`. |

## Limitações conhecidas
- O `SettingsScreen` só é montado no **menu** (não há acesso in-match), então a sensibilidade aplica
  na **próxima partida**; o VHS só pré-visualiza na cena ambiente do menu.
- O ganho da mira é ancorado no **centro da tela** (≈ posição do jogador), não no avatar exato —
  aproximação proposital, previsível e barata (sem pointer-lock, sem acúmulo/drift).
