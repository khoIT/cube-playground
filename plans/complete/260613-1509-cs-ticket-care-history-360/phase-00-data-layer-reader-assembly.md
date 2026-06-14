# Phase 0 — Data-layer reader + assembly + unit tests

**Context links:** scout `plans/reports/Explore-260613-1509-member360-cs-care-landscape-report.md`; reuse `server/src/lakehouse/cs-ticket-reader.ts`, `cs-product-map.ts`, `cs-recharge-trajectory.ts`, `inline-sql-params.ts`.

## Overview
- **Priority:** P1 (blocks everything)
- **Status:** pending
- Build a UID-scoped CS-ticket **detail** reader (one ticket = transcript + ratings + master + labels + envelope + VIP) off `iceberg.cs_ticket`, plus pure assembly (snapshot subset for row-expand, full for page) and derived-signal pure functions. Trino I/O isolated; all math unit-tested over fixtures.

## Data model (embed — do NOT re-probe)

Universal spine = `ticket_id`. Sample whales: jus_vn (product_id 832), 6 tickets w/ full convos, AI labels, sentiment, reopens, ★1 ratings + free-text.

### Tables & roles
- `cs_ticket_info` (1/ticket): ticket_id, user_id (`<uid>@...`), customer_id, product_id, source_id, ticket_source (Ingame/Web/Phone), form_group, form_name, service_type, language_code, vip_id, log_date, run_date.
- `cs_ticket_new_master` (**MULTI-row** → dedup `row_number() OVER(PARTITION BY ticket_id ORDER BY run_date DESC, last_updated_time DESC)=1`): ticket_created_time, first_responsed_time *(sic)*, last_closed_time, total_reopened_times, total_customer_comments, total_staff_comments, number_of_rating, ticket_rating, first_sentiment_status_desc, last_sentiment_status_desc, sentiment_change, staff_dept, staff_domain, ticket_status, status_id. **NEVER** `cs_ticket_master` (stale Iceberg pointer, errors).
- `cs_ticket_map_ai_label` (**N/ticket** → dedup on (ticket_id,label_id)): label_category, label_name, label_description (VI).
- `ticket_communications_centralized` (N msgs/ticket; **filter `coalesce(is_deleted,0)=0`**): content (HTML), is_customer (0=staff,1=player), files (JSON array of attachment paths), sender_id, created_date_unix (**MILLISECONDS → ÷1000 before from_unixtime**; raw seconds → year +57881).
- `ticket_ratings_centralized` (N/ticket; **is_deleted=0**): rating (1–5), feedback (free text), feedback_options (JSON array of complaint tags).
- `tickets_v2` (1/ticket, raw envelope): priority, complexity, tags (id→`tag_translation_v2.value`, key='tag_name', language_id=1), labels, sentiment, user_ip, **login_info** (≠ game uid on account takeover), owner_id, country_id.
- `customers_v2` (per product): customer_id, login_info, login_channel, user_id, social_id, gender, dob_unix, tier_id, vip_game_id, vip_game_proportion.
- Dims: cs_map_product(product_id), cs_map_source(source_id), cs_map_status(status_id→status_group), cs_staffs(staff_id), labels_v2(label_id), tag_translation_v2(tag_id).

### Join graph (ASCII)
```
segment member uid
   │  split_part(user_id,'@',1)
   ▼
cs_ticket_info ──ticket_id──┬──> cs_ticket_new_master  (dedup latest run)
   │                        ├──> cs_ticket_map_ai_label (dedup per label_id)
   │ customer_id            ├──> ticket_communications_centralized (is_deleted=0)
   ▼                        ├──> ticket_ratings_centralized (is_deleted=0)
customers_v2 (VIP)          └──> tickets_v2 (envelope: login_info, tags, priority)
                                      │ tags[] -> tag_translation_v2
                                      │ status_id -> cs_map_status.status_group
                                      │ source_id -> cs_map_source
```

### Derived signals (pure, unit-testable — `cs-ticket-detail-signals.ts`)
- `securityFlag` = `tickets_v2.login_info` present AND `≠ uid` AND ticket has an `Account_*` / security AI label.
- `firstResponseLatencyMin` = `first_responsed_time − ticket_created_time` (minutes; null if either missing).
- `sentimentTrajectory` = `{first: first_sentiment_status_desc, last: last_sentiment_status_desc, change: sentiment_change}`.
- `reopenCount` = `total_reopened_times` (number ≥ 0).
- `messageCount` = comms rows after is_deleted filter; `lastMessageSnippet` = HTML-stripped first ~140 chars of latest msg.

### CAVEATS (bake in as handling)
| # | Caveat | Handling |
|---|--------|----------|
| a | comms timestamps in **ms** | `from_unixtime(created_date_unix/1000)` in SQL; assert in a fixture test |
| b | ~8% uid join coverage (Ingame/Web/Phone only) | reader returns matched only; route degrades + surfaces a coverage note |
| c | `content` is HTML | SQL/reader returns raw; **strip** for snippet (server), **sanitize** for render (client, Phase 4) |
| d | multi-row master + labels | dedup via row_number (master) / row_number per label_id |
| e | is_deleted on comms+ratings | `coalesce(is_deleted,0)=0` filter both |
| f | `ticket_communication_type` ∅ in sample | bubble side from `is_customer`; **verify is_customer reliability during build** (log distinct values once) |
| g | CS cold scans 3.5–15s | reuse `CS_READ_TIMEOUT_MS = 30_000`; per-(segment,uid) TTL cache in Phase 1 |

## Requirements
**Functional**
1. `fetchCsTicketDetail({productId, uid, sinceDate, connector?})` → `CsTicketDetail[]` (one per ticket, all sub-entities assembled).
2. Reuse `sanitizeUids` regex `/^[A-Za-z0-9_-]+$/`, `getConnector`, `runQuery`, `toSqlLiteral`, `CS_READ_TIMEOUT_MS` from existing reader (DRY — import, don't fork).
3. Pure `assembleTicketDetail(...)`, `toTicketSummary(detail)`, and signal fns — Trino-free.
4. Per-ticket caps to bound payload (see Phase 1 caps): comms ≤ N, ratings ≤ M.

**Non-functional**: each new file <200 LoC; query single round-trip per uid where feasible (CTE per sub-table joined on ticket_id, mirroring existing `buildSql` shape).

## Related code files
**Create**
- `server/src/lakehouse/cs-ticket-detail-reader.ts` — Trino I/O (SQL builder + fetch + row mappers).
- `server/src/lakehouse/cs-ticket-detail-types.ts` — `CsTicketDetail`, `CsTicketMessage`, `CsTicketRating`, `CsTicketSummary`, `VipProfile` interfaces (shared server↔used as the API contract).
- `server/src/lakehouse/cs-ticket-detail-signals.ts` — `securityFlag`, `firstResponseLatencyMin`, `sentimentTrajectory`, `reopenCount`, `htmlSnippet`, `toTicketSummary`.
- `server/src/lakehouse/cs-ticket-detail-reader.test.ts` — assembly + signals over fixtures.

**Modify**: none (import from existing reader/helpers).
**Delete**: none.

## Implementation steps
1. Define types in `cs-ticket-detail-types.ts`. `CsTicketDetail` = ticket scalars (id, uid, source, openedAt, status, priority, complexity, staffDept/domain, latencyMin, reopenCount, sentimentTrajectory, securityFlag) + `labels: {category,name}[]` + `messages: CsTicketMessage[]` + `ratings: CsTicketRating[]` + `vip: VipProfile|null` + `tags: string[]`. `CsTicketSummary` = the row-expand subset (no `messages` array beyond `lastMessageSnippet` + `messageCount`).
2. `cs-ticket-detail-reader.ts`: build SQL CTEs — `matched` (info spine, dedup latest run, `split_part`), `master`, `labels`, `comms` (with `from_unixtime(created_date_unix/1000)`, is_deleted filter, ordered, capped via `row_number()` window ≤ cap), `ratings`, `envelope` (tickets_v2 + tag/status/source dims), `vip` (customers_v2 on customer_id). Return flat rows per (ticket × sub-entity) OR one query per concern keyed by the matched ticket_id set — choose the shape that keeps <200 LoC and one connector round-trip group (mirror `Promise.all` pattern from `cs-recharge-trajectory`/route).
3. Row mappers → group flat rows into `CsTicketDetail[]`.
4. `cs-ticket-detail-signals.ts`: implement derived fns + `toTicketSummary(detail): CsTicketSummary` (drops messages, keeps snippet+count). `htmlSnippet(html, max=140)` strips tags/entities.
5. During build: log `distinct is_customer` once against jus_vn 832 to confirm caveat (f); remove the log after confirming.
6. Tests: fixtures from the 6 jus_vn tickets shape (ms timestamp, HTML content, reopen, ★1 + feedback, an `Account_Security` ticket w/ Google-sub login_info). Assert: ms÷1000 yields a sane year; security flag true only on takeover ticket; latency math; snippet strips HTML; summary omits full messages; dedup keeps exactly 1 master/ticket.

## Todo
- [ ] cs-ticket-detail-types.ts
- [ ] cs-ticket-detail-reader.ts (SQL + fetch + mappers)
- [ ] cs-ticket-detail-signals.ts (derived + toTicketSummary + htmlSnippet)
- [ ] verify is_customer distinct values (caveat f), then drop log
- [ ] cs-ticket-detail-reader.test.ts (fixtures + all caveats asserted)
- [ ] `npm run -w server build` / tsc passes; vitest green

## Success criteria
- `fetchCsTicketDetail` returns assembled `CsTicketDetail[]` for a uid; empty/sanitized-out uid → `[]` w/o Trino.
- All caveat tests (a–f) pass over fixtures.
- Signal fns pure + covered; `toTicketSummary` produces row-expand subset.
- No file >200 LoC; no duplication of existing reader helpers.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|------------|
| is_customer unreliable for bubble side (caveat f) | M×H | verify distinct values in build step 5; if unreliable, fall back to sender_id vs staff set — name it before shipping P0 |
| Multi-table join blows 30s on cold scan | L×M | reuse 30s timeout; cap comms/ratings rows in SQL window; single uid (not whole segment) keeps scan small |
| login_info compare false-positives (legit multi-login) | M×M | require BOTH login_info≠uid AND security AI label — narrow by design; document |

## Security
- PII (player messages, IPs, login_info) read here but only assembled; access control is enforced at the route (Phase 1, `guardSegment`). No public surface in this layer.

## Next steps
Phase 1 wraps this in the authenticated route with caps + cache + graceful degrade.
