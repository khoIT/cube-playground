# Phase 2 — Builder: Count matches + Save & sweep segment

## Context links
- Builder page: `src/pages/Dashboards/cs/playbook-builder.tsx` (full read done).
  - Form state: `condition` (`ThresholdRule`) `:779`, `predicateHelpers` (`usePredicateState`) `:785`, `watchedMetric/action*` `:780-783`.
  - `pickedMembers`/`availableMembers`/`allMembersAvailable` derived `:817-829`.
  - `handleSave` `:837-918` — builds `fields`, routes via `mutationTargetFor` to `updatePlaybook`/`createPlaybook`, then `history.push('/dashboards/cs')`.
  - Condition card `:1073-1107` (ConditionEditor + SupplementalPredicateSection + readiness panel). Save bar `:1196-1263`.
- Mutations: `use-playbook-mutations.ts` `createPlaybook` `:82`, `updatePlaybook` `:99`. `apiFetch` from `src/api/api-client`.
- Mutation routing: `playbook-mutation-target.ts` `mutationTargetFor`.
- Blocked by: Phase 1 (`preview-count` + `sweep?playbook=` endpoints).

## Overview
- Priority: P2. Status: pending. Blocked by Phase 1.
- Two new affordances on the builder, design-token-only, mirroring existing styles:
  1. "Count matches" button in the Condition card → POST current form condition to `preview-count` → show `matched` + `elapsedMs`.
  2. "Save & sweep this segment" button in the save bar → existing save, THEN `POST sweep?playbook=<id>` → show opened/lapsed.

## Key insights
- Build the preview body from the SAME pieces `handleSave` uses: `condition` + the supplemental tree (when `treeHasContent` && `predicateHelpers.isValid`). Send `supplementalPredicate: hasPredicate ? tree : null`. This guarantees previewed count == what a subsequent save+sweep opens (DRY with save logic — extract a small `buildConditionPayload()` closure so count + save can't drift).
- `:id` for the preview call: in edit mode use `editId`; for `new`/clone use the literal `"new"` (Phase 1 treats unknown/`new` as a fresh custom transient; baseId is irrelevant to the count). Pass `?game=gameId` (the builder already resolves `gameId` honoring `?game=` override `:755`).
- Cold Trino 3.5–15s → explicit-click only, with an AbortController + loading spinner. Disable the count button when `!allMembersAvailable` (availability gate already computed `:827`) or when condition has no member, mirroring the enable-block reasoning. Surface 409 (`PLAYBOOK_UNAVAILABLE`) and 502 (`PREVIEW_FAILED`) as inline messages.
- "Save & sweep" needs the persisted playbook's id to sweep. After `createPlaybook` the response is a `CarePlaybookOverride` whose `id` is the override row id — but the SWEEP filters on the RESOLVED display id (`runCaseSweep` filters `p.id === onlyPlaybookId`). For a seed-override the resolved display id == seed id (`baseId`); for net-new/custom it == the override row id. So:
  - edit-seed (`createFromSeed`) / clone-from-seed: sweep `playbook = baseId` (seed id).
  - patch (override/custom): sweep `playbook = sourcePlaybook.id` (already the display id).
  - net-new (no base): sweep `playbook = created.id`.
  Encode this in a `resolveSweepTargetId(target, created, sourcePlaybook, isClone)` helper next to the save logic so it tracks `mutationTargetFor` semantics. (This mirrors the lineage logic at `:878-890`.)

## Requirements
- New hook `src/pages/Dashboards/cs/use-playbook-preview.ts` (<70 lines):
  - `previewCount(gameId, playbookId, body, signal)` → `POST /api/care/playbooks/:id/preview-count?game=` via `apiFetch`, returns `{ matched, elapsedMs, gated, note? }`.
  - `sweepSegment(gameId, playbookId, signal)` → `POST /api/care/cases/sweep?game=&playbook=` returns `{ opened, lapsed, summaries }`.
- Builder additions (in `playbook-builder.tsx`, keep file growth modest — extract the count UI into a small local `<CountMatchesRow>` component if the card crosses ~40 added lines):
  - In Condition card (after readiness panel `:1106`): a "Count matches" button + result line (`{matched} VIPs match · {elapsedMs}ms` or error). State: `counting`, `countResult`, `countError`, `countAbortRef`.
  - In save bar: keep existing "Save playbook" (plain save, unchanged). ADD "Save & sweep this segment" button (secondary-brand styling) → runs `handleSave`'s persistence path, captures the persisted id via `resolveSweepTargetId`, then `sweepSegment(...)`, then shows `{opened} opened · {lapsed} lapsed` inline before navigating (or stay on page and show a toast-style result block; choose: show result block + a "Back to monitor" link so the user sees the outcome). State: `sweeping`, `sweepResult`, `sweepError`.
  - Refactor `handleSave` to expose a `persist()` that returns the persisted display id (so both "Save" and "Save & sweep" reuse it — DRY; avoids duplicating the 4-branch mutation routing). "Save" calls `persist()` then navigates; "Save & sweep" calls `persist()` then `sweepSegment()`.
- Disabled states: count + save&sweep disabled while `saving || sweeping || counting`, when `!name.trim()`, and count specifically also disabled when no condition member or `!allMembersAvailable`.

## Data flow
```
[Count matches click] → buildConditionPayload() → previewCount(game, id|'new', payload)
  → render matched + elapsedMs (or 409/502 message)
[Save & sweep click] → persist() (POST/PATCH) → resolveSweepTargetId → sweepSegment(game, displayId)
  → render opened/lapsed → "Back to monitor"
```

## Related code files
- Modify: `src/pages/Dashboards/cs/playbook-builder.tsx`.
- Create: `src/pages/Dashboards/cs/use-playbook-preview.ts`, test `src/pages/Dashboards/cs/__tests__/playbook-builder-preview.test.tsx` (or co-located per existing test convention — check `__tests__` dir).
- Read for context: `use-playbook-mutations.ts`, `playbook-mutation-target.ts`.

## Implementation steps
1. Add `use-playbook-preview.ts` (two thin `apiFetch` wrappers + response types).
2. Extract `buildConditionPayload()` + `persist()` from `handleSave`; wire plain Save through `persist()`.
3. Add `<CountMatchesRow>` to Condition card with loading/abort/error.
4. Add "Save & sweep this segment" + `resolveSweepTargetId` + result block.
5. Test: mock `apiFetch`; assert count button POSTs the current condition (+ supplemental when valid) to the right URL with `?game=`; assert save&sweep persists then sweeps the correct display id per source; assert no count fires on keystroke.

## Todo list
- [ ] `use-playbook-preview.ts`
- [ ] refactor `persist()` / `buildConditionPayload()`
- [ ] Count matches row (loading/abort/error, availability-gated)
- [ ] Save & sweep button + `resolveSweepTargetId` + result block
- [ ] builder preview/sweep test
- [ ] `npm test` (or vitest) green; tsc clean

## Success criteria
- Editing a condition and clicking "Count matches" shows a live count within the Trino latency window; no count fires on keystroke.
- "Save & sweep this segment" persists then opens/lapses cases for exactly that playbook; result visible before leaving the page.
- Plain "Save" behavior unchanged (still navigates to monitor).
- Tokens-only; visually matches existing builder cards.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Sweep target id wrong (override vs seed vs custom) | M×H | `resolveSweepTargetId` mirrors `mutationTargetFor` branches `:878-890`; covered by test per source. |
| Count + save payloads drift | M×M | Single `buildConditionPayload()` shared by both. |
| Half-built supplemental tree sent to count | L×M | Reuse `treeHasContent && isValid` guard from save `:856`; else omit supplemental. |
| Double-submit / stale count after edit | L×L | AbortController per count; clear `countResult` on condition change. |
| Long Trino wait perceived as hang | M×M | Spinner + "querying live Trino (can take ~10s)" hint. |

## Security considerations
- Viewer role: count/save&sweep buttons hidden alongside existing save bar (`!isViewer` guard `:1197`). Server still authoritative.

## Next steps
Independent of Phase 3; both consume Phase 1 endpoints.

## Open questions
1. After "Save & sweep", stay on builder with result + Back link, or auto-navigate to the queue filtered to this playbook? (Plan: stay + show result + link; confirm UX.)
