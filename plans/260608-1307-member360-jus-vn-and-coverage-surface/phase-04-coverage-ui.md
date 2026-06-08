# Phase 04 — Coverage UI (admin Dev tab + end-user states)

## Overview
- Priority: P2
- Status: not started
- Depends on: phase-03 (coverage endpoint + hook)
- Repo: cube-playground (FE)
- Design reference: `design/member360-coverage-uis.html` (v2, locked) + `coverage-uis-v2-light.png`

## Locked design decisions
- **Placement = inside the Sys-admin hub, "Dev" tab at `/admin/dev`** (admin role-guarded already).
  NOT a Drift Center rename — the Health Center idea is dropped; Drift Center stays as metric-drift.
- `/admin/dev` currently renders only `CrossUserAuditPanel`. Add a light sub-tab bar there:
  **"Chat-Audit"** (existing panel, default) + **"Data coverage"** (new). Routes:
  `/admin/dev/chat-audit` (or keep `/admin/dev` default = chat-audit) and `/admin/dev/data-coverage`.
- **Data coverage = ALL-GAMES matrix** (rows = games, cols = 360 surfaces, cell = status dot),
  click a cell → resolve pane below.
- **Chain = dot stepper** (B), **status = dot + label** pill (B).
- **Target games:** ballistar + cfm_vn (verify ready) + jus_vn (new). Matrix lists all games.
- **Scope = local cube workspace first.** Prod (prefixed/upstream) parity = tracked follow-up;
  show the prod info-banner explaining local-only.

## Surface A — Admin · Dev · Data coverage
1. In `src/pages/Admin/hub/index.tsx`, the `/admin/dev` route currently renders `CrossUserAuditPanel`.
   Wrap it in a small sub-tab shell (reuse `TabShell` or a local segmented control):
   - `Chat-Audit` → `CrossUserAuditPanel` (unchanged, default).
   - `Data coverage` → new `Member360CoveragePanel`.
2. `Member360CoveragePanel`:
   - Summary strip: `N games · M surfaces · X ready / Y partial / Z empty / W blocked`.
   - All-games matrix `<table>`: sticky game column + one col per 360 surface; cell = `cell-dot`
     colored by status (na = greyed); selected cell ringed with `--brand`; horizontal-scroll wrapper.
   - Resolve pane (below) for the selected game×view: big dot-stepper chain w/ broken layer named,
     plain explanation, missing-member tokens (struck-through), and **layer-aware actions**:
     - `view-not-modeled` → primary **Scaffold view draft** + **Open upstream** + Mark N/A.
     - `trino-table-missing` → **File data request** + Mark N/A.
     - `modeled-empty` → **Re-probe** + **Mark expected-empty**.
   - Prod-prefix info banner (local-only scope note).
3. Data from `use-member360-coverage` (phase-03). Admin guard already enforced by the hub route.

## Surface B — End-user states
1. **Members tab (fully blocked):** `sample-users-tab.tsx` / `tiered-members-view.tsx` — when
   `!hasMember360(game)`, non-clickable row + muted "Unavailable" chip + tooltip
   "Profile dashboards aren't available for this game yet." Plain language, zero pipeline jargon.
2. **Member 360 partial:** `member-360-view.tsx` — render computable panels; for unavailable ones
   keep card chrome but dashed border + muted icon + one line ("… not available yet"); header
   "Partial data" pill.

## Design compliance (MANDATORY)
Tokens only, `var(--font-sans)`, semantic dot+ink pills, dark-mode safe. Match the locked HTML
reference + adjacent admin-hub tabs (Observability, Users & Access). No bespoke hex/spacing.

## Related files
- Edit: `src/pages/Admin/hub/index.tsx` (`/admin/dev` route → sub-tab shell), add tab def.
- Create: `src/pages/Admin/hub/member360-coverage-panel.tsx` (matrix + resolve) + sub-components;
  `src/pages/Settings/use-member360-coverage.ts` (phase-03 hook).
- Edit (end-user): `member-360-view.tsx`, `sample-users-tab.tsx`, `tiered-members-view.tsx`.
- Drift Center: unchanged.

## Success criteria
- `/admin/dev` shows Chat-Audit (default) + Data coverage sub-tabs; Data coverage renders the
  all-games matrix; clicking a cell opens the resolve pane with correct layer-aware actions.
- ballistar/cfm_vn read ready; jus_vn core surfaces ready (post phase-01/02), event panels na.
- Members tab shows the unavailable chip+tooltip for non-covered games; partial 360 renders
  placeholders. Visual parity with the locked reference.

## Open questions
1. `/admin/dev` sub-tab default — keep Chat-Audit default (preserve current bookmarks) — assume yes.
2. Scaffold-draft output: writes to local `cube-dev` working-copy path — confirm target path +
   diff/toast vs silent write.
