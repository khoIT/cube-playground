# Phase 06 — Monitor-tab refresh-cadence affordance

**Item:** (6, user-added) On the segment page, the user should be able to pick refresh
frequency to reduce backend load, with the UI suggesting standard intervals in the most
affordant way — surfaced where refresh history lives (Monitor tab).
**Priority:** Medium. **Status:** ⬜ planned. **Layer:** FE.

## CRITICAL prior-art finding (do NOT rebuild)
A cadence picker **already exists** and works end-to-end:
- `src/pages/Segments/status/segment-health-pill.tsx` (L62-84): popover with cadence options,
  PATCHes via `segmentsClient.update(segment.id, { refresh_cadence_min: min })`, parent
  callback `onCadenceChange`.
- Options come from `refresh-cadence.ts` (`cadenceOptionsFor()` ~L37-40).
- The cron (`server/src/jobs/cron-runner.ts`) **already respects** `refresh_cadence_min`:
  segment due when `age ≥ cadence×60s`; `NULL` cadence ⇒ never auto-refreshes (on-demand only).

So this phase is **re-surfacing + affordance + low-load default**, not new backend.

## Context links
- src/pages/Segments/detail/tabs/monitor-tab.tsx (stacks SizeTrend + RefreshHistory + ActivationSummary)
- src/pages/Segments/detail/tabs/monitor/refresh-history-section.tsx ("N hours ago" via formatDistanceToNowStrict; ISO-Z ts)
- src/pages/Segments/status/segment-health-pill.tsx (existing picker to mirror)
- src/api/segments-client.ts (`update(id, patch)` PATCH L55-60)
- src/lib/refresh-cadence.ts (`cadenceOptionsFor`)
- src/theme/tokens.css; segmented-control example: src/QueryBuilderV2/components/segmented-control.tsx

## Overview
Add an affordant cadence control at the top of the Monitor tab's refresh-history section: a
labeled, always-visible row — "Auto-refresh: [ Off · 15m · 1h · 6h · 24h ]" — using a segmented
control (more affordant than the header popover). Selecting an option PATCHes
`refresh_cadence_min` (Off ⇒ null) reusing the existing client + `onCadenceChange` parent sync.
Show next-run hint ("next ~in 42 min") derived from `last_refreshed_at + cadence`.

## Key insights
- **Affordance:** the header health-pill hides cadence behind a click. On the Monitor tab where
  users reason about refresh load, make it a visible segmented control with standard presets.
- **Low-load default messaging:** present longer intervals as the calm default; copy nudges
  toward less-frequent refresh ("Less frequent = lighter load"). Do NOT change existing
  create-time default silently (predicate default = 60m, set in push-modal/editor) — that's a
  confirmed value; only the *picker UX* changes here.
- **Single source of truth:** updating cadence here must sync the header pill (shared `segment`
  state via the same `onCadenceChange`/parent reload path) so both reflect the new value.
- Reuse `cadenceOptionsFor()` so option set stays consistent with the header pill.

## Requirements
- Monitor tab shows current cadence + a segmented-control picker with standard intervals
  incl. an explicit "Off / On-demand" (null) option.
- Selecting PATCHes `refresh_cadence_min`; optimistic + error toast (mirror health-pill).
- Header pill and Monitor picker stay in sync (one updated `segment`).
- Next-refresh hint when cadence set + `last_refreshed_at` present.
- Design tokens mandatory; mirror segmented-control + existing Monitor section card.

## Architecture
- New `src/pages/Segments/detail/tabs/monitor/cadence-control.tsx` (< 120 LoC): reuses
  `cadenceOptionsFor()`, segmented-control styling, `segmentsClient.update`, `onCadenceChange`.
- Mount at top of `refresh-history-section.tsx` (or as a sibling section header in monitor-tab.tsx).
- Lift cadence change to detail-view so header `SegmentHealthPill` re-renders with new value
  (it already accepts updated segment via parent state — reuse that wire).

## Related code files
- Create: `cadence-control.tsx`
- Modify: `monitor-tab.tsx` / `refresh-history-section.tsx` (mount), `detail-view.tsx` (state sync if needed)
- Reuse: `segments-client.ts`, `refresh-cadence.ts`, segmented-control styles
- Test: RTL — selecting an option calls `update` with the right `refresh_cadence_min`; "Off" sends null

## Implementation steps
1. Build `CadenceControl` (props: `segment`, `onCadenceChange`) — segmented control from
   `cadenceOptionsFor()` + an "Off" entry mapping to null; active = current value.
2. Wire PATCH + optimistic update + error toast (mirror health-pill try/catch).
3. Mount at top of Monitor refresh-history; add next-refresh hint.
4. Ensure header pill syncs (shared updated segment).
5. Token + dark-mode + adjacent-page visual cross-check.
6. RTL tests (set 1h, set Off→null, error path).

## Todo
- [ ] CadenceControl component (segmented, standard presets + Off)
- [ ] PATCH + optimistic + error toast
- [ ] Mount on Monitor tab + next-refresh hint
- [ ] Header-pill state sync
- [ ] Low-load nudge copy
- [ ] Tokens/dark-mode cross-check
- [ ] RTL tests

## Success criteria
- User changes refresh frequency from the Monitor tab with one obvious control; choosing a
  longer interval (or Off) demonstrably reduces auto-refresh frequency (cron honors it next tick);
  header pill reflects the same value; no visual drift from adjacent surfaces.

## Risk assessment
- **Two controls drift** → both read/write the same `refresh_cadence_min` + share `onCadenceChange`; sync verified in step 4.
- **Silent default change** → out of scope; only the picker UX changes, not stored defaults.

## Security / Design
- Design tokens MANDATORY (visible surface). Mirror `segmented-control.tsx` + Monitor section card.

## Open questions
1. Segmented control (always visible) vs popover (matches header) — recommend **segmented** for
   affordance. Confirm.
2. Persistent "Cadence: 60m" label + next-run hint on Monitor tab — include? (lean: yes.)
3. Exact preset set — reuse `cadenceOptionsFor()` as-is, or curate "low-load" presets
   (15m / 1h / 6h / 24h / Off)? (lean: reuse existing for consistency, add explicit Off.)
