# Plano: Jogo Voxel 3D com Three.js

## Contexto
Criar um jogo single-player minimalista em estilo voxel (pixels 3D) usando Three.js, com física "juicy" (borracha), efeitos de partículas e sons 8-bit. O template atual é um React/Vite/TypeScript em branco.

---

## Dependências a instalar
- `three` — renderização 3D
- `@types/three` — tipagens TypeScript

---

## Arquitetura de Arquivos

```
src/
  pages/
    Index.tsx              ← substitui o placeholder; monta o canvas do jogo
  game/
    Game.ts                ← classe principal: setup Three.js, loop, câmera
    Platform.ts            ← cria a plataforma 8×8 (64 blocos)
    Player.ts              ← cubo do jogador com física e squash/stretch
    InputManager.ts        ← captura teclado (arrows + space)
    DustParticles.ts       ← sistema de partículas quadradas de poeira
    AudioManager.ts        ← sons 8-bit via Web Audio API (sem arquivo externo)
```

---

## Detalhes de Implementação

### 1. Câmera — Isométrica
- `OrthographicCamera` com zoom calibrado para ver a plataforma inteira
- Posição: `(10, 10, 10)` apontando para a origem → ângulo isométrico clássico
- Sem rotação/zoom pelo usuário (câmera fixa)

### 2. Plataforma (Platform.ts)
- Grid 8×8 = 64 blocos de `BoxGeometry(1, 0.5, 1)`
- Paleta fria: blocos em tons de `#1a1a2e` / `#16213e` alternando levemente (checkerboard sutil)
- Arestas levemente visíveis com `EdgesGeometry` + `LineSegments` em azul-neon fraco

### 3. Personagem (Player.ts)
- `BoxGeometry(0.9, 0.9, 0.9)` com material `MeshLambertMaterial` cor `#7b2fff` (roxo neon)
- Posição inicial: centro da plataforma (3.5, 1.15, 3.5)

#### Física simples (sem lib externa):
- `velocityY`: gravidade acumulada frame a frame (`-0.02` por frame)
- Colisão com topo da plataforma em `y = 0.5 + 0.45 = 0.95`
- Movimento lateral: velocidade fixa de `0.08` por frame nas teclas ←→ (X) e ↑↓ (Z)

#### Squash & Stretch (borracha):
- **No pulo:** `scale.y` aumenta para `1.3`, `scale.x/z` diminui para `0.75` (stretch)
- **Ao pousar:** `scale.y` diminui para `0.6`, `scale.x/z` aumenta para `1.3` (squash)
- **Recuperação:** lerp suave de volta a `(1, 1, 1)` a cada frame (`lerpFactor = 0.15`)

#### Queda da plataforma:
- Se `position.x < -0.5` ou `> 8.5` ou `position.z < -0.5` ou `> 8.5` → trigger de morte
- Animação de queda (escala reduz, opacidade cai) → após 600ms, respawn no centro

### 4. InputManager.ts
- `keydown` / `keyup` em `Set<string>` para teclas ativas
- Teclas: `ArrowLeft`, `ArrowRight`, `ArrowUp`, `ArrowDown`, `Space`
- Previne scroll da página no espaço

### 5. Partículas de Poeira (DustParticles.ts)
- Ao pousar: spawna 6–8 cubinhos pequenos (`0.15×0.15×0.15`) em roxo/azul claro
- Cada partícula tem velocidade aleatória para os lados e levemente para cima
- Gravidade própria os puxa para baixo, opacity vai a 0 em ~400ms → remove da cena

### 6. Sons 8-bit (AudioManager.ts)
- **Web Audio API** pura, sem arquivos externos
- `jump()`: onda quadrada (square wave), frequência sobe de 220Hz → 440Hz em 80ms
- `land()`: onda quadrada curta, frequência desce 300Hz → 150Hz em 60ms
- `fall()`: onda quadrada grave, 180Hz → 80Hz em 200ms

### 7. Iluminação e Estética Cyber/Noite
- `AmbientLight` fraco (`#1a1a4e`, intensity 0.6)
- `DirectionalLight` de cima-frente (`#6644ff`, intensity 1.2)
- `PointLight` roxo embaixo da plataforma (`#ff00ff`, intensity 0.4) — glow sutil
- Background da cena: `#060610` (azul quase preto)
- Fog: `FogExp2` em `#060610` com density 0.04

### 8. Index.tsx
- Monta um `<canvas>` fullscreen (100vw × 100vh) sem overflow
- Instancia `Game` no `useEffect`, limpa no cleanup
- HUD mínimo: texto "WASD/Arrows to move · Space to jump" em fonte monospace na borda inferior

---

## Paleta de Cores
| Elemento         | Cor           |
|------------------|---------------|
| Fundo/Fog        | `#060610`     |
| Blocos (escuro)  | `#0d0d2b`     |
| Blocos (médio)   | `#1a1a3e`     |
| Arestas blocos   | `#3333aa`     |
| Personagem       | `#7b2fff`     |
| Poeira           | `#a78bfa`     |
| Luz direcional   | `#6644ff`     |
| PointLight glow  | `#8800ff`     |

---

## Verificação
1. Canvas renderiza a plataforma 8×8 em perspectiva isométrica
2. Personagem aparece no centro, responde às setas e espaço
3. Ao pular: squetch para cima + som de pulo
4. Ao pousar: squash + partículas de poeira + som de aterrissagem
5. Ao cair da plataforma: animação de queda + som + respawn no centro
6. Sem erros de lint (`run_lint`)
