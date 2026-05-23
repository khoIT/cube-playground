# Token Inventory — Hermes → cube-playground

**Source:** `hermes/apps/web/src/theme-tokens.css` (150 lines, light + dark).
**Target:** `cube-playground/src/theme/tokens.css` (append, don't replace).
**Rule:** Cube's existing vars (`--brand`, `--bg-card`, `--text-primary`, …) untouched. AntD overrides unchanged.

---

## Patch to apply (verbatim values from Hermes)

Append below cube's existing `:root` block in `tokens.css`:

```css
/* ──────────────────────────────────────────────────────────────────────
   Hermes shell tokens — light. Used by src/shell/* exclusively.
   Cube's --brand / --bg-card / --text-primary etc. remain authoritative
   for AntD-styled surfaces (Playground, Catalog, segment detail tabs).
   ────────────────────────────────────────────────────────────────────── */
:root {
  --hermes-n50:  #fafafa;
  --hermes-n100: #f5f5f5;
  --hermes-n200: #e5e5e5;
  --hermes-n300: #d4d4d4;
  --hermes-n400: #a3a3a3;
  --hermes-n500: #737373;
  --hermes-n600: #525252;
  --hermes-n700: #404040;
  --hermes-n800: #262626;
  --hermes-n900: #171717;
  --hermes-n950: #0a0a0a;

  --hermes-brand:        #f05a22;
  --hermes-brand-hover:  #f54a00;
  --hermes-brand-soft:   #fff7ed;
  --hermes-brand-border: #fed7aa;

  --hermes-red500:  #ef4444;
  --hermes-red600:  #dc2626;
  --hermes-red-soft: #fef2f2;

  --hermes-blue500:  #3b82f6;
  --hermes-blue600:  #3f8dff;
  --hermes-blue-soft: #eff6ff;

  --hermes-green600:  #059669;
  --hermes-green-soft: #ecfdf5;

  --hermes-amber500:  #f59e0b;
  --hermes-amber-soft: #fffbeb;

  --hermes-purple500:  #a855f7;
  --hermes-purple-soft: #faf5ff;

  --hermes-surface:        #ffffff;
  --hermes-surface-muted:  #fafaf6;
  --hermes-surface-subtle: #f9fafb;

  --hermes-shell:    #efe9e0;
  --hermes-sidebar:  #f9f6f2;
  --hermes-topbar:   rgba(249,246,242,0.92);
}
```

---

## Dark variant

Append below the light block. Cube uses `html[data-theme="dark"]` (verified in `index.html` boot script); Hermes uses `html.dark`. **Use cube's selector**:

```css
html[data-theme="dark"] {
  --hermes-n50:  #11161d;
  --hermes-n100: #161c25;
  --hermes-n200: #232a36;
  --hermes-n300: #2f3845;
  --hermes-n400: #525c6b;
  --hermes-n500: #8a93a3;
  --hermes-n600: #b1bac8;
  --hermes-n700: #cdd4df;
  --hermes-n800: #e2e7ee;
  --hermes-n900: #f0f3f8;
  --hermes-n950: #f8fafc;

  --hermes-brand:        #f06b3a;
  --hermes-brand-hover:  #f7894e;
  --hermes-brand-soft:   #2a1810;
  --hermes-brand-border: #5a3422;

  --hermes-red500:  #ef4444;
  --hermes-red600:  #f87171;
  --hermes-red-soft: #2a1416;

  --hermes-blue500:  #60a5fa;
  --hermes-blue600:  #6ea3ff;
  --hermes-blue-soft: #14213a;

  --hermes-green600:  #34d399;
  --hermes-green-soft: #0f2a20;

  --hermes-amber500:  #fbbf24;
  --hermes-amber-soft: #2a1f0a;

  --hermes-purple500:  #c084fc;
  --hermes-purple-soft: #1f1530;

  --hermes-surface:        #161c25;
  --hermes-surface-muted:  #11161d;
  --hermes-surface-subtle: #1b232f;

  --hermes-shell:    #07090c;
  --hermes-sidebar:  #0d1117;
  --hermes-topbar:   rgba(13,17,23,0.92);
}
```

---

## Theme.tsx (in `src/shell/theme.tsx`)

Direct port from `hermes/apps/web/src/theme.tsx` lines 17-58. The `T` proxy reads `var(--hermes-*)`. No edits needed.

```ts
export const T = {
  n50: 'var(--hermes-n50)',  n100: 'var(--hermes-n100)',  …  n950: 'var(--hermes-n950)',
  brand: 'var(--hermes-brand)',  brandHover: 'var(--hermes-brand-hover)',
  brandSoft: 'var(--hermes-brand-soft)',  brandBorder: 'var(--hermes-brand-border)',
  red500: 'var(--hermes-red500)',  red600: 'var(--hermes-red600)',  redSoft: 'var(--hermes-red-soft)',
  blue500: 'var(--hermes-blue500)',  blue600: 'var(--hermes-blue600)',  blueSoft: 'var(--hermes-blue-soft)',
  green600: 'var(--hermes-green600)',  greenSoft: 'var(--hermes-green-soft)',
  amber500: 'var(--hermes-amber500)',  amberSoft: 'var(--hermes-amber-soft)',
  purple500: 'var(--hermes-purple500)',  purpleSoft: 'var(--hermes-purple-soft)',
  surface: 'var(--hermes-surface)',  surfaceMuted: 'var(--hermes-surface-muted)',
  surfaceSubtle: 'var(--hermes-surface-subtle)',
  shell: 'var(--hermes-shell)',  sidebar: 'var(--hermes-sidebar)',  topbar: 'var(--hermes-topbar)',
  fDisp: '"League Gothic", "Inter", sans-serif',
  fSans: '"Inter", ui-sans-serif, system-ui, sans-serif',
  fMono: '"Geist Mono", "JetBrains Mono", ui-monospace, Menlo, monospace',
} as const;
```

---

## Selector mismatch — IMPORTANT

| | Hermes | cube-playground (existing) | Resolution |
|---|---|---|---|
| Dark mode toggle | `html.dark` | `html[data-theme="dark"]` | Use cube's selector in the dark block above. **Do not touch** cube's existing `ThemeContext`. |

The `data-hermes-surface="card"` / `[style*="background:#fff"]` overrides from `theme-tokens.css` lines 129-150 are **skipped** — those exist for Hermes pages that hardcode `#fff` inline. Our shell uses `T.surface` from day 1 so we don't need the safety net. If a regression surfaces, copy the rules then.

---

## Visual coexistence audit

Brand color: cube `--brand` = `#f05a22`, Hermes `--hermes-brand` = `#f05a22`. **Identical.** No clash.

Cube neutral scale vs Hermes neutral scale: cube uses semantic names (`--text-primary`, `--bg-card`); Hermes uses Tailwind-shape numeric scale. Both render side-by-side without interference because they target different consumers (AntD pages vs `src/shell/*`).

---

## Done criteria

- [ ] Light block appended to `src/theme/tokens.css`.
- [ ] Dark block appended; selector = `html[data-theme="dark"]`.
- [ ] `src/shell/theme.tsx` exports `T` + `Icon` + primitives (Button/Badge/Card/Input/Select/Switch/Tabs/Avatar/Kpi/SectionHeader/Sparkline are not all needed by the shell — copy only what shell consumes: `T`, `Icon`, `cx`).
- [ ] Toggle dark mode in cube → all `--hermes-*` consumers shift to dark values.
