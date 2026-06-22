# Phase 01 — Frontend Layout (fixes 3–6)

Priority: **High** · Status: TODO · Stack: Frontend only · No backend change.

## Overview

Pure renderer/CSS pass on the shared chat renderer. Ships independently of P02.
Four fixes: charts side-by-side, y-axis autoscale on trends, refine collapsed,
scope badge anchored, control consistency.

## Context links

- Plan: [plan.md](plan.md)
- Mockup: scratchpad `chat-redesign-mockup.html`
- Scout map: assistant-message.tsx, assistant-chart-section.tsx, query-refine-row.tsx

## Key insights (from scout)

- Body sections render via a loop over `bodyUnits` → `SectionRenderer`
  (`assistant-message.tsx:659–689`). Charts are individual full-width sections.
- Chart card non-embedded branch: `assistant-chart-section.tsx:154–227`.
  `embedded` flag exists — the compact panel path. Use it to force 1-col.
- Cartesian charts have **no `domain` prop** → recharts defaults to `[0, max]`
  (`assistant-chart-section.tsx`, e.g. line ~343/415). Scatter already uses
  `domain={['auto','auto']}` (~613/627) — the precedent for autoscale.
- Refine row (`query-refine-row.tsx:31–102`) always renders chips + free-text
  input. Used by `query-artifact-card.tsx:200` only when `onRefine` passed.
- Right-side panel passes `compact=true` (`chat-panel.tsx:206`); follow-up/refine
  may already be gated off there — verify, don't double-hide.

## Requirements

### Fix 3a — Charts in a responsive 2-col grid
**RED-TEAM CORRECTION:** most charts are NOT standalone `chart` sections — they're
EMBEDDED inside `query_artifact` cards (full cards carrying the refine + Playground
footer). So "group adjacent chart units" mostly groups *artifact cards*, and a
2-col grid squeezes the very chrome fix 4 wants to quiet. **Fix 3a and fix 4 are
COUPLED — sequence 4 before 3a** (collapse chrome first, then the slimmed cards
tile cleanly).
- Group **consecutive** chart-bearing units in `bodyUnits` (standalone `chart`
  sections AND `query_artifact` cards whose body is a chart) into one grid
  container (`grid-template-columns: 1fr 1fr; gap: 16px`).
- Collapse to 1-col when **`compact`** (NOT `embedded` — see correction below) OR
  container < ~900px.
- Non-chart units (text, proposal, disambig, non-chart artifacts) break the run
  and render full-width.
- Single trailing chart stays full-width (no lonely half-width card).

### Fix 3b — Y-axis autoscale on trend charts
- Add `domain` to `YAxis` for **line / area**, and the **line axis of dual-axis**
  charts: domain `[dataMin - pad, dataMax + pad]` (pad ≈ 5–8% of range).
- **Multi-line guard (red-team):** autoscaling a multi-series line where one
  series sits near zero exaggerates the others misleadingly. Apply autoscale only
  to **single-series** lines; multi-series lines keep a **0-floored** domain.
  (`spec.type` switch at `assistant-chart-section.tsx:337` cleanly distinguishes.)
- **Do NOT** touch bar / stacked-bar / grouped-bar / horizontal-bar axes — keep
  zero-based. Document the rationale inline (bar length encodes magnitude).
- Guard degenerate range (min==max) to avoid a collapsed domain.

### Fix 4 — Collapse the refine row
- Default: a single `Refine` affordance (text/icon button) in the card footer.
- Chips + free-text input render only when expanded (local `useState`).
- Keep `Open in Playground` as a quieter secondary action (de-emphasize vs. the
  current solid brand button — use ghost/link style per tokens).

### Fix 5 — Per-turn scope badge (DECIDED: per-turn)
- Existing `chat-header-focus-chip.tsx` is session-scoped — leave it.
- **Derive per-turn scope from the turn's own query artifact(s):** the turn already
  carries `artifacts[].query` (and `charts[].query`) — a `CubeQuery` with members +
  date range. Build a small FE helper `deriveTurnScope(turn)` → `{ members[],
  dateRange }`, render a pill under the user question (mockup style).
- **FE-only** — no backend/turn-shape change (data already on the turn). Confirm
  during impl that persisted history turns carry the same `query` shape as live ones.
- Edge cases: turn with no artifact (clarification) → no badge; multiple artifacts →
  show the primary/first + `+N` (matches the existing `+1` affordance).

### Fix 6 — Control consistency
- Header pills (`Auto-answer` / `Share with team` / `Debug`): unify weight;
  demote `Debug` to a quiet icon/ghost.
- Composer toggles (`Web Search` / `DeepThink` / `Bypass cache`): unify to one
  switch control type; group them. (`ChatComposer` in chat-thread-view path.)
- Lowest priority of the four — polish.

## Related code files

Modify:
- `src/pages/Chat/components/assistant-message.tsx` — grid grouping of chart runs
- `src/pages/Chat/components/assistant-chart-section.tsx` — YAxis domain per type;
  refine-collapse wiring; Playground button de-emphasis
- `src/pages/Chat/components/query-refine-row.tsx` — collapsed-by-default state
- composer + header chrome components — control unification (locate during impl)
- `src/theme/tokens.css` — reference only; add no new bespoke values

Read for context: `chat-message-list.tsx`, `chat-thread-view.tsx`, `chat-panel.tsx`.

## Implementation steps

1. Y-axis autoscale (fix 3b) — smallest, self-contained; single-line vs multi-line vs bar.
2. Refine collapse (fix 4) + Playground de-emphasis. **Do this BEFORE 3a** (charts
   live in artifact cards; slim the chrome before tiling).
3. Chart-run grid grouping (fix 3a) — most structural; gate 1-col on **`compact`**
   (threads at `assistant-message.tsx:467/514`), NOT `embedded`.
4. Per-turn scope badge (fix 5): `deriveTurnScope(turn)` from `artifacts[].query`;
   render pill under the question; no-artifact turns → no badge.
5. Control consistency (fix 6) — composer toggles + header pills.
6. Verify each in BOTH surfaces (full `/chat` + right panel) at wide + narrow widths.

## Todo

- [ ] Pin scope-chip + chrome components
- [ ] Y-axis autoscale (line/area/dual-line only; bars untouched)
- [ ] Refine collapse + Playground secondary styling
- [ ] Chart-run 2-col grid (1-col when compact/narrow)
- [ ] Per-turn scope badge: deriveTurnScope() + pill under question + no-artifact guard
- [ ] Header + composer control consistency
- [ ] Verify both surfaces, wide + narrow; dark mode check

## Success criteria

- Two charts in one turn render side-by-side on full page, stacked in the panel.
- A 185K–197K DAU line shows visible shape (not a flat line on a 0–200K axis);
  a bar chart still starts at 0.
- Refine is one row until expanded; Playground no longer competes visually.
- Scope chip sits with its question, not floating centered at top.
- No new hardcoded colors/spacing — tokens only; matches Dashboards/Segments.

## Risks

- **Grid grouping regressions**: interleaved text/chart ordering could break.
  Mitigate: only group *adjacent* chart units; everything else stays a full-width
  section in original order.
- **Panel width (red-team blocker)**: `embedded` does NOT reach `SectionRenderer`
  (`assistant-message.tsx:804`) — it's `QueryArtifactCard`'s internal layout flag.
  Gate the grid on **`compact`** (which IS in scope at `:467/514`). Using `embedded`
  would leave the 2-col grid rendering in the narrow panel. Test explicitly.
- **Autoscale on flat/single-point series**: guard zero-range data (min==max) to
  avoid a degenerate domain.

## Next steps

Independent of P02. After ship, verify against the mockup’s chart section.
