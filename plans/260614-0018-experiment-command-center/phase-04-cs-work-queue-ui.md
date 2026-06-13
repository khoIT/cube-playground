# Phase 04 — CS Work Queue UI

## Context links
- Report §4.3 item 3 (CS work queue = treatment-delivery surface, CS-facing).
- React/route patterns: `src/index.tsx` (lazy `loadable` + `Route`/`KeepAliveRoute`), `src/pages/Dashboards/cs/case-ledger.tsx` (the closest existing CS work surface — Care case ledger).
- API client pattern: `src/api/segment-cs-care-member.ts`, `src/api/api-client.ts` (`SegmentApiError`, workspace/game headers).
- Design: `docs/design-guidelines.md` + `src/theme/tokens.css`. Page-header pattern from `src/pages/Dashboards/index.tsx` / `src/pages/Liveops/cohort/index.tsx`.
- Sidebar: `src/shell/sidebar/sidebar.tsx` (SidebarSection/SidebarItem under a feature gate).

## Overview
- **Priority:** P1.
- **Status:** pending.
- A CS-facing list page: the treatment arm of a running experiment + the outreach script, workable/exportable by CS. No player push, no PII. This is the treatment-delivery surface.

## Key insights
- Route family: `/experiments` (home, Phase 6), `/experiments/:id/queue` (this page), `/experiments/:id/scorecard` (Phase 5), `/experiments/:id/members/:uid` (Phase 6). Register in `src/index.tsx` mirroring `/dashboards/cs/*` block.
- Reuse the design system strictly: page header (icon + 20px/700 title), table styled like the Care case ledger, status colors via semantic tokens. Cross-check against `case-ledger.tsx` before shipping.
- Feature gating: add `experiments` to `FeatureKey` (server `feature-keys.ts` + client `feature-open-beacon.ts`) and a `featureForRoute` rule (`['/experiments','experiments']`), so URL-level guard + sidebar visibility work like every other surface. Default-on (not in `DEFAULT_OFF_FEATURES`).

## Requirements
Functional:
1. Work-queue page: fetch `GET /api/experiments/:id/work-queue`; render member rows (uid, display name, reachability note), the outreach script block, and an experiment header (name, hypothesis, arm counts, assigned date).
2. Export action (CSV of uid + name) so CS can work it in their own tooling. Client-side blob download (KISS).
3. Empty/loading/error states matching existing pages.

Non-functional: lazy-loaded; KeepAlive optional (list page, cheap — plain `Route` is fine). Strict tokens, no inline hex.

## Data flow
```
route /experiments/:id/queue → useExperimentWorkQueue(id) → GET work-queue
  → render header + script + member table + CSV export
```

## Related code files
Create:
- `src/api/experiments-client.ts` (typed fetchers for all experiment endpoints — shared across Phases 4–6)
- `src/pages/Experiments/work-queue-page.tsx`
- `src/pages/Experiments/use-experiment-work-queue.ts`
- `src/pages/Experiments/experiment-header.tsx` (shared header, reused by Phases 5–6)
- `src/pages/Experiments/experiments.module.css` (shared styles)

Modify:
- `src/index.tsx` — `loadable` import + `Route key="experiments-queue" path="/experiments/:id/queue"`.
- `src/shell/sidebar/sidebar.tsx` — add an Experiments `SidebarSection` (icon e.g. `FlaskConical`/`Beaker` from lucide) gated by `showSection('experiments')`.
- `src/api/feature-open-beacon.ts` — add `'experiments'` to `FeatureKey` + `featureForPath`.
- `src/auth/feature-access.ts` — add `['/experiments','experiments']` to `featureForRoute`.
- `server/src/auth/feature-keys.ts` — add `'experiments'` to `FEATURE_KEYS`.

Read for context: `case-ledger.tsx`, `segment-cs-care-member.ts`, `sidebar.tsx`, `index.tsx`, `design-guidelines.md`.

## Implementation steps
1. `experiments-client.ts` — `listExperiments(game)`, `getExperiment(id)`, `createExperiment(...)`, `assignExperiment(id)`, `getWorkQueue(id)`, `getScorecard(id)`, `getExperimentMember(id,uid)`. Use `apiFetch`/`SegmentApiError` from `api-client.ts`.
2. Add `experiments` FeatureKey in server + client (4 files above) — do this first so routing/sidebar compile.
3. `experiment-header.tsx` — shared header component (name, hypothesis, arm counts, status pill, assigned date) using tokens.
4. `use-experiment-work-queue.ts` — fetch hook (loading/error/data).
5. `work-queue-page.tsx` — header + script block + member table + CSV export button. Match `case-ledger.tsx` table styling.
6. Wire `src/index.tsx` route + sidebar section.
7. Compile + lint (`npm run build` / `tsc --noEmit`).

## Todo
- [ ] add `experiments` FeatureKey (server + client + 2 route maps)
- [ ] `experiments-client.ts`
- [ ] `experiment-header.tsx`
- [ ] `use-experiment-work-queue.ts`
- [ ] `work-queue-page.tsx` + CSV export
- [ ] route + sidebar wiring
- [ ] compile clean, visual cross-check vs case-ledger

## Success criteria
- Navigating `/experiments/:id/queue` renders the treatment arm + script; CSV export downloads uid+name.
- Sidebar shows Experiments; feature-route guard redirects when feature disabled.
- Visual parity with Care case ledger (typography, padding, radius, tokens) — no raw hex, one font stack.

## Risks
| Risk | L×I | Mitigation |
|---|---|---|
| Design drift from system | M×M | Copy `case-ledger.tsx` structure; cross-check before ship (design-guidelines rule 6). |
| FeatureKey added in only one of server/client | M×M | Add in all 4 files in step 2; compile catches client type, server FEATURE_KEYS list is the authority. |
| CSV export tempts adding PII columns | L×H | Export = uid + name only; reviewer checks columns. |

## Security (PII)
- Page renders only what `/work-queue` returns (uid, name, reachability note, script). No contact PII client-side. CSV mirrors the same allow-list.

## Next steps
Phase 5 (scorecard) + Phase 6 (home/list + member drilldown) share `experiments-client.ts` and `experiment-header.tsx`.
