# Settings — sliders de sensibilidade do cursor + nível do filtro VHS

**Keywords:** configurações, settings, slider, sensibilidade, cursor, mira, aim sensitivity, sensitivity,
gain, ganho, VHS, filtro retrô, modo desenho, intensidade, nível, level, localStorage, persistência

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
| `src/pages/Index.tsx` | Reticle via `game.aimCursorPos()` + overlay de **Configurações in-game** no menu de pausa (botão + `SettingsScreen inGame` + Esc/`P`/input-gating via `settingsOpenRef`). |
| `src/components/hud/SettingsScreen.tsx` | As duas `SliderRow` (Vídeo: VHS; Controles: sensibilidade) + persistência + prop `inGame` (esconde Dispositivos / pula prompt de mic). |
| `src/components/hud/menu-primitives.tsx` | Primitiva `SliderRow` (Radix slider no estilo cream/ink). |
| `src/pages/Menu.tsx` | Liga `onVhsLevelChange`/`onAimSensitivityChange` ao `ambientGameRef`. |

## Limitações conhecidas
- In-game as configs abrem só pelo **menu de pausa** (não há acesso sem pausar). A sensibilidade
  aplica ao vivo, mas só é perceptível ao retomar (não se mira pausado); o VHS pré-visualiza no
  frame congelado.
- A seção **Dispositivos** (mic/alto-falante) existe **só no menu** — in-game use o atalho de voz
  (engrenagem do HUD, multiplayer) pra trocar dispositivo sem prompt redundante.
- O ganho da mira é ancorado no **centro da tela** (≈ posição do jogador), não no avatar exato —
  aproximação proposital, previsível e barata (sem pointer-lock, sem acúmulo/drift).
