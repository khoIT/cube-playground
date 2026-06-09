# 2026-06-09 — CS segment live count + per-segment sweep + edit-page redesign

## Context

**Plan:** `plans/260609-1654-cs-segment-live-count-sweep/`. Branch: `main`.

**Ask:** On `#/dashboards/cs` the "segments" are the 21 VIP-care playbooks. Let a CS manager edit a segment's filter condition, see how many VIPs match against LIVE Trino data ad-hoc, save the threshold, and immediately open/lapse cases for that one segment — a "manual sweep per segment." Plus a redesign of the segment edit page.

**Shipped:** read-only `preview-count` endpoint, a per-segment variant of the existing sweep, builder "Count matches" + "Save & sweep this segment", and a two-column form + sticky live-rail redesign of the PlaybookBuilder. 1073 server tests + 81 CS FE tests green; code review APPROVE_WITH_NITS (nits fixed).

## Decisions that mattered

### 1. The live count must reuse the sweep's exact pipeline — not a parallel one
The user's mental model was "re-query the SQLite cache." Wrong: SQLite holds case/profile **snapshots**, not raw VIP rows, so an adjustable count can only come from a live Cube/Trino query. The trap would have been writing a second cohort-count path. Instead `preview-count` builds a **transient `CarePlaybookOverride` (baseId:null)**, runs it through the *same* `mergePlaybooks` → compile → VIP-gate path, then reuses `makeCubeCohortFetcher` and returns `uids.length`. Result: a previewed count is provably equal to what a real sweep would open — there is no second filter builder to drift.

### 2. Fail-closed parity is a correctness invariant, not a nicety
`care-case-sweep.ts` skips a playbook whose predicate compiles to an **empty** Cube filter (an unsupported relative-date window, etc.) — otherwise the VIP-base gate is the only surviving filter and it matches the entire base. The preview route must replicate that exact `treeToCubeFilters(...).length === 0 → matched:0` guard, or it would report the whole VIP base as a "match." Copied the guard verbatim; covered by test.

### 3. Display id ≠ sweep target (sequel to the id-identity trap)
The prior journal documented display-id ≠ mutation-key for PATCH/DELETE. The sweep adds a *third* axis: a sweep filters playbooks by their merged **display** id, which after a save differs from the created DB row id. Seed-override → seed id; custom → row id; clone → created row id; new-with-base → base id. Extracted `resolveSweepTargetId()` as a pure, unit-tested helper next to `mutationTargetFor` so "Save & sweep" can't sweep the wrong (or no) playbook. Lesson: every new operation on these playbooks needs to ask "which id does *this* operation key on?" — there are now three different answers.

## Gotcha worth remembering

**`!discriminant` did not narrow a `useCallback`-returned discriminated union.** `buildFields()` (a `useCallback` typed `(): {fields}|{error}`) — `if (!built.ok) { built.error }` failed to narrow (`Property 'error' does not exist`), even with a named alias. Switching the shape to `{fields}|{error}` and narrowing with **`if ('error' in built)`** worked immediately. When boolean-discriminant narrowing on a hook-returned union misbehaves, reach for `in`-operator narrowing.

## Redesign note

Edit page restyled with the `huashu-design` skill, anchored to `plans/260608-2128-vip-care-cs-console-flow/VIP Care CS Console Flow.html` (left rail, flowmap topbar, page-header pattern, tokens). Two-column: left = the 4 authoring sections; right = a **sticky live rail** holding the match count, data-readiness, and Save / Save & sweep / Cancel — so the count and sweep stay in view while tuning the threshold. Tokens-only; viewer role hides the count button + save card (server is the authoritative gate).

## Unresolved

- Two seed playbooks depend on `user_gameplay_daily.clan_switched_recent` / `clan_left_recent` Cube members (a registry change outside this work) — confirm they exist for cfm_vn/jus_vn or those seeds resolve `unavailable` and never sweep.
- A single-playbook sweep records a normal run snapshot (its `summaries` contains just that playbook); acceptable, but the trend view will show partial runs.
