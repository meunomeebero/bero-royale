---
name: hud-design
description: Use when designing, adding, changing, or reviewing any HUD or screen-overlay element in Bero Royale — the React HUD in src/components/hud/* drawn over the Three.js canvas (health/stats bar, crosshair, kill feed, leaderboard, boost/buff chips, toasts, timers, cooldown/ability indicators). Also for HUD readability, contrast, placement, clutter, theme consistency, immersion, accessibility/colorblind, or HUD re-render performance.
---

# HUD Design — Bero Royale

## Overview

The HUD is **React** (`src/components/hud/*.tsx`) drawn over a **live, moving Three.js scene**.
Theme: **cozy world, ruthless fight** — warm and rounded, yet instantly readable mid-combat. Every
element competes for the player's attention *and* for main-thread frame time. **Default to less.**

This is a judgment skill, not a checklist to rubber-stamp: the rules below trade off against each
other (clarity vs. immersion, placement vs. clutter). Reason about the tradeoff for the specific
element — don't just add the thing you were asked to add.

## The 5 golden rules → applied to this game

| Rule | What it means here |
|---|---|
| **1. Consistent with theme/style** | Cozy-but-ruthless: rounded paper-grain panels, warm saturated tints, drop-shadows, **Fraunces** numerals / **Baloo 2 · Hanken** UI type. New elements **reuse the existing token language** (look at `BoostBar`/`StatsBar`) — never a generic dashboard look. |
| **2. Clarity & readability** | The background is a **bright, MOVING voxel world** (grass, sky, explosions, other players). Text/icons need a panel/scrim/outline behind them — **never thin light text straight on the scene**. Must read in one glance, in motion, in the worst-contrast frame. |
| **3. Smart placement** | Vital + fast-changing (HP, crosshair, ability cooldowns) → **center / natural glance path**. Secondary (leaderboard, players, timer) → **top corners** (top-left reads first). Don't crowd the center; don't cover the crosshair or kill feed; overlays stay `pointer-events-none`. |
| **4. Need-to-know & immersion** | Show **as little as possible**. Before adding anything, ask: *does this need to be on screen always, only when relevant, or not at all (diegetic / SFX / a flash)?* Prefer elements that appear only when active and vanish at zero. Don't show the same state twice. Less HUD = more immersion. |
| **5. Customizable & accessible** | Minimum bar: **never encode meaning by color alone** — buffs/states differ by color, so always pair an **icon/shape/label** (colorblind players). Respect `prefers-reduced-motion`. Keep it **scalable** (honor the mobile sizing prop). |

## Before adding or changing a HUD element — work through these

1. **Should it exist on screen?** (R4) Can it be diegetic, only-when-relevant, or folded into an existing element? Kill duplicates (same state shown twice).
2. **Where, and why?** (R3) Vital → center/glance path; secondary → top corner. Confirm it can't cover the crosshair, kill feed, or top stats.
3. **Readable over a moving bright scene?** (R2) Add a panel/scrim/outline; mentally check it against grass **and** sky **and** an explosion. Use the design fonts, sized for a glance.
4. **On-theme?** (R1) Reuse the existing chip/panel tokens; match `BoostBar`/`StatsBar`, don't invent a visual language.
5. **Color-only meaning?** (R5) If states differ by color, add a redundant icon/shape/text. Honor reduced-motion and the mobile/scalable sizing.
6. **Right data/perf channel?** → see next section. This is the project's #1 HUD footgun.

## Project-critical: HUD performance (do NOT regress)

The engine pushes **one `GameStats` object** into React via `game.setStatsListener(...)` (`src/pages/Index.tsx`). The HUD renders **over a 60fps loop on the same main thread**, so every HUD re-render steals frame time from the game.

- **Never drive per-frame / continuous values through React state.** Crosshair position, smoothly-filling bars → write imperatively via a **ref** (`el.style.transform` / `el.style.width`), the way `Crosshair` does. A `mousemove`- or per-frame `setState` re-renders the **whole HUD tree** → jank.
- **Memoize HUD subcomponents** (`React.memo`) with **narrow/primitive props**, so an HP change doesn't re-render the leaderboard.
- **Throttle/quantize emission.** Don't emit a new stats object — or a new array/object reference — every frame; only when a coarse value actually changes. New references defeat `React.memo`.
- **Smooth motion between updates = CSS transitions**, not per-frame React.

Rationale + the bugs this fixed: `docs/PERFORMANCE.md` (HUD section) and `docs/mega-brain.md`.

## Iterate visually

Use the lab route **`/hudlab`** (`src/pages/HudLab.tsx`) to render the HUD in isolation and screenshot it (playwright-core / system Chrome) — check readability, contrast, and placement **over both a bright and a busy background** without booting a full match.

## Common mistakes (seen in the wild here)

- Light text/icons straight on the moving scene → unreadable in bright/explosion frames. **Add a scrim/panel.**
- **Color-only** buff/state differentiation → invisible to colorblind players. **Add an icon/shape/label.**
- Driving a bar or the crosshair via per-frame `setState` → whole-HUD re-render jank. **Use a ref + CSS.**
- New object/array reference on every stats push → `React.memo` never bails. **Stabilize the reference / throttle emission.**
- Adding a new **always-on** element when the info only matters sometimes → clutter + lost immersion. **Show only when active.**
- Generic dashboard styling that ignores the cozy theme → reuse the existing tokens.
- Crowding the center, or covering the crosshair / kill feed.

## File map

- HUD components — `src/components/hud/*.tsx` (`StatsBar`, `Crosshair`, `KillFeed`, `Leaderboard`, `BoostBar`, `PlayersList`, toasts…)
- Mount, stats channel, layout stacks — `src/pages/Index.tsx`
- Engine → HUD contract — `GameStats` + `notifyStats` throttle in `src/game/Game.ts`
- Isolated lab — `src/pages/HudLab.tsx` (route `/hudlab`)
- Theme tokens — `tailwind.config.ts`, `src/index.css`
- Perf rationale — `docs/PERFORMANCE.md`
