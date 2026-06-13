# Phase 2 — Row-expand in care-watchlist + tests

**Context links:** `src/pages/Segments/detail/tabs/care/care-watchlist.tsx` (current rows are `<Link>` at l.74-110), atoms `care-ui-atoms.tsx` (Chip, Stars, sentimentTone, statusTone, fmtVnd), parent `care-tab.tsx`, client pattern `src/api/segment-cs-care.ts` (apiFetch + useEffect, NOT react-query).

## Overview
- **Priority:** P2
- **Status:** pending
- Convert each watchlist row from a single `<Link>` into an **expandable row**: a name button drills to the new page (Phase 5 wires the URL), an expand chevron toggles a lazy fetch of `GET .../members/:uid/cs-tickets` and renders per-ticket **summary cards** (NO transcript) + a "View full care history →" link.

## Data flow
```
CareWatchlist row click chevron -> setExpanded(uid)
  first expand -> fetchMemberCsTickets(segmentId, uid)  [apiFetch + AbortController]
    -> payload.tickets.map(toSummaryCard)  (client maps full -> summary subset)
  cache per-uid in component state so re-expand is instant
  render summary cards: label chips, sentiment Chip, Stars(rating), status Chip,
    reopen badge (reopenCount>0), opened date, lastMessageSnippet, messageCount
  "View full care history ->" Link to /segments/:id/members/:uid/care
```

## Requirements
**Functional**
1. New client `src/api/segment-cs-care-member.ts`: `fetchMemberCsTickets(segmentId, uid)` + types mirroring Phase 1 payload (re-export the `CsTicketDetail`/summary shape; keep DRY — single source of payload types here for both Phase 2 + 4 to import).
2. Row-expand: name remains the drill affordance (currently the whole row links). Split into: name button (→ `/care`, wired Phase 5) + expand toggle. Lazy fetch on first expand only; loading/empty/error inline states.
3. Summary card built from atoms (reuse `Chip`, `Stars`, `sentimentTone`, `statusTone`) + a small reopen badge (`warning-soft/ink`) and a security badge (`destructive-soft/ink`) when `securityFlag`.
4. Keep watchlist grid layout intact for collapsed state; expanded content renders in a full-width sub-row below the grid row.
5. Tokens only (`var(--*)`), Inter, no raw hex (design system). Each new file <200 LoC; if `care-watchlist.tsx` would exceed 200 LoC, extract the summary card into `care-ticket-summary-card.tsx`.

**Non-functional**: no extra fetch until expand; AbortController on unmount/collapse.

## Related code files
**Create**
- `src/api/segment-cs-care-member.ts` — fetch + payload types (the shared FE contract).
- `src/pages/Segments/detail/tabs/care/care-ticket-summary-card.tsx` — one summary card (atoms + badges).
- `src/pages/Segments/detail/tabs/care/care-watchlist.test.tsx` — expand/lazy-fetch/render tests.

**Modify**
- `src/pages/Segments/detail/tabs/care/care-watchlist.tsx` — row → expandable; name button + chevron + expanded sub-row. (Drill URL set in Phase 5; here use a placeholder `/segments/:id/members/:uid/care` — it is the agreed target so wire it now; Phase 5 only adds the route + verifies the existing Members-tab link is untouched.)

**Delete**: none.

## Implementation steps
1. `segment-cs-care-member.ts`: `apiFetch<MemberCsTicketsPayload>(\`/api/segments/${id}/members/${encodeURIComponent(uid)}/cs-tickets\`)` + types.
2. Refactor `CareWatchlist`: per-row `useState`-driven expand map (or lift to a `<CareWatchlistRow>` child component holding its own expand+fetch state — preferred, keeps the parent <200 LoC). Each row: collapsed grid (unchanged columns) + chevron; name is a `<Link to={/care}>`.
3. On expand, fetch; render `CareTicketSummaryCard` per ticket; footer "View full care history →".
4. States: loading skeleton, empty ("No joinable CS tickets"), error (inline, non-fatal).
5. Tests (vitest + RTL): chevron toggles; fetch fires once on first expand (mock apiFetch); cards render label/sentiment/rating/status/reopen/security/snippet/count; "View full" link href correct; collapse aborts in-flight.

## Todo
- [ ] segment-cs-care-member.ts (fetch + shared types)
- [ ] care-ticket-summary-card.tsx
- [ ] refactor care-watchlist.tsx to expandable rows (extract row child if >200 LoC)
- [ ] care-watchlist.test.tsx
- [ ] tsc + vitest green; visual cross-check vs Care tab adjacent cards

## Success criteria
- Rows expand to lazy-loaded summary cards (no transcript); name + "View full" both link to `/segments/:id/members/:uid/care`.
- One fetch per uid per expand session; design-token compliant; files <200 LoC.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|------------|
| Refactoring the row breaks existing drill to Member360 | M×H | LOCKED: Care-tab name MUST go to `/care` (not Member360). This is the intended behavior change; Members-tab link is a different component (untouched) — verify in Phase 5 |
| Many simultaneous expands → fetch storm | L×M | per-uid lazy + state cache; user expands a few at a time |
| Grid layout breaks with sub-row | L×M | expanded content full-width below grid row, not a new column |

## Security
- Consumes the `guardSegment`-gated endpoint; no new surface. Snippets are HTML-stripped server-side (Phase 0); cards never render raw HTML.

## Next steps
- Phase 5 adds the `/care` route so the links resolve; until then links 404 in dev (acceptable — endpoint + cards testable independently).
