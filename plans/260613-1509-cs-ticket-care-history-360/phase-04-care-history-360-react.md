# Phase 4 — React build of Care History 360 page + tests

**Context links:** chosen variant from `visuals/` (Phase 3), client `src/api/segment-cs-care-member.ts` (Phase 2), atoms `care-ui-atoms.tsx`, page-header pattern `docs/design-guidelines.md` §3, existing `member-360-view.tsx` (back-link + apiFetch+useEffect conventions).
**Blocked by:** Phase 1 (endpoint) AND Phase 3 (variant pick).

## Overview
- **Priority:** P2
- **Status:** pending (blocked)
- Build the `/segments/:id/members/:uid/care` page from the chosen variant. Reuses the Phase 1 endpoint (full payload incl. transcript) via the Phase 2 client. **Untouched:** `Member360View` — this is a NEW component/route.

## Data flow
```
Route /segments/:id/members/:uid/care -> <CareHistory360Page>
  useParams -> {id, uid}
  fetchMemberCsTickets(id, uid)  [apiFetch + useEffect + AbortController]
    -> {gameId, productId, uid, coverage, freshness, tickets: CsTicketDetail[]}
  states: loading / no-coverage(404) / empty(coverage.joined=false) / error / ready
  ready -> header (VIP chips + recharge spark + security banner)
         + ticket selector + transcript pane (chosen layout)
```

## Requirements
**Functional**
1. Route component renders the chosen variant's layout in React, design-token compliant.
2. Header: back link → `/segments/:id?tab=care`; member name+uid; VIP profile chips from `tickets[].vip`/payload; recharge sparkline; **security banner** when any ticket `securityFlag`.
3. Ticket list/selector + transcript pane:
   - Bubbles: side by `is_customer` (1=player right, 0=staff left — confirmed reliable in Phase 0 step 5; else use the Phase 0 fallback).
   - **Sanitize HTML** `content` before render (caveat c) — use a sanitizer (DOMPurify if already a dep; else strip-to-text fallback — check `package.json` first, do NOT add a heavy dep without need).
   - Attachments from `files` JSON; handler (staff_dept/domain); SLA latency; reopen markers; rating verbatim + structured complaint tags.
   - Sentiment trajectory badge (first→last), reopen badge, latency badge.
4. States mirror `care-tab.tsx`: loading skeleton, `no-coverage` (404 NO_CS_CARE), empty (coverage.joined=false), error, ready.
5. Reuse atoms (Chip, Stars, tones, fmtVnd). Every new file <200 LoC → split into: page shell, header, ticket-list, transcript-pane, bubble, rating-card components.

**Non-functional**: react-router v5 hash routing; apiFetch + useEffect (NOT react-query); single fetch on mount.

## Related code files
**Create** (dir `src/pages/Segments/member360/care-history-360/`)
- `care-history-360-page.tsx` — shell, fetch, state machine, layout.
- `care-history-360-header.tsx` — back link + VIP chips + recharge spark + security banner.
- `care-history-ticket-list.tsx` — ticket selector/list w/ badges.
- `care-history-transcript-pane.tsx` — bubbles + attachments + handler + ratings.
- `care-history-chat-bubble.tsx` — single bubble (is_customer side, sanitized content, attachments).
- `care-history-rating-card.tsx` — ★rating + verbatim + complaint tags.
- `care-history-360-page.test.tsx` — states + render + HTML-sanitize assertion.

**Modify**: none here (route wiring is Phase 5, to keep `segments-page.tsx` single-owner).
**Delete**: none.

## Implementation steps
1. Confirm chosen variant + check `package.json` for an existing HTML sanitizer.
2. Build `care-history-360-page.tsx` shell + state machine (clone `care-tab.tsx` state union: loading/ready/no-coverage/error + empty).
3. Build header, ticket-list, transcript-pane, bubble, rating-card from atoms + tokens, matching the chosen variant.
4. Sanitize bubble HTML; render attachments; map is_customer→side; show latency/reopen/sentiment/security badges.
5. Tests: each state renders; bubbles take correct side; HTML is sanitized (no script/tag injection); security banner appears only when flagged; back link href = `/segments/:id?tab=care`.

## Todo
- [ ] confirm variant + sanitizer dep
- [ ] care-history-360-page.tsx (shell + states)
- [ ] header / ticket-list / transcript-pane / chat-bubble / rating-card
- [ ] HTML sanitize on bubble content
- [ ] care-history-360-page.test.tsx
- [ ] tsc + vitest green; visual cross-check vs chosen variant + adjacent page

## Success criteria
- Page renders full transcript + VIP + signals from the endpoint, matching the chosen variant and design system.
- All states covered; HTML sanitized; `Member360View` untouched; files <200 LoC.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|------------|
| Raw HTML content → XSS | M×H | sanitize before render (caveat c); test injection string is neutralized |
| Adding heavy sanitizer dep | L×M | reuse existing dep if present; else minimal strip-to-text/whitelist — confirm in step 1 |
| Bubble side wrong (caveat f) | M×M | rely on Phase 0-verified is_customer; fallback documented |
| Page diverges from variant/design | L×M | build directly from chosen HTML; cross-check |

## Security
- `guardSegment`-gated endpoint is the only data source; transcripts (player PII, IPs, login_info) render only for authorized segment readers. No new public surface. Sanitize all HTML; never `dangerouslySetInnerHTML` with unsanitized content.

## Next steps
- Phase 5 wires the route + Care-tab drill link + docs.
