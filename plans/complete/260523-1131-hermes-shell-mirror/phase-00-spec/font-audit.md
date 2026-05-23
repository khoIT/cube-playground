# Font Audit

Compare font loading: cube-playground vs Hermes shell consumers.

---

## Hermes shell requires

| Family | Used by | T token |
|---|---|---|
| **Inter** (400/500/600/700) | All sidebar/topbar labels, body text | `T.fSans` |
| **League Gothic** (400) | Workspace pill subtitle? No — Kpi values + SectionHeader display; **shell does use it** for the workspace-pill glyph fontFamily | `T.fDisp` |
| **Geist Mono** (400/500) | SidebarSubheader, SearchTrigger kbd hint, mono identifiers | `T.fMono` |

---

## Cube-playground currently loads (verified `index.html`)

```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet" />
```

| Family | Loaded? | Weights |
|---|---|---|
| **Inter** | ✅ | 400, 500, 600, 700 |
| **Geist** | ✅ | 400, 500, 600, 700 |
| **Geist Mono** | ✅ | 400, 500 |
| **League Gothic** | ❌ | — |

---

## Gap

Only **League Gothic** is missing. Used in:

1. `workspace-pill.tsx` — glyph "VG" letterforms (`T.fDisp`, 11px)
2. `Kpi` primitive — large KPI numbers (`T.fDisp`, 36px) — used in restyled segment detail KPI strip
3. `SectionHeader` primitive — display headlines (`T.fDisp`, 40px) — used in restyled segment library/detail page titles

---

## Resolution

Edit `cube-playground/index.html`, add `League Gothic` to the existing Google Fonts link:

```diff
- <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet" />
+ <link href="https://fonts.googleapis.com/css2?family=League+Gothic&family=Inter:wght@400;500;600;700&family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet" />
```

Single line edit. League Gothic ships only one weight (400) per Google Fonts.

---

## Verification

After edit, in dev console:

```js
document.fonts.check('400 16px "League Gothic"')  // → true
```

If false (font load failed), fall back to Inter — `T.fDisp` already lists `"Inter"` as second choice: `'"League Gothic", "Inter", sans-serif'`.

---

## Done criteria

- [ ] `index.html` Google Fonts link updated with `League+Gothic`.
- [ ] Build + dev start → no console errors about missing fonts.
- [ ] Visual: workspace-pill glyph reads as condensed display letters (not Inter).
