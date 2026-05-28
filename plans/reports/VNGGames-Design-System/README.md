# VNGGames Player Hub Design System

A design system for **VNGGames Player Hub** — the player-facing admin/account surface across the VNGGames product family (vnggames.com, Club, Shop, Account, Level Up). Built on **Tailwind v4 tokens + shadcn/ui** component architecture, with a VNGGames orange brand accent layered over a neutral shadcn-style foundation.

VNGGames is the gaming division of VNG Corporation, a Vietnamese technology company. Player Hub is the umbrella for the authenticated player experience.

## Sources

- **Figma:** `VNGGames UI lib (Shadcn).fig` — 62 pages, 103 top-level frames (component spec + screen examples). Mounted as a read-only VFS at `/` during generation. Key reference frames: `/Colors`, `/Typography`, `/Shadows`, `/Semantic-Tokens`, `/Color-Tokens`, `/Logo/VNGGames`, `/Screen-examples/*`.
- **Brand:** VNGGames / VNG Corporation — orange wordmark (`#F05A22`) with italicized lowercase "vnG" paired with uppercase "GAMES" in Geist.

No codebase was attached; the UI kit in this system is reconstructed from Figma pseudocode + screenshots.

---

## Content Fundamentals

**Voice.** Neutral, precise, product-style — never chatty. Sentence-case headings ("Add users", "Documentation"), no exclamation marks, no emoji. Descriptions read like shadcn's own: short, declarative, one sentence. e.g. `"Displays a badge or a component that looks like a badge."`, `"Based on Tailwind v4."`

**Person.** Second person when giving instructions ("You can safely delete the colors not in use"). Third-person or passive when describing behaviour ("Shadows are invisible in the dark theme").

**Casing.** Sentence case everywhere. Component and section headers are title-cased ("Color Tokens", "Semantic Tokens"). Labels inside forms are title-cased too ("Users", "Groups", "Add users").

**Microcopy examples (all pulled from the Figma):**
- Page description: `"Your project's type style. Note that the display of this depends on variables, see the Theming documentation."`
- Hint: `"You can safely delete the colors not in use."`
- Empty/annotation: `"When Figma releases slots, we will update this component."`

**Emoji:** not used. **Unicode chars as icons:** not used. **Iconography is exclusively Lucide** (the Figma explicitly documents Lucide as the default and gives swap-out instructions).

---

## Visual Foundations

**Overall vibe.** Clean, utilitarian, shadcn-accurate. The system is white-first with generous neutral gray scale; brand orange (`#F05A22`) is reserved for the VNGGames wordmark and a few deliberate accents. The Figma's own chrome uses purple (`#9747FF`) as an annotation color — that is NOT part of the end product, it is Figma scaffolding only.

**Colors.** Tailwind v4 neutrals are the workhorse (`neutral-50 … neutral-950`, 4500+ instances in the Figma). Semantic tokens (`--background`, `--foreground`, `--muted`, `--primary`, `--card`, etc.) map to neutrals in light mode and invert cleanly for dark. Red is the only status hue actually used in the kit beyond informational blue (`#3F8DFF`) and a hint of success green. See `colors_and_type.css`.

**Type.** **Geist** for display + UI, **Inter** for dense/small labels (sizes 9–12px; Inter reads better at small sizes), **Geist Mono** for code and numerals. Heading scale: 48 / 30 / 24 / 20 / 16 / 14. Body 14px Regular / Medium / Bold. Small 12px. Mini 11px. Letter-spacing is slightly tight on headings (`-0.01em` to `-0.02em`), slightly open on small body (`+0.005em` to `+0.015em`).

**Backgrounds.** Flat. No gradients, no textures, no patterns, no hero imagery in component specs. Cards, popovers, dialogs are solid white on `neutral-50` page background. The only coloured backgrounds are annotation-style info panels (flat `blue-200 / #BFDBFE` "Note" blocks in the Figma).

**Borders.** `1px solid neutral-200` (#E5E5E5) everywhere. Inputs, cards, dividers. Focus rings use `neutral-400` or the destructive red. Border radii: 4 / 6 / 8 / 10 / 12 / 16, plus pill (9999). Default is **8px** (buttons, inputs, cards' inner slots) with card containers at **10px**.

**Shadows** (Tailwind scale, documented in Figma): `xs`, `sm`, `md`, `lg`, `xl`, `2xl` — all black-alpha, no colored shadows. Cards typically use `shadow-sm`. Elevated menus use `shadow-md`. Invisible in dark mode.

**Corner radii.** Default **8px** for interactive elements; **10px** for cards; **6px** for badges and small chips; **pill** for avatars, pagination numbers, status dots.

**Cards.** White background, `1px solid neutral-200`, `radius 10–12px`, `shadow-sm`. Content padding `24px`. Header uses `h4`-scale (16–20px Semibold Geist) + a muted descriptor line below.

**Animation & motion.** Minimal. Standard shadcn transitions: `150ms cubic-bezier(.4,0,.2,1)` on color/opacity/transform. No bounces. No decorative motion.

**Hover states.** Primary buttons darken to `neutral-800`. Ghost buttons pick up `neutral-100` fill. Outline buttons pick up `neutral-50` fill. Brand orange darkens to `#F54A00`. Opacity tricks are not used; colours step through real tokens.

**Press states.** Same as hover — no shrink/transform. shadcn relies on color and the focus ring.

**Focus.** `2px solid ring` offset `2px` — ring colour is `neutral-400` on light, `neutral-500` on dark. Destructive focuses to `red-500`.

**Disabled.** `opacity: 0.5` on the whole element, with `cursor: not-allowed`. Token-level `--muted-foreground` also applies.

**Transparency / blur.** Rare. Used for overlays (`rgba(10,10,10,0.5)` modal scrim) and the subtle `rgba(10,10,10,0.05)` "in use" chips. Backdrop-blur is not in the kit.

**Layout rules.** Page gutters 16px mobile, 24–64px desktop. Content max-width typically 1280–1360px. Sidebar 256px collapsed to icon-only 64px. Headers 60–64px tall. Data tables use 12px row padding.

**Imagery.** Gameplay/brand photography is NOT part of this kit — the system is UI-focused. When photography is needed it is warm-toned, natural (not B&W, not over-graded). Placeholders are flat neutral gray rectangles.

---

## Iconography

- **Library:** [Lucide](https://lucide.dev) — 1500+ icons, consistent 1.5–2px stroke, 24×24 viewBox. The Figma explicitly documents Lucide as the default set and gives guidance on swapping to Material / Tabler / Obra if needed.
- **Loaded via:** `unpkg.com/lucide@latest` CDN. Used as a web-component or inline SVG. No icon font required.
- **Sizes:** 16px (inside buttons, badges, inputs), 20px (section headers), 24px (icon buttons at default size).
- **Stroke:** default Lucide `2px`. Inherits `currentColor` so icons pick up `--foreground` / `--muted-foreground` automatically.
- **Emoji:** never used.
- **Unicode symbols as icons:** never used (e.g. no "→", "×" as type — always Lucide `arrow-right`, `x`).
- **Logo:** The VNGGames wordmark (italic "vnG" + "GAMES") lives in `assets/logo/`. Re-generated as SVG text from the Figma logo frame (Geist bold italic, `#F05A22` + `#0A0A0A`). The original Figma stores it as a flattened multi-vector group; our SVGs are a faithful retype. **Flagged for user review if an official brand SVG exists.**

---

## Index

- `README.md` — this file
- `SKILL.md` — Agent skill entrypoint (Claude Code / agent use)
- `colors_and_type.css` — all tokens (colors, type, shadows, radii, spacing) as CSS vars
- `assets/logo/` — VNGGames wordmark + Player Hub lockup + app mark
- `preview/` — one HTML card per concept, registered for the Design System tab
- `ui_kits/player-hub/` — reconstructed UI kit with JSX components + an interactive `index.html`

---

## Caveats

- **No codebase was provided** — all components are reconstructed from Figma pseudocode. Spacing / motion / exact hover colors are best-effort from the static Figma screens.
- **Logos are re-typed SVGs.** The real VNGGames logo is stored as flattened vectors in the Figma; I re-typed it with Geist Bold Italic to be a close visual match. **User: please swap in official brand SVGs if available.**
- **Fonts loaded via Google Fonts CDN** (Geist, Inter, Geist Mono). If VNG has a licensed webfont pipeline, swap in the ttf/woff2.
- **"Player Hub" product branding** — the Figma file is the generic VNGGames shadcn kit, not a Player Hub-specific frame. The Player Hub UI kit is inferred from the generic "App example" screens.
