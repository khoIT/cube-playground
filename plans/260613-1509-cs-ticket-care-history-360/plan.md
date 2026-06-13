---
title: "CS Ticket Care History 360"
description: "Row-expand CS preview in the Segment Care watchlist + a per-member Care History 360 page sourced from iceberg.cs_ticket."
status: pending
priority: P2
effort: 5d
branch: main
tags: [segments, cs-care, member360, lakehouse, frontend, backend]
created: 2026-06-13
---

# CS Ticket Care History 360

Two surfaces over one new endpoint:

1. **Row-expand preview** in the existing Care watchlist (`care-watchlist.tsx`): rows become expandable, lazy-fetch per-member CS tickets on expand, render per-ticket **summary cards** (AI-label chips, sentiment, ★rating, status, reopen badge, opened date, last-message snippet, message count) + a "View full care history →" link.
2. **New Care History 360 page** at `/segments/:id/members/:uid/care`: full conversation transcript (player↔CS bubbles, attachments, rating verbatim, handler, SLA latency, reopen), VIP profile join, security flag. The Care-tab name-click drills HERE; the Members-tab name-click stays on the untouched `Member360View`.

Both consume `GET /api/segments/:id/members/:uid/cs-tickets`. Page uses the full payload (incl. transcript); row-expand uses the summary subset. Auth: `guardSegment(req,reply,id,'read')`.

## LOCKED decisions
- New separate page (NOT a `Member360View` replacement). New route `/segments/:id/members/:uid/care`.
- Row-expand in Care watchlist = lazy-fetch summary cards, NO transcript.
- Transcript lives ONLY on the new page.
- Scope = transcript+detail (core) + reopen/first-response-latency/sentiment-trajectory badges + `customers_v2` VIP join + account-takeover/security flag.
- One endpoint; summary subset for row-expand, full for page. Payload caps to bound cost.

## Data model
See [phase-00](./phase-00-data-layer-reader-assembly.md) for the join graph, verified schema facts, and caveats — embedded so implementers never re-probe Trino.

## Phases

| # | Phase | Status | File ownership |
|---|-------|--------|----------------|
| 0 | Data-layer reader + assembly + unit tests | ✅ done (13 tests + live-verified) | `server/src/lakehouse/cs-ticket-detail-*.ts`, `*.test.ts` |
| 1 | API route + caps + cache + gating/degrade tests | ✅ done (9 tests; +member/recharge fields) | `server/src/routes/segment-cs-tickets.ts`, `index.ts` (1 line), `*.test.ts` |
| 2 | Row-expand in care-watchlist + tests | ✅ done (5 tests) | `src/pages/Segments/detail/tabs/care/*`, `src/api/segment-cs-care-member.ts` |
| 3 | Huashu hi-fi design variants (DESIGN GATE) | ✅ done — user picked **A (inbox) + C (timeline) toggle** | `visuals/*.html` |
| 4 | React build of Care History 360 page + tests | ✅ done (6 tests) | `src/pages/Segments/member360/care-history-360/*` |
| 5 | Route wiring + Care-tab drill link + docs sync | ✅ route wired; docs in progress | `segments-page.tsx`, `care-watchlist.tsx`, `docs/*` |

## Phase files
- [phase-00-data-layer-reader-assembly.md](./phase-00-data-layer-reader-assembly.md)
- [phase-01-api-route-caps-cache.md](./phase-01-api-route-caps-cache.md)
- [phase-02-care-watchlist-row-expand.md](./phase-02-care-watchlist-row-expand.md)
- [phase-03-huashu-design-variants.md](./phase-03-huashu-design-variants.md)
- [phase-04-care-history-360-react.md](./phase-04-care-history-360-react.md)
- [phase-05-route-wiring-docs.md](./phase-05-route-wiring-docs.md)

## Dependency graph
```
P0 ──> P1 ──> P2 (row-expand consumes endpoint)
              └─> P4 (page consumes endpoint)
        P3 (design gate, parallel-OK after P1 shape frozen) ──> P4
P2, P4 ──> P5 (wiring + drill link + docs)
```
P3 may start once the P1 payload TS shape is frozen (no code dep). P4 is BLOCKED by both P3 (chosen variant) and P1 (endpoint).

## Open Questions
See bottom of [phase-05](./phase-05-route-wiring-docs.md).
