# VNGGames Player Hub — Design System

> Export of the **VNGGames Player Hub Design System** (Tailwind v4 tokens + shadcn/ui architecture, with a VNGGames orange brand accent over a neutral shadcn-style foundation).
>
> Source: Figma file *VNGGames UI lib (Shadcn).fig* — 62 pages, 103 top-level frames.
> Generated: May 19, 2026.

---

## Table of Contents

1. [Overview](#overview)
2. [Sources](#sources)
3. [Content Fundamentals](#content-fundamentals)
4. [Visual Foundations](#visual-foundations)
5. [Color Tokens](#color-tokens)
6. [Semantic Tokens](#semantic-tokens)
7. [Typography](#typography)
8. [Spacing](#spacing)
9. [Radii](#radii)
10. [Shadows](#shadows)
11. [Iconography](#iconography)
12. [Components](#components)
13. [Logos & Assets](#logos--assets)
14. [Reference CSS](#reference-css)
15. [Caveats](#caveats)

---

## Overview

A design system for **VNGGames Player Hub** — the player-facing admin/account surface across the VNGGames product family (vnggames.com, Club, Shop, Account, Level Up).

VNGGames is the gaming division of **VNG Corporation**, a Vietnamese technology company. Player Hub is the umbrella for the authenticated player experience.

**Stack:** Tailwind v4 tokens + shadcn/ui component architecture.
**Brand accent:** VNGGames orange `#F05A22`.
**Foundation:** shadcn-style neutral grayscale.

---

## Sources

- **Figma:** `VNGGames UI lib (Shadcn).fig` — 62 pages, 103 top-level frames (component spec + screen examples). Key reference frames: `/Colors`, `/Typography`, `/Shadows`, `/Semantic-Tokens`, `/Color-Tokens`, `/Logo/VNGGames`, `/Screen-examples/*`.
- **Brand:** VNGGames / VNG Corporation — orange wordmark (`#F05A22`) with italicized lowercase "vnG" paired with uppercase "GAMES" in Geist.

No codebase was attached; the UI kit is reconstructed from Figma pseudocode + screenshots.

---

## Content Fundamentals

**Voice.** Neutral, precise, product-style — never chatty. Sentence-case headings ("Add users", "Documentation"), no exclamation marks, no emoji. Descriptions read like shadcn's own: short, declarative, one sentence.

> e.g. `"Displays a badge or a component that looks like a badge."`
> e.g. `"Based on Tailwind v4."`

**Person.** Second person when giving instructions ("You can safely delete the colors not in use"). Third-person or passive when describing behaviour ("Shadows are invisible in the dark theme").

**Casing.** Sentence case everywhere. Component and section headers are title-cased ("Color Tokens", "Semantic Tokens"). Labels inside forms are title-cased too ("Users", "Groups", "Add users").

**Microcopy examples** (pulled from Figma):
- Page description: `"Your project's type style. Note that the display of this depends on variables, see the Theming documentation."`
- Hint: `"You can safely delete the colors not in use."`
- Empty/annotation: `"When Figma releases slots, we will update this component."`

**Emoji:** not used.
**Unicode chars as icons:** not used.
**Iconography is exclusively Lucide.**

---

## Visual Foundations

| Aspect | Rule |
|---|---|
| **Overall vibe** | Clean, utilitarian, shadcn-accurate. White-first with generous neutral gray scale. Brand orange (`#F05A22`) reserved for the VNGGames wordmark and deliberate accents. |
| **Backgrounds** | Flat. No gradients, no textures, no patterns, no hero imagery. Cards/popovers/dialogs solid white on `neutral-50` page background. |
| **Borders** | `1px solid neutral-200` (`#E5E5E5`) everywhere. Focus rings use `neutral-400` or destructive red. |
| **Radii** | `4 / 6 / 8 / 10 / 12 / 16` + pill (`9999`). Default **8px**; cards **10px**; badges **6px**; avatars/pagination/status dots **pill**. |
| **Shadows** | Tailwind scale `xs / sm / md / lg / xl / 2xl` — all black-alpha, no colored shadows. Cards `shadow-sm`. Elevated menus `shadow-md`. Invisible in dark mode. |
| **Cards** | White, `1px solid neutral-200`, `radius 10–12px`, `shadow-sm`. Content padding `24px`. Header `h4` (16–20px Semibold Geist) + muted descriptor below. |
| **Animation** | Minimal. `150ms cubic-bezier(.4,0,.2,1)` on color/opacity/transform. No bounces, no decorative motion. |
| **Hover** | Primary buttons darken to `neutral-800`. Ghost → `neutral-100` fill. Outline → `neutral-50` fill. Brand orange darkens to `#F54A00`. No opacity tricks — real tokens. |
| **Press** | Same as hover — no shrink/transform. shadcn relies on color + focus ring. |
| **Focus** | `2px solid ring` offset `2px`. Ring `neutral-400` on light, `neutral-500` on dark. Destructive focuses to `red-500`. |
| **Disabled** | `opacity: 0.5` + `cursor: not-allowed`. Token-level `--muted-foreground` also applies. |
| **Transparency / blur** | Rare. Modal scrim `rgba(10,10,10,0.5)`; subtle "in use" chips `rgba(10,10,10,0.05)`. No backdrop-blur. |
| **Layout** | Page gutters 16px mobile, 24–64px desktop. Content max-width 1280–1360px. Sidebar 256px → icon-only 64px. Headers 60–64px tall. Data tables 12px row padding. |
| **Imagery** | UI-focused kit; gameplay/brand photography not included. When photography is needed: warm-toned, natural (not B&W, not over-graded). Placeholders are flat neutral gray rectangles. |

---

## Color Tokens

### Neutral (workhorse — 4500+ Figma uses)

| Token | Hex |
|---|---|
| `--neutral-50`  | `#fafafa` |
| `--neutral-100` | `#f5f5f5` |
| `--neutral-200` | `#e5e5e5` |
| `--neutral-300` | `#d4d4d4` |
| `--neutral-400` | `#a3a3a3` |
| `--neutral-500` | `#737373` |
| `--neutral-600` | `#525252` |
| `--neutral-700` | `#404040` |
| `--neutral-800` | `#262626` |
| `--neutral-900` | `#171717` |
| `--neutral-950` | `#0a0a0a` |

### Brand — VNGGames Orange

| Token | Hex | Note |
|---|---|---|
| `--orange-50`  | `#fff7ed` |  |
| `--orange-100` | `#ffedd5` |  |
| `--orange-200` | `#fed7aa` |  |
| `--orange-300` | `#fdba74` |  |
| `--orange-400` | `#fb923c` |  |
| `--orange-500` | `#f97316` |  |
| `--orange-600` | `#f05a22` | **core VNGGames brand orange** |
| `--orange-700` | `#f54a00` | pressed brand orange |
| `--orange-800` | `#9a3412` |  |
| `--orange-900` | `#7c2d12` |  |
| `--orange-950` | `#431407` |  |

### Red — Destructive

| Token | Hex |
|---|---|
| `--red-50`  | `#fef2f2` |
| `--red-100` | `#fee2e2` |
| `--red-200` | `#fecaca` |
| `--red-300` | `#fca5a5` |
| `--red-400` | `#f87171` |
| `--red-500` | `#ef4444` |
| `--red-600` | `#dc2626` |
| `--red-700` | `#b91c1c` |
| `--red-800` | `#991b1b` |
| `--red-900` | `#7f1d1d` |
| `--red-950` | `#450a0a` |

### Blue — Info

| Token | Hex | Note |
|---|---|---|
| `--blue-50`  | `#eff6ff` |  |
| `--blue-100` | `#dbeafe` |  |
| `--blue-200` | `#bfdbfe` | "Note" annotation blocks |
| `--blue-300` | `#93c5fd` |  |
| `--blue-400` | `#60a5fa` |  |
| `--blue-500` | `#3b82f6` |  |
| `--blue-600` | `#3f8dff` | **info highlight** |
| `--blue-700` | `#1d4ed8` |  |
| `--blue-800` | `#1e40af` |  |
| `--blue-900` | `#1e3a8a` |  |
| `--sky-500`  | `#8ec5ff` |  |

### Success / Warning

| Token | Hex |
|---|---|
| `--emerald-500` | `#10b981` |
| `--emerald-600` | `#059669` |
| `--green-600`   | `#009689` |
| `--amber-500`   | `#f59e0b` |
| `--yellow-500`  | `#eab308` |

### Chart Palette

| Token | Hex |
|---|---|
| `--chart-1` | `#f05a22` |
| `--chart-2` | `#3f8dff` |
| `--chart-3` | `#009689` |
| `--chart-4` | `#f59e0b` |
| `--chart-5` | `#a855f7` |

---

## Semantic Tokens

Semantic tokens map onto neutrals in light mode and invert cleanly for dark.

### Light mode (default)

| Token | Maps to | Purpose |
|---|---|---|
| `--background` | `--neutral-50` | page background |
| `--foreground` | `--neutral-950` | primary text |
| `--muted` | `--neutral-100` | subdued fills |
| `--muted-foreground` | `--neutral-500` | subdued text |
| `--subtle` | `--neutral-200` | hover fills |
| `--card` | `#ffffff` | card surface |
| `--card-foreground` | `--neutral-950` | card text |
| `--popover` | `#ffffff` | popover surface |
| `--popover-foreground` | `--neutral-950` | popover text |
| `--primary` | `--orange-600` | signature CTA color |
| `--primary-foreground` | `#ffffff` |  |
| `--primary-hover` | `--orange-700` |  |
| `--brand` | `--neutral-900` | dark neutral / secondary actions |
| `--brand-foreground` | `--neutral-50` |  |
| `--brand-hover` | `--neutral-800` |  |
| `--secondary` | `--neutral-100` |  |
| `--secondary-foreground` | `--neutral-900` |  |
| `--accent` | `--neutral-100` |  |
| `--accent-foreground` | `--neutral-900` |  |
| `--destructive` | `--red-600` |  |
| `--destructive-foreground` | `--neutral-50` |  |
| `--success` | `--emerald-600` |  |
| `--warning` | `--amber-500` |  |
| `--info` | `--blue-600` |  |
| `--border` | `--neutral-200` |  |
| `--border-strong` | `--neutral-300` |  |
| `--input` | `--neutral-200` |  |
| `--ring` | `--neutral-400` | focus ring |
| `--overlay` | `rgba(10,10,10,0.50)` | modal scrim |
| `--highlight-brand` | `rgba(151,71,255,0.08)` | Figma annotation purple (not for product use) |

### Dark mode

Enabled via `.dark` on `<html>`.

| Token | Maps to |
|---|---|
| `--background` | `--neutral-950` |
| `--foreground` | `--neutral-50` |
| `--muted` | `--neutral-900` |
| `--muted-foreground` | `--neutral-400` |
| `--subtle` | `--neutral-800` |
| `--card` | `--neutral-950` |
| `--popover` | `--neutral-900` |
| `--primary` | `--orange-600` *(unchanged)* |
| `--secondary` | `--neutral-800` |
| `--accent` | `--neutral-800` |
| `--destructive` | `--red-500` |
| `--border` | `--neutral-800` |
| `--border-strong` | `--neutral-700` |
| `--input` | `--neutral-800` |
| `--ring` | `--neutral-500` |
| `--overlay` | `rgba(0,0,0,0.70)` |

---

## Typography

### Font stacks

| Token | Stack | Use |
|---|---|---|
| `--font-display` | `"League Gothic", "Inter", ui-sans-serif, system-ui, sans-serif` | headlines, hero titles (condensed, uppercase) |
| `--font-sans` | `"Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` | body / UI workhorse |
| `--font-ui` | `"Inter", ui-sans-serif, system-ui, -apple-system, sans-serif` | labels, buttons |
| `--font-alt` | `"Geist", "Inter", ui-sans-serif, system-ui, sans-serif` | secondary sans, product copy |
| `--font-mono` | `"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` | code, numerals |

### Weights

| Token | Value |
|---|---|
| `--fw-regular`  | 400 |
| `--fw-medium`   | 500 |
| `--fw-semibold` | 600 |
| `--fw-bold`     | 700 |

### Display headings (League Gothic, uppercase)

| Class | Size | Line | Tracking | Weight |
|---|---|---|---|---|
| `h1` / `.text-h1` | 64px | 0.95 | +0.005em | 400 |
| `h2` / `.text-h2` | 44px | 0.98 | +0.005em | 400 |
| `h3` / `.text-h3` | 32px | 1.05 | +0.01em  | 400 |
| `h4` / `.text-h4` | 24px | 1.10 | +0.01em  | 400 |

### Subheadings (Inter / Geist) — small sizes drop back from League Gothic for readability

| Class | Size | Line | Tracking | Weight |
|---|---|---|---|---|
| `h5` / `.text-h5` | 16px | 1.4 | -0.005em | 600 |
| `h6` / `.text-h6` | 14px | 1.4 | 0 | 600 |

### Body

| Class | Size | Line | Weight |
|---|---|---|---|
| `p` / `.text-p` | 14px | 1.5 | 400 |
| `.text-p-md` | 14px | 1.5 | 500 |
| `.text-p-bold` | 14px | 1.5 | 700 |
| `.text-p-sm` | 12px | 1.5 | 400 |
| `.text-p-sm-md` | 12px | 1.5 | 500 |
| `.text-p-mini` | 11px | 1.4 | 400 |
| `.text-p-mini-md` | 11px | 1.4 | 500 |
| `.text-p-mini-bold` | 11px | 1.4 | 700 |
| `.text-mono` | 13px | 1.5 | 400 (Geist Mono) |
| `.text-label` | 14px | 1.0 | 500 |
| `.text-label-sm` | 12px | 1.0 | 500 |

Letter-spacing is slightly tight on headings (`-0.01em` to `-0.02em`) and slightly open on small body (`+0.005em` to `+0.015em`).

### Helpers

- `.text-muted` → `color: var(--muted-foreground)`

---

## Spacing

Tailwind-style scale.

| Token | Value |
|---|---|
| `--space-1`  | 4px |
| `--space-2`  | 8px |
| `--space-3`  | 12px |
| `--space-4`  | 16px |
| `--space-5`  | 20px |
| `--space-6`  | 24px |
| `--space-8`  | 32px |
| `--space-10` | 40px |
| `--space-12` | 48px |
| `--space-16` | 64px |

---

## Radii

| Token | Value | Use |
|---|---|---|
| `--radius-xs`  | 4px  | tiny chips |
| `--radius-sm`  | 6px  | badges, small chips |
| `--radius-md`  | 8px  | **default** — buttons, inputs, card inner slots |
| `--radius-lg`  | 10px | **cards** |
| `--radius-xl`  | 12px | larger cards |
| `--radius-2xl` | 16px | dialogs |
| `--radius-full`| 9999px | avatars, pills, status dots |

---

## Shadows

All black-alpha, Tailwind scale. **Invisible in dark mode.**

| Token | Value |
|---|---|
| `--shadow-xs`  | `0 1px 2px 0 rgba(0,0,0,0.05)` |
| `--shadow-sm`  | `0 1px 2px -1px rgba(0,0,0,0.1), 0 1px 3px 0 rgba(0,0,0,0.1)` |
| `--shadow-md`  | `0 2px 4px -2px rgba(0,0,0,0.1), 0 4px 6px -1px rgba(0,0,0,0.1)` |
| `--shadow-lg`  | `0 4px 6px -4px rgba(0,0,0,0.1), 0 10px 15px -3px rgba(0,0,0,0.1)` |
| `--shadow-xl`  | `0 8px 10px -6px rgba(0,0,0,0.1), 0 20px 25px -5px rgba(0,0,0,0.1)` |
| `--shadow-2xl` | `0 25px 50px -12px rgba(0,0,0,0.25)` |

**Usage:** Cards `shadow-sm`. Elevated menus / dropdowns `shadow-md`. Modals `shadow-xl` or `shadow-2xl`.

---

## Iconography

- **Library:** [Lucide](https://lucide.dev) — 1500+ icons, consistent 1.5–2px stroke, 24×24 viewBox.
- **Loaded via:** `unpkg.com/lucide@latest` CDN. Used as web-component or inline SVG. No icon font required.
- **Sizes:** 16px (inside buttons, badges, inputs), 20px (section headers), 24px (icon buttons at default size).
- **Stroke:** default Lucide `2px`. Inherits `currentColor` so icons pick up `--foreground` / `--muted-foreground` automatically.
- **Emoji:** never used.
- **Unicode symbols as icons:** never used (e.g. no "→", "×" as type — always Lucide `arrow-right`, `x`).

The Figma explicitly documents Lucide as the default set and gives guidance on swapping to Material / Tabler / Obra if needed.

---

## Components

The UI kit lives in `ui_kits/player-hub/` and is split into five JSX files:

### `Primitives.jsx`
Atomic UI elements.

| Component | Variants / props |
|---|---|
| `Icon` | `name`, `size`, `color`, `fill` |
| `Button` | variants: `primary` / `neutral` / `secondary` / `outline` / `ghost` / `destructive` · sizes: `mini` / `small` / `default` / `large` / `icon` · `leftIcon`, `rightIcon` |
| `Badge` | variants: `primary` / `brand` / `secondary` / `outline` / `destructive` / `success` / `warning` / `info` · `dot`, `pill` |
| `Input` | `leftIcon`, `rightIcon`, `error`, `placeholder` |
| `Avatar` | sizes + initials/image fallback |

### `FormControls.jsx`
Checkbox · Radio · Switch · Textarea · Select · Slider · Label group.

### `Calendar.jsx`
Date picker / month grid.

### `Widgets.jsx`
Cards, alerts, tabs, toggles, pagination, dropdown menus, dialogs.

### `Shell.jsx`
App shell — `Sidebar` (256px ↔ 64px collapsed, nav items: Overview, My Games, Achievements, Inventory, Friends, Wallet, Notifications, Settings) and `Topbar`.

### Button states reference

| Variant | Background | Border | Foreground | Hover bg |
|---|---|---|---|---|
| `primary` | `#f05a22` | `#f05a22` | `#fff` | `#f54a00` |
| `neutral` | `#171717` | `#171717` | `#fafafa` | `#262626` |
| `secondary` | `#f5f5f5` | transparent | `#171717` | `#e5e5e5` |
| `outline` | `#fff` | `#e5e5e5` | `#171717` | `#fafafa` |
| `ghost` | transparent | transparent | `#171717` | `#f5f5f5` |
| `destructive` | `#dc2626` | `#dc2626` | `#fff` | `#b91c1c` |

### Button sizes

| Size | Padding | Font | Height | Gap |
|---|---|---|---|---|
| `mini` | `4px 8px` | 12px | 24px | 4px |
| `small` | `6px 12px` | 13px | 32px | 6px |
| `default` | `8px 14px` | 14px | 36px | 6px |
| `large` | `10px 18px` | 15px | 44px | 8px |
| `icon` | `0` | 14px | 36×36px | — |

Border radius: `9999px` (pill) on all buttons.

### Badge variants

| Variant | Background | Foreground |
|---|---|---|
| `primary` | `#171717` | `#fafafa` |
| `brand` | `#f05a22` | `#fff` |
| `secondary` | `#f5f5f5` | `#171717` |
| `outline` | `#fff` (1px `#e5e5e5`) | `#171717` |
| `destructive` | `#dc2626` | `#fff` |
| `success` | `#d1fae5` | `#065f46` |
| `warning` | `#fef3c7` | `#92400e` |
| `info` | `#dbeafe` | `#1e40af` |

---

## Logos & Assets

Located under `assets/logo/`.

| File | Purpose |
|---|---|
| `vnggames-wordmark.svg` | VNGGames wordmark — italic "vnG" + "GAMES" in Geist Bold Italic, `#F05A22` + `#0A0A0A`. |
| `vnggames-com.svg` | vnggames.com lockup |
| `vnggames-light.png` / `vnggames-dark.png` | Wordmark raster, light + dark themes |
| `playerhub-wordmark.svg` | Player Hub product wordmark |
| `playerhub-mark.svg` | Player Hub app mark (square) |
| `appmark-light.png` / `appmark-dark.png` | App mark raster, light + dark |
| `levelup.png` | Level Up product mark |

> **Caveat:** Logos are re-typed SVGs from the Figma file (the original is stored as flattened multi-vector groups). **Please swap in official brand SVGs if available.**

---

## Reference CSS

The full token sheet ships as `colors_and_type.css`. Snippet:

```css
:root {
  /* Brand */
  --primary:              var(--orange-600);   /* VNGGames orange — the signature CTA color */
  --primary-foreground:   #ffffff;
  --primary-hover:        var(--orange-700);

  --brand:                var(--neutral-900);
  --brand-foreground:     var(--neutral-50);
  --brand-hover:          var(--neutral-800);

  /* Surfaces */
  --background:        var(--neutral-50);
  --foreground:        var(--neutral-950);
  --card:              #ffffff;
  --border:            var(--neutral-200);

  /* Radii — default 8px, cards 10px */
  --radius-md: 8px;
  --radius-lg: 10px;

  /* Type */
  --font-display: "League Gothic", "Inter", sans-serif;
  --font-sans:    "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-mono:    "Geist Mono", ui-monospace, monospace;
}
```

Load fonts via Google Fonts:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&family=Inter:wght@400;500;600;700&family=League+Gothic&display=swap" rel="stylesheet">
```

---

## Caveats

- **No codebase was provided** — all components are reconstructed from Figma pseudocode. Spacing / motion / exact hover colors are best-effort from static Figma screens.
- **Logos are re-typed SVGs.** The real VNGGames logo is stored as flattened vectors in Figma; the SVGs here are a faithful retype in Geist Bold Italic.
- **Fonts loaded via Google Fonts CDN** (Geist, Inter, Geist Mono, League Gothic). Swap in licensed webfonts if VNG has them.
- **"Player Hub" product branding** — the Figma file is the generic VNGGames shadcn kit, not a Player Hub-specific frame. The Player Hub UI kit is inferred from the generic "App example" screens.
- **Figma annotation purple** (`#9747FF`) appears in the source file as scaffolding. It is **NOT part of the end product**.
