# Menu Design Patterns — extração de concorrentes (GLM 5.2)

> Padrões de menu extraídos de 4 telas de Brawl Stars + clones, adaptados à identidade cozy/voxel "Cocoa Cream" do Bero Royale. Fonte: GLM 5.2 via OpenRouter (ver [[megabrain-openrouter]] / docs/mega-brain.md §7.2). As imagens foram descritas pelo Claude (GLM 5.2 é text-only).

## Padrões recorrentes
1. **Bevel+gloss depth over outlines** — Panels separate from bright backgrounds via darker fill + subtle top inner-highlight + bottom inner-shadow + soft outer drop, with rounded corners — no thick outlines.  
   _Por quê:_ Depth reads instantly without visual harshness; scales across light/dark backgrounds; feels premium and tactile on mobile. (A, B, C, D)
2. **Hero-as-centerpiece** — The playable character stands large and centered on the menu, with a soft ground-shadow ellipse, ambient particles, and UI panels orbiting around it.  
   _Por quê:_ Sells the fantasy and identity of the game immediately; makes the menu feel alive rather than a form; gives emotional anchor to progression. (A, C, D)
3. **Single dominant gold primary CTA** — One large, glossy gold/yellow PLAY button with bold dark text sits at the bottom-center, visually heavier than every other element.  
   _Por quê:_ Removes decision friction; the eye lands on it last after scanning currencies/progress; gold reads as 'go' universally. (A, C, D)
4. **Persistent currency bar top-right** — A row of dark pills, each with a bright full-color illustrated icon + bold numeral, always visible across screens.  
   _Por quê:_ Constant resource awareness drives engagement and monetization; pill format is compact and glanceable. (A, B, C, D)
5. **Hexagon/shield emblem badges** — Level, rank, power, and trophy values shown as chunky beveled hexagon or shield badges with bold outlined numerals.  
   _Por quê:_ Emblems feel earned and collectible; bold numerals read at thumbnail size; shape variety creates hierarchy vs square panels. (A, C)
6. **Progress bars with reward-preview end-caps** — Beveled horizontal progress pills with a preview icon of the reward at the far end and current/max numerals.  
   _Por quê:_ Makes grind legible and motivating; the reward preview is a dopamine hook; compact enough for multiple on one screen. (A, C)
7. **Bright illustrated multicolor icons** — Navigation and stat icons are full-color mini-illustrations (shop awning, card stack, heart, gem), not monochrome glyphs.  
   _Por quê:_ Icons become decorative anchors that add personality and aid pre-readers/international users; color reinforces function. (A, B, C, D)
8. **Red notification badges** — Small saturated red circles with white numerals pinned to nav buttons and inventory icons.  
   _Por quê:_ High-contrast urgency on otherwise calm UI; universally understood 'new/attention' signal. (C)
9. **Persistent bottom nav bar** — A 5-slot bottom nav with bright icons + labels, center slot raised/highlighted as Home, side slots carry red count badges.  
   _Por quê:_ Standard mobile navigation mental model; keeps core destinations one tap away; raised center anchors thumb position. (C)
10. **Stat rows: icon + label + bold value + green +X** — Each stat is a beveled row with a bright colored icon, label, bold current value, and a green '+X' upgrade hint.  
   _Por quê:_ Dense but scannable; green positive deltas communicate upgrade potential without extra UI; icon color encodes stat type. (B, D)
11. **Rarity color tags + locked padlock states** — Characters carry a colored rarity pill (green Rare, etc.); locked abilities/slots show a desaturated fill + padlock icon + unlock-level text.  
   _Por quê:_ Rarity adds collection value; padlocks make gating legible and aspirational rather than frustrating. (D, B)
12. **Two-tier CTA: upgrade vs select** — On character detail, a secondary upgrade tag + cost sits beside the primary gold Select button.  
   _Por quê:_ Separates 'equip now' from 'invest long-term' without modal nesting; keeps the gold button dominant. (D)
13. **Profile chip with framed avatar + name** — Top-left: a dark panel containing a rounded-square avatar with a colored frame and the player name beside it.  
   _Por quê:_ Persistent identity anchor; framed avatar feels personalized; pairs naturally with the currency bar on the opposite side for top-bar balance. (A, B)
14. **Angled/slanted stat-row edges** — Stat rows use a slanted or clipped edge rather than plain rectangles, adding mechanical/energetic character.  
   _Por quê:_ Breaks grid monotony on data-heavy screens; reinforces a 'game' rather than 'form' feel. (D)

## Onde nossos menus ficam atrás
- Our panels rely on a single soft border for separation — competitors achieve depth via bevel+gloss+shadow, which reads richer and more premium on bright backgrounds.
- Our main Menu is a vertical button list — we lack a centered hero character as the emotional centerpiece, making the menu feel static and form-like.
- Our hexagon wells use monochrome white Lucide line icons — competitors use bright full-color illustrated icons as personality anchors; ours reads flatter and more utilitarian.
- We have no persistent currency bar — resource awareness is missing across screens.
- We have no persistent bottom nav — navigation relies on the vertical list, adding taps and reducing mobile thumb efficiency.
- We have no progress bars with reward-preview end-caps — progression motivation hooks are absent.
- We have no red notification badges — no urgency/attention signaling on nav items.
- Our stat rows (if any) lack the icon+label+bold value+green +X structure that makes competitor stats scannable and motivating.
- We have no rarity tags or locked padlock states — collection value and gating legibility are missing on CharacterSelect.
- Our primary CTA may not visually dominate — competitors ensure gold PLAY is the single heaviest element on screen.
- We have no profile chip with framed avatar — persistent identity anchor is absent.
- Our ribbon title banners are good but may not carry the emblem-badge numerals (level/rank/power) that competitors use for at-a-glance status.

## Recomendações (priorizadas — 1 = primeiro)
### [1] Add bevel+gloss depth to cream panels  _(esforço low · impacto high)_
Keep cream #F7EEDF fill but add: top inner highlight (1px rgba(255,255,255,0.5) inset, 0 -1px 2px), bottom inner shadow (0 1px 3px rgba(59,41,31,0.15) inset), outer stepped drop shadow (0 3px 0 rgba(90,63,46,0.12), 0 6px 12px rgba(59,41,31,0.18)), border-radius 12-16px. Use cocoa #3B291F at low alpha for shadow warmth. Retain single soft #5a3f2e border at 1px but let the bevel do the heavy lifting.

### [2] Make PLAY the dominant gold CTA  _(esforço low · impacto high)_
Large honey #E0A340 glossy beveled button, bold cocoa #3B291F Baloo 2 text, top highlight + bottom inner shadow + heavy stepped drop (0 4px 0 #B8862E, 0 8px 16px rgba(59,41,31,0.25)), border-radius 16px, min-height 64px. Place bottom-center. Add a small token/timer chip floating above it. No other element on screen matches its visual weight.

### [3] Upgrade hexagon icons to two-tone accent fills  _(esforço low · impacto medium)_
Keep Lucide line icons but give each hexagon well a saturated accent fill (rose/honey/terracotta/success/danger) instead of uniform fill, and switch icon to cream #F7EEDF or white with a subtle 1px cocoa stroke. This adds color-coding and personality without commissioning full illustrations yet. Long-term: commission cozy voxel-style mini-illustrations to replace Lucide.

### [4] Add centered hero character on main Menu  _(esforço medium · impacto high)_
Place the selected pig 3D preview large and centered on Menu, with a soft cocoa ground-shadow ellipse and ambient floating particles (hearts, sparkles, leaves in palette accents). Move the vertical button list to a left rail or bottom nav. The hero becomes the emotional anchor.

### [5] Add persistent currency bar top-right  _(esforço medium · impacto high)_
Row of cream beveled pills, each with a bright accent-filled hexagon icon (coins=honey, gems=rose, tokens=success) + bold cocoa numeral using Hanken Grotesk 700. Keep visible on Menu, CharacterSelect, Settings. Mirror with a profile chip top-left (framed avatar + name).

### [6] Add emblem badges with bold numerals  _(esforço medium · impacto medium)_
Hexagon or shield badges in rose/honey/terracotta with cream or cocoa bold outlined numerals (Baloo 2 800). Show level, trophies, power above or beside the hero on Menu and beside the character name on CharacterSelect.

### [7] Add progress bars with reward-preview end-caps  _(esforço medium · impacto medium)_
Beveled cream pills with a saturated accent gradient fill (rose→honey or honey→terracotta), current/max cocoa numerals centered, and a small hexagon-well reward icon at the right end. Use for battle pass, level, and daily reward tracks on Menu.

### [8] Add persistent bottom nav bar  _(esforço medium · impacto high)_
5-slot bottom nav: Shop / Pigs / Home(center, raised) / Missions / Mastery. Cream beveled bar, accent-filled hexagon icons + Hanken Grotesk labels. Center Home slot raised with honey highlight. Red danger #B5523E notification badges with cream numerals on slots with updates.

### [9] Add red notification badges  _(esforço low · impacto medium)_
Danger #B5523E circles, 18-20px, cream #F7EEDF bold numeral, 1px cocoa stroke, pinned top-right of nav buttons and currency pills when actionable. Pulsing subtle animation optional.

### [10] Add stat rows with icon+label+value+green +X on CharacterSelect  _(esforço medium · impacto medium)_
Cream beveled rows, left: accent-filled hexagon icon (health=success, attack=danger, speed=honey), label in Hanken Grotesk medium cocoa, bold value in Hanken Grotesk 700 cocoa, right: success #7FA05B '+X' upgrade hint. Optionally add a subtle slanted right edge for energy.

### [11] Add rarity tags + locked padlock states  _(esforço medium · impacto medium)_
Rarity pills colored by palette (Common=muted, Rare=success, Epic=honey, Legendary=rose) with cream text. Locked slots: desaturated cream fill (#E8DCC4), muted #9B7B63 padlock icon, small cocoa 'Lv10' unlock text. Use on CharacterSelect ability/star-power slots.

### [12] Add two-tier CTA on CharacterSelect  _(esforço low · impacto low)_
Secondary upgrade tag (success #7FA05B pill + coin honey icon + cost) beside the primary gold Select button. Keeps gold dominant while exposing the invest path.

## Receita de profundidade (bevel+gloss sem borda dura)
Background: cream #F7EEDF base fill. Panel border-radius: 14px. Border: 1px solid #5a3f2e at 60% opacity (soft, not harsh). Inner top highlight: box-shadow inset 0 1px 0 rgba(255,255,255,0.55), inset 0 -2px 4px rgba(59,41,31,0.12). Outer stepped shadow: 0 3px 0 rgba(90,63,46,0.10), 0 6px 14px rgba(59,41,31,0.16). Optional gloss: a 40% height linear-gradient overlay rgba(255,255,255,0.18)→transparent at top of panel. For pressed/hover: invert the inner highlight to inset 0 -1px 0 rgba(255,255,255,0.3), inset 0 2px 4px rgba(59,41,31,0.2). All shadows use cocoa-tinted warm alpha, never pure black.

## Iconografia
Our monochrome white Lucide line icons in hexagon wells are too flat and utilitarian vs competitors' bright full-color illustrated icons that act as personality anchors. Short-term fix (low effort): assign each hexagon well a saturated accent fill from our palette tokens (rose/honey/terracotta/success/danger) and render the Lucide icon in cream #F7EEDF with a subtle 1px cocoa stroke — this adds color-coding and warmth without new art. Mid-term: commission cozy voxel-style mini-illustrations (a tiny shop awning, a pig-card stack, a honey-bear trophy) to replace Lucide on primary nav and stat icons, keeping Lucide only for secondary/settings glyphs. The hexagon well shape is a strong differentiator — keep it, just enrich its contents.

## CTA primário (PLAY/JOGAR)
Large honey #E0A340 button, border-radius 16px, min-height 64px, full-width-ish on portrait (with safe margins). Fill: linear-gradient #E0A340→#C98B2E top-to-bottom for gloss. Top inner highlight: inset 0 1px 0 rgba(255,255,255,0.45). Bottom inner shadow: inset 0 -2px 4px rgba(90,63,46,0.25). Stepped drop shadow: 0 4px 0 #B8862E, 0 8px 18px rgba(59,41,31,0.28). Text: Baloo 2 800, cocoa #3B291F, 22-26px, letter-spacing 0.5px. Optional small cream token/timer chip floating 8px above the button. No other element on any screen should match its saturation, size, or shadow weight. On press: translate Y 2px, reduce stepped shadow to 0 2px 0 #B8862E.

## NÃO copiar (clasharia com o cozy candy)
- Dark navy glossy panels on bright blue — clashes with our warm cream candy identity; keep panels cream, use warm cocoa shadows instead.
- Pure black text and pure black outlines — too harsh for cozy; use cocoa #3B291F.
- High-gloss specular highlights on every panel — feels plasticky/arcade, not cozy; use soft matte bevels with subtle gloss only on CTAs.
- Cool blue/cyan gradient backgrounds — wrong temperature; our world is pink-orange candy.
- Aggressive angled/slanted edges on all rows — too mechanical for cozy; use selectively on stat rows only, keep main panels softly rounded.
- Neon saturation levels on icons — keep our accents within the cozy palette tokens, not pure RGB primaries.
- Cluttered multi-badge stacks above the hero — cozy means breathing room; limit to 2-3 emblems max.
- Metallic chrome/silver frames on avatars — use warm honey or rose frames instead.
