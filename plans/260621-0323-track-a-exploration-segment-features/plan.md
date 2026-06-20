---
title: "Track A — data exploration + segment-creation surfaces"
description: "Four confirmed surfaces: segment overlap/compare, overlaid comparison chart, in-chat query refinement, heatmap drill-down."
status: pending
priority: P2
effort: ~5d
branch: main
tags: [segments, chat, charts, exploration]
created: 2026-06-21
---

# Track A — exploration + segment features

Four confirmed features (design locked, hi-fi mockup approved). The 5th original
item (membership history / churn) is OUT — already shipped as `TrajectoryCard` +
`MetricMovementCard` in `src/pages/Segments/detail/cards/`. Do NOT re-plan it.

Visual contract: the approved hi-fi mockup. Every surface uses design tokens from
`src/theme/tokens.css` (lint enforced by `scripts/lint-theme-tokens.mjs`). The one
allowed HEX exception is the heatmap ramp (`chart-heatmap.tsx` `STOPS`, in the
lint HEX_ALLOWLIST) — keep using it; add NO new inline hex.

## Phase sequence + rationale

Ordered by value × independence, hardest-to-verify last:

1. **Phase 01 — Segment overlap & compare** (highest value, self-contained
   server + FE; new route, new endpoint, reuses snapshot + create paths).
2. **Phase 04 — Heatmap drill-down** (small, reuses tokenless members API +
   existing chat→segment hand-off; chat-only scope verified).
3. **Phase 02 — Comparison chart overlay** (FE-heavy; `emit_combined_artifact`
   already emits one dual-axis spec — toggle + indexed rebase are FE-only).
4. **Phase 03 — Chat query refinement** (agent-behavior, hardest to verify;
   lowest-risk mechanism = FE chips compose a templated follow-up turn, reusing
   the existing `onFollowupPick` plumbing and the agent's `lastQuery` memory).

Note: file numbering follows feature identity (phase-04 = heatmap) per the
mockup; build order is 01 → 04 → 02 → 03 as above.

| # | Phase | Status | Surface |
|---|-------|--------|---------|
| 01 | [Segment overlap & compare](phase-01-segment-overlap-compare.md) | done | `/segments/compare` (new) + new server endpoint |
| 04 | [Heatmap drill-down](phase-04-heatmap-drilldown.md) | done | `chart-heatmap.tsx` (chat only) |
| 02 | [Comparison chart overlay](phase-02-comparison-chart-overlay.md) | done | `assistant-chart-section.tsx` view toggle |
| 03 | [Chat query refinement](phase-03-chat-query-refinement.md) | done | refine row under `query-artifact-card.tsx` |

## Implementation status (2026-06-21)

All four phases implemented + unit-tested (35 new tests). FE 449/449 and server
2099/2101 green (the 2 server failures are in `concept-reverse-index.test.ts` —
pre-existing, unrelated to this work). Theme-token lint clean. Independent
code-review: no blocking issues; two small a11y/scroll fixes applied + one
workspace-guard test added.

**Resolved Q1 (per-region metric exactness):** user chose "exact, use approx
when possible, accept latency". Implemented as an EXACT Cube identity-IN
aggregate over the full region up to `REGION_METRIC_UID_CAP` (1000); regions
larger than that are sampled and the result is flagged `sampled` with a visible
"estimated from a sample" disclosure (the cap is Cube's query-text IN-list
ceiling — a structural limit, not just latency). save-region always uses the
FULL region uid set; the cap applies only to the inline metric aggregate.

## Cross-cutting constraints

- **Design system MANDATORY** — read `docs/design-guidelines.md`; tokens only.
- **TDD** — vitest; `npx tsc --noEmit` clean; chat-service has its own suite.
- **Commit to main**, conventional commits, no AI refs; no `chore`/`docs` for `.claude/`.
- **No plan refs in code** — comments/test names explain the *why*, self-contained.
- **Files < ~200 lines**, kebab-case descriptive names; modularize.
- Read `docs/lessons-learned.md` before touching Cube YAMLs, cache, test setup, UI.

## Key dependencies

- Phase 01 set math depends on the nightly Iceberg snapshot
  `stag_iceberg.khoitn.segment_membership_daily`
  (writer: `server/src/lakehouse/segment-snapshot-writer.ts`). Two segments must
  both have a recent partition; stale partitions are flagged in the UI.
- Phase 01 + Phase 04 save-as-segment both reuse the SAME write path:
  `POST /api/segments` with `type:'manual'` + `uid_list` (no new write path).
- Phases 02–04 are independent of Phase 01 and of each other (different files).

## Verified anchors (re-grepped 2026-06-21)

- Snapshot writer: `server/src/lakehouse/segment-snapshot-writer.ts:139` (`writeSegmentSnapshot`), `:112` (`buildSegmentMembershipSql`).
- Manual segment create: `server/src/routes/segments.ts:428` (`POST /api/segments`, `type:'manual'` + `uid_list` → `uid_list_json`).
- Members API: `server/src/routes/segments.ts:657` (`GET /api/segments/:id/members`, tokenless).
- Combined artifact tool: `chat-service/src/tools/emit-combined-artifact.ts:61` — already emits ONE `dual-axis` spec; falls back to two cards.
- Chart render + dual-axis: `src/pages/Chat/components/assistant-chart-section.tsx:478`.
- ChartSpec type: `src/api/chat-sse-client.ts:64`.
- Query artifact card: `src/pages/Chat/components/query-artifact-card.tsx:44`.
- emit_query_artifact tool: `chat-service/src/tools/emit-query-artifact.ts`.
- Session lastQuery memory: `chat-service/src/cache/disambig-memory-adapter.ts:70`.
- Heatmap: `src/pages/Chat/components/chart-heatmap.tsx` (cells `cursor:default`, no onClick). Used ONLY in chat (`assistant-chart-section.tsx`), NOT in Segments — drill-down scopes to chat.
- Follow-up chip plumbing: `onFollowupPick:(text)=>void` page→view→list→message (`chat-thread-page.tsx:514`, `followup-chips.tsx`).
- Save-as-segment hand-off: `segment-proposal-card.tsx` + `src/pages/Segments/editor/editor-prefill-store.ts` (`stashEditorPrefill`/`consumeEditorPrefill`).
- Bulk toolbar: `src/pages/Segments/library/bulk-actions-toolbar.tsx:60`; selection state in `library-view.tsx:38`.

## Unresolved questions

1. **Phase 01 per-region metric aggregates** — the mockup's "How the three
   regions differ" table needs avg LTV / active days / last seen per region
   (A-only / both / B-only). The snapshot table carries only `uid` (no measures),
   and the tokenless members snapshot is capped (top 1000 by rank). A faithful
   region aggregate over the FULL sub-set needs a Cube query scoped by
   `uid IN (...)` per region — feasible but a large IN-list for big cohorts.
   Recommended (in phase-01): compute set math + counts first (cheap), make the
   metric table a deferred/on-demand load with a measure picker, and cap the
   IN-list (or sample) for very large regions. **Confirm with user**: is a
   sampled region metric acceptable, or must it be exact over the full region?
2. **Phase 01 "save region as segment" enrichment** — manual segments compute
   member profiles lazily on first `/members` pull (`ensureManualMemberProfiles`,
   small cohorts only). A 41k-uid "A-only" region exceeds "small". Confirm the
   manual-create path tolerates a large `uid_list` (it stores the full list; only
   profile enrichment is capped) — likely fine, flag for test.
3. **Phase 03 chip generation source** — chips are derived from the prior
   `CubeQuery` shape (add dimension / tighten filter / change grain / change
   range). Confirm whether the prior query is reliably available FE-side on the
   artifact (`artifact.query`) for ALL artifacts, or only via the agent's
   `lastQuery` memory. Plan assumes `artifact.query` (verified present on
   `QueryArtifact`) drives chip generation FE-side; agent re-emits from memory.
