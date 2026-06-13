# Member360 & CS-Care Frontend/Backend Landscape Map

**Req:** Scoped overview of per-member 360 & CS care surfaces so a planner can design a new CS-ticket Care History page.

---

## 1. Member360 Page Shell & Render Modes

### File: `src/pages/Segments/member360/member-360-view.tsx` (l.1-248)

**Two render modes:**

| Mode | Trigger | Layout | Back link |
|------|---------|--------|-----------|
| **Segment-backed** | `/segments/:id/members/:uid` | stacked dashboard: hero + monetization + profile/acquisition + journey + tabbed details | `/segments/:id?tab=members` |
| **Segment-less (CS care-first)** | `/dashboards/cs/queue?game=X&uid=` | care-first variant (`CsMember360View`): timeline + action rail + collapsed reference panels | `/dashboards/cs/queue?game=X` |

**Cache-first architecture:**
- Nightly precompute feeds `useCachedPanelSource()` → profile row covers whole top of page when fresh.
- Coverage guard: serves from cache only if all `profileMembers(sections)` present, else falls back to live query.
- `useMemberCubeQuery()` holds idle until cache lookup settles, skipped on cache hit. (`l.114-118`)

### File: `src/pages/Segments/member360/member360-sections.ts` (l.1-193)

**Config-driven per game via `sectionsForGame(gameId: string | null)`** → returns `Member360Sections | null`.

**Games with user_360 model (have 360):**
- `cfm`, `cfm_vn` → **CFM_SECTIONS** (full badges: payer_tier, lifecycle_stage, **engagement_segment**, is_paying_user)
- `ballistar`, `ballistar_vn`, `jus`, `jus_vn`, `muaw`, `pubg` → **BALLISTAR_SECTIONS** (no engagement_segment)
- `cros`, `tf` → **CFM_SECTIONS** (engagement_segment present)

**Returns null for unmapped games** (`l.169-172`).

**`profileMembers(sections)` → union of all scalar dimensions** the hero + monetization + profile/acquisition + journey sections read (`l.175-192`). Mirrors `member360-panels.ts` profile panel columns for cache-first coverage check.

### File: `src/pages/Segments/member360/member360-panels.ts` (l.1-794)

**Declarative panel registry mapping Cube views → renderers.** Per-game panels via `panelsForGame(gameId)` → `Member360Panel[]`.

**Panel types:**
- `profile` — KPI strip + detail table over `user_profile` view.
- `dailyTimeline` — time-series (activity, recharge, monthlies) over `user_*_timeline` views.
- `detailTable` — static table (roles, devices, IPs, transactions).
- `eventStream` — lazy, ≤31d-bounded behavior (login/logout/matches/gacha/items/tutorial); queryable only on tab expand.

**Game coverage:**
- **cfm**: 308+ lines of rich config (profile + roles + devices/IPs + activity/recharge/monthly + 10 FPS behavior panels) ✓
- **ballistar**: core 360 only (profile + activity/recharge/monthly + transactions, no event panels) ✓
- **cros/tf**: full rich family (same as cfm + sessions) ✓

**Identity keys per view:**
- `user_id` → most views.
- `playerid` → FPS event panels (joined via `user_roles_panel.role_id`).
- `clientsdkuserid` → login/logout sessions.
- `role_id` → cros/tf role-keyed sessions.

### File: `src/pages/Segments/member360/sections/details-tabs.tsx` (l.1-139)

**Tab defs (TAB_DEFS l.34-42):**
- Roles, Behavior, Combat, Devices, IPs, Activity, Recharge (all driven by `panelsForGame`).
- **Care tab appended last** when `showCareTab=true` (`l.44-46`, `l.75`).

**Tab render:**
- `isCare=true` → renders `<CareHistoryTab gameId uid />` (not `CsMember360View` — that's the whole page variant).
- `isEvent=true` → `<EventPanelGrid>` (lazy event streams).
- else → grid of `<MemberPanel>` (profile / timeline / detail tables), cache-first when `cachedSource` present (`l.124-131`).

**`showCareTab` always true** in segment-backed member360 (`l.241`); gracefully handles empty state when no cases.

---

## 2. CS Care-First Variant: CsMember360View

### File: `src/pages/Dashboards/cs/member360/cs-member360-view.tsx` (l.1-~200)

**Reached from CS care queue** (segment-less route: `/?game=X&uid=Y`).

**Data flow:**
```
useVipCaseHistory(game, uid)  → cases[]
  ├─ casesToTimeline(cases)           → timeline events
  ├─ pickTopOpenCase(cases)           → topOpen (highest priority)
  └─ caseToRecommendedAction(case)    → action rail content
```

**Render blocks:**
- `CsDashboardHero` — top hero from game's sections (reused, not CS-specific).
- `CsCareHistoryTimeline` — full cross-playbook timeline (real cases or sample fallback).
- `CsRecommendedActionRail` — top open case → action text + channels + SLA (from playbook).
- `CsReferencePanels` — collapsed profile/monetization/activity reference panels (deferrable reads).

**Write gate:** `editor | admin` role can claim/dismiss/treat cases; viewer is read-only.

**Sample fallback:** When status='success' but cases=[], shows SAMPLE_CARE_TIMELINE so demo isn't blank.

---

## 3. Existing CS-Ticket Care Tab (Just Built)

### File: `src/pages/Segments/member360/care-history-tab.tsx` (l.1-578)

**Mounted inside Member-360 Details tab panel** (only in segment-backed path, not CS queue).

**Structure:**
- `RecommendedAction` — top open case (new/in_review) sorted by playbook priority (cao < tb < thap) (`l.125-194`).
- `CareHistoryTab` main — full timeline sorted open-first then by opened_at desc (`l.476-577`).
- `TimelineRow` per case — status pill + snapshot chips + treatment details + form toggle (`l.366-459`).
- `TreatmentForm` — log channel + action_taken + notes + outcome; PATCH `/api/care/cases/:id` with status=treated (`l.204-354`).

**Data fetch:**
- `useVipCaseHistory(gameId, uid)` → cases[] + refetch() (GET `/api/care/cases/vip/:uid?game=`)
- `useCarePlaybooks(gameId)` → playbooks[] (GET `/api/care/playbooks?game=`)

**Write pattern:** PATCH status→treated → `setLastPatched` + `setRefreshKey` to trigger hook re-fire (`l.493-496`).

**Viewer/editor/admin gating:** write actions (Mark treated button) hidden for viewer role (`l.551-554`).

---

## 4. CS-Ticket Data Layer (Backend)

### File: `server/src/routes/segment-cs-care.ts` (l.1-~200)

**GET /api/segments/:id/cs-care** — tabbed CS-care overlay on segment members.

**Auth:** `guardSegment(req, reply, id, 'read')` (`l.101`) — workspace collaborative, segment-aware.

**Payload shape (CsCarePayload l.50-65):**
```ts
{
  segmentId, gameId, productId,
  coverage: { totalMembers, contactedMembers, pct, truncated },
  freshness: { csMaxLogDate },
  pulse: { tickets, contacted, openUnresolved, negativeSentiment, lowRating },
  issueMix: [{ category, tickets, members }, ...],
  watchlist: [WatchlistEntry, ...],      // ← per-member CS history summary
  csImpact: { contacted/nonContacted cohort recharge stats, windowDays, smallSample }
}
```

**Watchlist entry (segment-cs-care-assembly.ts):**
```ts
{
  uid, name, ltv, lastCategory, lastSource, sentiment, rating, statusGroup, daysSince, riskScore
}
```

**Freshness:** 6h TTL cache; backed by Iceberg `cs_ticket` (next-day fresh).

### File: `server/src/lakehouse/cs-ticket-reader.ts` (l.1-~200)

**Read UID-scoped CS ticket history off iceberg.cs_ticket.**

**Coverage:** Ingame/Web/Phone only (~10% of volume); Facebook/AIHelp carry PSID, not game uid → unjoinable.

**Grain:** One row per ticket.
- `cs_ticket_info` (channel + uid + date) = spine, dedup to latest partition.
- `cs_ticket_new_master` (sentiment/rating/status) → latest run per ticket.
- AI label table → first category per ticket.

**Never use cs_ticket_master** (stale Iceberg pointer).

**FetchCsTickets interface (l.71-78):**
```ts
{
  productId: number,
  uids: string[],           // ← segment member uids (sanitized)
  sinceDate: string,        // ← inclusive lower bound (YYYY-MM-DD)
  connector?: Connector,
}
```

**Query timeout:** 30s (CS cold scans = 3.5–15s).

**Output CsTicketRow (l.40-55):**
```ts
{
  uid, ticketId, logDate (YYYY-MM-DD), source (Ingame/Web/Phone),
  labelCategory, labelName, sentiment (Negative/Positive/Neutral),
  rating (1–5 or null), statusGroup
}
```

### File: `server/src/routes/segment-cs-care-assembly.ts`

**Helper functions:** `resolveMemberInfo()`, `buildWatchlist()`, `indexTicketsByUid()`, `medianDate()`.

Reassembles flat ticket rows into segment-level aggregates + per-member watchlist.

---

## 5. Care Cases Data Layer (VIP Playbook Cases)

### File: `src/pages/Dashboards/cs/use-care-cases.ts` (l.1-~150)

**Three lenses over /api/care/cases endpoints:**

| Endpoint | Hook | Use case |
|----------|------|----------|
| `GET /api/care/cases?game=&playbook=&status=` | `useCareHistory()` | Case Ledger by-Playbook view |
| `GET /api/care/cases/by-vip?game=` | `useVipCaseRows()` | Action Queue by-VIP view |
| `GET /api/care/cases/vip/:uid?game=` | `useVipCaseHistory()` | **Member360 Care tab** |

**CareCase shape (l.37-66):**
```ts
{
  id, game_id, playbook_id, playbook_name?, playbook_priority?,
  uid, source (membership|trigger), opened_at, stats_snapshot_json,
  status (new|in_review|treated|resolved|dismissed),
  condition_lapsed (0|1), assignee, treated_at, channel_used, action_taken, notes,
  kpi_target, kpi_eval_at, outcome, profile (VipProfileDto)
}
```

**PATCH /api/care/cases/:id** → `patchCareCase(id, patch)` helper (`l.100+`).
- Accepts: status, channel_used, action_taken, notes, outcome.
- Callers must invalidate/refetch manually.

---

## 6. Server Route Registration Pattern

### File: `server/src/index.ts` (l.1-80)

**Route registration:**
```ts
import segmentCsCareRoutes from './routes/segment-cs-care.js';
import careCasesRoutes from './routes/care-cases.js';
...
app.register(segmentCsCareRoutes);
app.register(careCasesRoutes);
```

**Auth guard pattern (guardSegment):**
```ts
export function guardSegment(
  req: FastifyRequest, reply: FastifyReply, id: string,
  mode: 'read' | 'mutate' | 'administer'
): SegmentRow | null {
  // Loads from DB, checks workspace + visibility, enforces access predicate.
  // Returns row if allowed, else sends 403/404 + returns null.
}
```

**Example usage (segment-cs-care.ts l.101):**
```ts
const row = guardSegment(req, reply, id, 'read');
if (!row) return reply;  // guardSegment already sent the error
```

---

## 7. Frontend Routing

### File: `src/pages/Segments/segments-page.tsx` (l.17-37)

**Route table:**
```
/segments/:id/members/:uid  → <Member360View>  (segment-backed path)
```

**Care queue reaches segment-less member360** via:
```
/dashboards/cs/queue?game=X  → queue list
  → click member → navigate to /#/segments/:id/members/:uid?game=X
    (id = absent, gameId from ?game, segmentLess = true)
  → renders <CsMember360View> instead of stacked dashboard
```

---

## 8. apiFetch Convention

**Pattern:** `apiFetch<T>(url) → Promise<T>` + useEffect.

**Example (care-history-tab.tsx l.22, l.480):**
```ts
const { status, cases, error } = useVipCaseHistory(gameId, uid);
```

NOT react-query; manual AbortController + useState(status, data, error).

**Workspace header attached automatically** (getActiveWorkspaceId() in api-client.ts l.8).

---

## What "Replace User360" Could Mean

**Candidate surfaces & risks:**

| Candidate | Interpretation | Risk |
|-----------|-----------------|------|
| **Per-member CS-ticket tab** (new) | Add a "CS Tickets" tab inside Member360 Details showing raw cs_ticket rows for this UID | **HIGH**: Raw cs_ticket join via split_part(user_id,'@',1) has ~8% null join rate; would need fallback UI. Also duplicates care-history-tab's "history" concept. |
| **Replace segment-backed 360 layout** | Swap the stacked dashboard (hero + monetization + …) with CS care-first layout (timeline + rail + panels) for all games | **CRITICAL**: Breaks Segment Detail's "click member" workflow; invalidates cfm/ballistar segment dashboards. |
| **Standalone CS-ticket page** | New /dashboards/cs/tickets page (like queue) to browse all recent cs_ticket rows, filter by game/uid/status/date | **LOW**: Orthogonal, no conflict. Would reuse cs-ticket-reader + new query layer. |
| **Fold cs_ticket into Care tab** | Unify care-history-tab to show BOTH playbook cases + linked cs_ticket rows in one timeline | **MEDIUM**: Adds complexity (2 data sources, dedup logic). Feasible but needs schema map (case.cs_ticket_ids?). |

---

## Open Questions

1. **CS-ticket join quality:** ~8% of cs_ticket rows have null game uid (Facebook/AIHelp). Should per-member view filter them or show "unknown channel"?
2. **Care vs. CS-ticket distinction:** Is "care" (playbook cases) the only history users care about, or do they also want raw support tickets?
3. **Member360 scope:** Should the new page be a new URL (/dashboards/cs/tickets/:uid) or a tab inside existing member360 (/segments/:id/members/:uid?tab=cs-tickets)?

