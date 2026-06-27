---
phase: 5
title: "Frontend — activation tab: contract banner + schedule + per-segment tokens + promotion (C,D)"
status: pending
priority: P1
effort: "1.5d"
dependencies: [1, 3]
---

# Phase 5: Activation tab — contract, schedule, tokens, promotion (C+D)

## Overview
Reshape the activation tab so a served segment leads with its **serving contract** (consumers,
SLA, members, last pull) + an **edit guard**, shows the **snapshot schedule** cards
(cadence / last snapshot / next ready), and lists **per-app tokens** scoped to this segment with
an inline "Issue token for a new app". Draft segments show a "Publish for downstream" promotion.

## Requirements
- Functional: contract banner + schedule cards + tokens table + promotion modal; reuse existing pull recipes below.
- Non-functional: tokens reuse `apiKeysClient` (no new token CRUD); GMT+7 times; files <200 LOC.

## Architecture
Compose into `pull-api-tab.tsx` as sections gated on `serving.lifecycle`. **`pull-api-tab.tsx` is already 872 LOC and over the 200-LOC rule — split it while adding these sections, don't grow it.** Promotion calls Phase 1 publish.

⚠️ **CreateKeyModal reuse is an explicit refactor, not drop-in (red-team #13):** `CreateKeyModal`/`PlaintextReveal` are non-exported locals in `api-keys-tab.tsx` with no pre-scope prop, and `apiKeysClient.create` is **admin-only**. So this phase MUST: (a) extract both into a shared module (`src/components/api-keys/`) with new `defaultSegmentIds`/`defaultGameIds`/locked-scope props, verifying the admin tab still renders identically; (b) gate the "Issue token" affordance to **admin only** — a non-admin segment owner sees the read-only token list + a "Manage tokens →" deep-link to the admin API Keys tab (no owner-scoped mint endpoint added in v1).

## Related Code Files
- Modify: `src/pages/Segments/detail/tabs/pull-api-tab.tsx` (orchestrate sections by lifecycle)
- Create: `src/pages/Segments/detail/tabs/serving-contract-banner.tsx` (consumers/SLA/members/last-pull + edit guard)
- Create: `src/pages/Segments/detail/tabs/snapshot-schedule-cards.tsx` (cadence / last snapshot / next ready, GMT+7)
- Create: `src/pages/Segments/detail/tabs/segment-tokens-table.tsx` (tokens-by-segment from Phase 3; revoke; "Issue token")
- Create: `src/pages/Segments/detail/tabs/publish-segment-modal.tsx` (cadence + token + owner; calls publish)
- Reuse: `src/pages/Admin/hub/api-keys-tab.tsx` `CreateKeyModal`/`PlaintextReveal` (extract to shared if needed), `src/api/api-keys-client.ts`
- Read: `src/api/segments-client.ts` (add `getServing`, `getTokens` if not in detail payload)

## Implementation Steps
1. Fetch serving block (already on detail from Phase 1) + tokens (Phase 3). Branch: draft → promotion CTA; served → contract banner + schedule + tokens.
2. `serving-contract-banner`: violet contract surface mirroring the mock; edit guard warns "N consumers depend on this — edits apply next snapshot; renaming the id breaks integrations".
3. `snapshot-schedule-cards`: three cards; "Next ready" counts down to `serving.nextReadyAt` (GMT+7).
4. `segment-tokens-table`: rows from `/tokens`; columns app/key/scope/pulls-7d(sparkline)/last-pull/status/revoke; "Issue token for a new app" opens CreateKeyModal pre-scoped to this segment+game; one-time reveal on create.
5. `publish-segment-modal`: cadence select (default daily), token (reuse existing or mint new), owner; on confirm → publish endpoint → refresh tab into served state.
6. Keep existing pull recipe cards (`paginated-pull-card`, endpoint card) below the contract.

## Success Criteria
- [ ] Draft segment shows promotion CTA; publishing renders the contract + schedule + tokens without reload glitches.
- [ ] Tokens table lists segment-scoped + all-segments keys (appliesVia label); issuing a token pre-scopes to this segment.
- [ ] Next-ready countdown + last-snapshot read correctly in GMT+7.

## Risk Assessment
- Avoid duplicating token CRUD — extract `CreateKeyModal` to a shared module if importing from the admin hub is awkward (note the refactor; keep behavior identical).
- Feature parity: activation tab is also reachable in contexts without admin — gate token reveal/mint to admin, show read-only token list otherwise.
