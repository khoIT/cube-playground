# VNGGames Player Hub — Bundle

Importable design system bundle. Drop the whole folder into another project.

## Contents

- `VNGGames-Player-Hub-Design-System.md` — **main reference doc** (tokens, type, components, voice, all in one file)
- `README.md` — original project README (longer-form rationale + caveats)
- `colors_and_type.css` — drop-in CSS variables (light + dark mode, full token sheet)
- `assets/logo/` — VNGGames + Player Hub wordmarks, app marks (SVG + PNG light/dark)
- `fonts/LeagueGothic-Regular-VariableFont_wdth.ttf` — display font (Geist, Inter, Geist Mono load via Google Fonts CDN)
- `ui_kits/player-hub/` — reconstructed JSX component library:
  - `Primitives.jsx` — Icon, Button, Badge, Input, Avatar
  - `FormControls.jsx` — Checkbox, Radio, Switch, Textarea, Select, Slider
  - `Calendar.jsx` — date picker
  - `Widgets.jsx` — Card, Alert, Tabs, Pagination, Dropdown, Dialog
  - `Shell.jsx` — Sidebar + Topbar app shell
- `preview/` — one HTML card per concept (colors, type, shadows, radii, spacing, every component) — handy as a visual reference / Storybook substitute

## Quick start in a new project

```html
<link rel="stylesheet" href="colors_and_type.css">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&family=Inter:wght@400;500;600;700&family=League+Gothic&display=swap" rel="stylesheet">
```

Then use the tokens (`var(--primary)`, `var(--card)`, `var(--radius-lg)`, etc.) or pull JSX components from `ui_kits/player-hub/`.
