---
phase: 6
title: "Step 5 Identity — name/title/desc/format/grain/visibility/tags (reuse existing TagCombo)"
status: completed
priority: P2
effort: "0.75d"
dependencies: [5]
---

# Phase 6: Identity step grain visibility tags

## Overview

Step 5 — the metric's API contract. Form fields: name (snake_case validated), title (required), description (textarea), format (5 options w/ preview), time grain (4-opt seg), visibility (3-opt select), tags. Right rail shows live YAML preview from `generate-measure-yaml` (P1 v2 emitter). Auto-name button populates name + title from op + column + filter signature.

**Red-team-applied (finding #6):** **Reuse existing `<TagCombo>` (`src/QueryBuilderV2/NewMetric/components/tag-combo.tsx`, 212 LOC) and `useExistingTags` (`src/QueryBuilderV2/NewMetric/hooks/use-existing-tags.ts`, 32 LOC).** Both ship today w/ chips + suggestions + keyboard nav. Do NOT reimplement. P8 moves both to KEEP list.

**Red-team-applied (finding #21):** YAML preview component renders tokens through React text nodes inside coloured `<span>`s — explicit ban on `dangerouslySetInnerHTML`.

## Requirements

**Functional:**
- **Name** — controlled input, mono font, validate `^[a-z0-9_]+$`; suffix pill: green "unique" when valid + no collision in source-cube measures, amber "invalid" otherwise.
- **Title** — controlled; required (non-empty).
- **Description** — textarea, optional.
- **Format** — select w/ preview: `number` (`1,234,567`), `currency-vnd` (`₫ 8.42B`), `currency-usd` (`$ 8.42M`), `percent` (`12.4%`), `duration` (`12m 24s`). Live preview row beneath select.
- **Time grain** — segmented `Hourly / Daily / Weekly / Monthly`; default `daily`. Stored under `draft.grain` → emitted as `meta.grain`.
- **Visibility** — select: `Team · Live-ops` / `Whole org` / `Just me`. Stored under `draft.visibility` → emitted as `meta.visibility`. (Display-only metadata until a consumer ships.)
- **Tags** — **reuse `<TagCombo>` from `src/QueryBuilderV2/NewMetric/components/tag-combo.tsx` directly.** Suggestion source via `useExistingTags()` (existing hook computes the union of `meta.tags` across all measures, sorted, deduped). No new tag input component.
- **Auto-name from inputs** button — derives name = `${op}_${col}_${filter-sig}`, title = `${OpName} of ${col humanized}${ — filter summary}`. Fills only blanks; never overwrites. Filter signature handles nested OR groups by collapsing to `${col}_${first-value}` for each top-level child.
- Right-rail **YAML preview** — pure component reading the full draft + reachable members; calls `generate-measure-yaml` (P1 v2 emitter). Token-coloured via React text nodes inside `<span>` (orange keywords, green strings, yellow values). Debounce 100 ms. **No `dangerouslySetInnerHTML`.**
- LeftRail Step 5 row summary: `state.identity.name || "Name & format…"`; badge ✓ when name + title valid.
- Validation card row 3 ("Identity set") ticks green once name + title valid.
- StepFooter Continue label "Continue to test run"; disabled until name + title valid.

**Non-functional:**
- Name uniqueness check runs against `meta.cubes.find(c.name === sourceCube).measures` — same-cube only (POC).
- Description supports literal `>-` YAML folded scalar (existing in v1 emitter).
- All files < 200 LOC.
- No `dangerouslySetInnerHTML` in any new file.

## Architecture

```
src/QueryBuilderV2/NewMetric/full-page/steps/step-5-identity/
├── index.tsx
├── identity-body.tsx                   form layout
├── controlled-input.tsx                mono / regular variants w/ suffix slot
├── format-select.tsx
├── grain-seg-control.tsx
├── visibility-select.tsx
├── auto-name-button.tsx
├── yaml-preview-rail.tsx               live YAML w/ React-text-node coloring (NO innerHTML)
├── format-options.ts                   5-option constant
└── __tests__/
    ├── controlled-input.test.tsx
    └── yaml-preview-rail.test.tsx      includes XSS-payload assertion
```

**Reused (NOT recreated):**
- `src/QueryBuilderV2/NewMetric/components/tag-combo.tsx` — chip combo
- `src/QueryBuilderV2/NewMetric/hooks/use-existing-tags.ts` — suggestion source

## Related Code Files

- **Create:** all files above (note: NO `tag-combo-input.tsx`)
- **Modify:** `src/QueryBuilderV2/NewMetric/full-page/NewMetricPage.tsx` — render step-5 when `currentStep === 5`
- **Reuse:** `yaml/generate-measure-yaml.ts` (P1 v2 emitter), `components/tag-combo.tsx`, `hooks/use-existing-tags.ts`

## Implementation Steps (TDD)

1. **Write tests first:**
   - `controlled-input.test.tsx` — typing fires onChange; invalid suffix renders on regex fail; mono variant uses Geist Mono.
   - `yaml-preview-rail.test.tsx` — given populated draft, renders YAML containing `name:`, `title:`, `type:`, `sql:`, `meta:`, `grain:`, `visibility:`, `tags: [...]`. **XSS test:** `description: '<script>alert(1)</script>'` renders literal `<script>` characters in DOM, not an element.
2. **Implement `format-options.ts`** — 5-entry constant w/ id, label, preview, prefix icon.
3. **Implement `controlled-input.tsx`** — controlled, props for prefix + suffix slots, mono variant.
4. **Implement `format-select.tsx`, `grain-seg-control.tsx`, `visibility-select.tsx`** using existing ui-kit primitives where they fit, else styled-components.
5. **Wire `<TagCombo>` directly** — import existing component + existing `useExistingTags()` hook. No new tag component file.
6. **Implement `auto-name-button.tsx`** — calls `actions.autoName()` on draft hook; the hook computes signature from op + col + filterTree (canonicalised).
7. **Implement `yaml-preview-rail.tsx`** — wraps `generate-measure-yaml`; debounce 100 ms; token-coloured via React text nodes (orange keywords, green strings, yellow values). **No `dangerouslySetInnerHTML`.**
8. **Implement `identity-body.tsx`** — grid layout matching mockup (name+title row, description, format+grain+visibility row, tags row).
9. **Wire validation** — name + title both valid → tick "Identity set" in LeftRail validation card → enable Continue.
10. **Manual QA** — fill name/title/desc; toggle format/grain/visibility; add tags via reused TagCombo; observe live YAML on right; click Auto-name; reload page → all fields restored.
11. Typecheck + tests + commit.

## Success Criteria

- [ ] Step 5 form renders all 7 controls (name, title, description, format, grain, visibility, tags).
- [ ] Name validation: `^[a-z0-9_]+$` + same-cube collision check; suffix pill toggles green/amber.
- [ ] Format preview row updates on selection.
- [ ] Auto-name button fills blank name + title from op + col + filter signature; never overwrites.
- [ ] **Tag input is the existing `<TagCombo>`** — no new tag component created; grep `tag-combo-input` returns zero matches.
- [ ] Right-rail YAML updates live on field change; debounced.
- [ ] YAML contains `meta.grain`, `meta.visibility`, `tags: [...]`.
- [ ] LeftRail Step 5 row + validation card "Identity set" tick green when name + title valid.
- [ ] Continue disabled until name + title valid; navigates to Step 6 placeholder.
- [ ] **XSS test green:** `<script>` in description renders as literal text in YAML preview.
- [ ] No `dangerouslySetInnerHTML` (grep clean).
- [ ] Typecheck + tests green; every new file < 200 LOC.

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Name collision check incomplete (only same-cube) misses cross-cube clashes | Documented POC scope; Cube parser fails server-side on rare duplicate — surfaced via P7 test-run. |
| YAML rendering on every keystroke is laggy | 100 ms debounce; render as `<pre>` rather than per-token spans for long descriptions; cap at 4 KB. |
| Existing `<TagCombo>` keyboard nav diverges from mockup | Acceptable — existing UX already shipped in v1. If divergence is glaring, file a small follow-up; do NOT fork. |
| Grain / visibility "dead metadata" until consumer ships | Acknowledged; stored under `meta:` for future consumers (dashboard groupings, ACL). |
| `auto-name` clobbers user input | Hook only fills if existing field is empty (tested in P1 draft tests). |
| Token-colored YAML preview without `dangerouslySetInnerHTML` is more code | Worth it — XSS surface is real per red-team #21. Render each token as a `<span style={{ color: tokenColor }}>{text}</span>`. |
