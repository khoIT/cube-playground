# Warm Two-Tone Actioneer Shell Redesign Ship

**Date**: 2026-06-15 ~ 16:30  
**Severity**: Medium  
**Component**: App shell, theme tokens, page layouts  
**Status**: Resolved

## What Happened

Shipped 3 commits on main iterating the cube-playground app shell toward a warm, cohesive "Actioneer" visual system driven by user-provided design screenshots. Goal was to move from cool-grey isolated surfaces (Dashboards, Segments, Catalog, Ops, Chat artifacts all reading as separate cold islands) to one warm, unified palette.

Pushed to both origin (GitHub) and second (GitLab prod auto-deploy at playground.gds.vng.vn).

## The Brutal Truth

This was essential polish work that had been deferred too long. Every new surface was landing in its own visual accent (chat artifacts read "bolder", ops cards read "greyer", dashboards read "colder"). Users saw a fragmented product. Implementing the warm system forced us to confront the fact that many surfaces bypass semantic tokens and hardcode raw values or hermes theme object references — a root-cause drift generator we now have to fix.

The real payoff: one screenshot tells the story. Before/after side-by-side shows a product that *feels* intentional instead of evolved-by-committee.

## Technical Details

**Commits:**
- `294dd74` feat(shell): warm two-tone Actioneer app frame, clearer borders, icon polish
- `d9e8f89` fix(shell): shrink topbar bell badge so it no longer covers the icon
- `8624e21` feat(dashboards): curated CS/Ops previews, topbar title, stronger ops card borders

**Warm neutral scale added to `src/theme/tokens.css` (light mode `:root`):**
- `--neutral-50: #f3e9dd`
- `--neutral-100: #ecdfce`
- `--neutral-200: #e1d4c2`
- `--neutral-300: #d2c2ab`
- `--bg-app: #f8efe5` (page background)
- `--bg-card: #efe3d4` (card/panel background)
- `--bg-muted: #efe3d4` (muted surfaces)

**Key surface updates:**
- Shell background, sidebar, panels warmed via semantic bg tokens.
- Input backgrounds (`src/theme/antd-overrides.css`): Ant Design inputs were still cool white — forced to `var(--bg-card)` so search bar and query inputs harmonize.
- Query tabs (editable-card), result row-select cell backgrounds warmed.
- Chat artifact cards: hairline border + strong border combo was reading blurry on cream; added `--shadow-sm` for lift.
- Ops console cards: same pattern — `--border-card` → `--border-strong` + `--shadow-md`.
- Dashboards page: removed in-panel title (title moved to topbar breadcrumb), client-side hidden deprecated starter-pack dashboards, added curated CS·VIP Care + Ops Console preview cards with clearer CTA.
- Topbar bell badge: reduced size so it stops overlapping the icon.
- Sidebar sub-item icon indent: fixed alignment.

## What We Tried

Attempted a single-pass theme recolor early on — failed because many surfaces don't reference semantic tokens. Had to iterate surface-by-surface, discovering hard-coded hex references and hermes theme object values scattered across components. Led to targeted fixes rather than one global token swap.

## Root Cause Analysis

**Why drift happened:** The original system had semantic tokens (`--bg-card`, `--border-card`, etc.) but they were optional. When components were built quickly, devs reached for the nearest variable (`--neutral-*`, `T.colors.*` from hermes, or inline hex) instead of centralizing on the semantic layer. No linting rule enforced semantic tokens, so coupling between dark mode's need to pin neutrals cool and light mode's desire to warm them remained invisible until we tried to ship the warm palette.

**Why the fix works but is incomplete:** We updated all *discovered* usages, but the system still has bypass paths. Ant Design input defaults in `antd-overrides.css` had to be forced (not a natural application of semantic tokens). Other third-party libraries similarly don't know about our token names — they default to their own neutrals or styles we have to override.

## Lessons Learned

1. **Raw neutrals double as dark-mode text tokens.** In `tokens.css`, `--neutral-50` is `--text-primary` in dark mode and a light bg in light mode. Warming `--neutral-50` to cream in light `:root` forces a hard pin of cool-grey neutrals inside `:root[data-theme="dark"]`, or dark-mode text becomes unreadable cream. Light-mode surfaces only use neutral-50/100/200/300 for backgrounds and dividers (light text uses neutral-700/900), so warming light is safe — but document this coupling explicitly.

2. **Hairline borders on same-color backgrounds read blurry.** Cards now sitting on cream need lift via shadow (`--shadow-sm`/`--shadow-md`), not just a stronger border. This is a visual grammar insight: same-bg borders = blur; different-bg borders = clarity.

3. **Semantic tokens are a guideline, not a law.** Many surfaces still reference raw tokens, hermes objects, or hardcoded hex. This is the root motivation for a follow-up theme-centralization refactor: collapse all direct references onto the semantic layer so dark-mode coupling stops being a footgun and future recolors are one-pass instead of surface-by-surface archaeology.

4. **Client-side feature hides are fine for deprecation UX, but backend cleanup is still required.** We hid starter-pack dashboards from the UI this ship to unclutter the Dashboards page, but the server-side records still exist. This is correct (allows rollback), but it's a debt note for the next surface cleanup pass.

## Next Steps

1. **Theme centralization refactor (planned next cycle):** Audit all components for direct raw-token, hermes-object, and hex-code references. Collapse onto semantic tokens. Add optional linting rule to catch bypasses. Goal: make the entire app a single `tokens.css` knob (dark-mode coupling decoupled, recolors one-pass, new surfaces inherit coherence by default).

2. **Starter-pack dashboard server cleanup:** Delete the deprecated dashboard records from the database (not urgent; no user impact).

3. **Verify dark-mode visual parity:** Ship came together in light mode screenshots. Dark mode needs a review pass to confirm no unintended grey creep or contrast regressions.

---

## Unresolved Questions

- Should we add a linting rule (ESLint) to catch direct `--neutral-*` references outside of `tokens.css` definitions? Preventative or overkill for this team's velocity?
- Do we need a design-token audit tool to report all active bypasses (raw hex, hardcoded RGB, T.colors refs) across the codebase? Or is the follow-up refactor sufficient?
