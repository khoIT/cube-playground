# Brainstorm: Per-User Isolation + Sys-Admin Hub

**Date:** 2026-06-03 · **Skill:** /brainstorm · **Status:** Design approved, ready for /ck:plan
**Research input:** `plans/reports/researcher-260603-1439-sota-data-tool-admin-console-features-report.md`
**Collision check:** `plans/260603-0324-unified-concept-fabric/` (completed) — see §7.

---

## 1. Problem statement

After Keycloak/O365 auth landed, user wants a "proper workspace" feature:
1. Per-user isolation so data doesn't spill (chat, query-builder, segments). Metrics shared for now (multi-user approve/edit flow = later).
2. A sys-admin page: existing dev/chat-audit + (a) grant per-user game/feature access, (b) observability — user count, last login, chat counts, recent query-builder feature usage. To triage + onboard users.

## 2. Scout reframe (≈50% already shipped)

| Capability | State today | Cite |
|---|---|---|
| Per-user **access control** (role/status + per-user workspace/game/feature grants) | **SHIPPED** `/admin/access` + `admin-access.ts` CRUD + grant matrices + default-deny + `access_audit` | `src/pages/Admin/access/*`, `server/src/routes/admin-access.ts`, migrations 019/020 |
| **Chat** isolation | **DONE** — `owner_id + game + workspace`, via `X-Owner-Id` to chat-service | `chat-service` schema, `chat-store.ts` |
| **Dashboards** isolation | **DONE** — `owner + game + workspace` | `dashboard-store.ts`, migration 010 |
| **Segments** isolation | **GAP** — shared workspace-wide; dormant `visibility` col not enforced | `segments.ts:4,137`, migration 028 |
| **Observability data** | PARTIAL — last_login, user counts, chat counts, dashboard views queryable; **feature/query usage NOT captured** | migration 018, chat observability tables |
| Per-user **data isolation at Cube level** | NOT built (whole-game binary access) — out of scope here | lessons-learned.md |

**Locked constraints:** KC auth-only (no Keycloak admin UI / no SCIM); DB-authoritative authz per-request; game access binary (no row/measure filtering); single SQLite + `owner` column = the isolation mechanism.

## 3. Decisions (user-confirmed)

1. **Segment isolation** = enforce visibility, default **personal**, opt-in shared/org. (Reconcile w/ §7 unified ladder.)
2. **DB isolation** = **logical** (owner-scoped, one SQLite). Physical per-user DB rejected (ops cost, no security gain).
3. **Telemetry depth** = **FULL** (per-query audit, segment ops, exports, feature usage). Honored as target; ship event-spine + top event types first (incremental), not gated all-at-once.
4. **Admin surface** = **tabbed sys-admin hub** extending `/admin/access`. Emphasis: comprehensive **fine-grained per-user experience control** (workspace-switch, game count, feature visibility) w/ strong affordance. Build UI via **huashu-design**.
5. **Sequencing** = plan **all three together** as one phased feature.
6. **OUT of scope:** metrics multi-user approve/edit/approval flow.

## 4. Approaches considered

- **Physical per-user DB** — rejected (KISS/YAGNI: migration routing, backup, conn mgmt; zero isolation benefit over owner-scoping).
- **New standalone admin page** — rejected (DRY: duplicates guards/components; fragments admin surface).
- **Minimal telemetry (existing data only)** — rejected by user in favor of full (richer triage value).
- **Chosen:** logical isolation + visibility enforcement + full activity-event spine + tabbed hub extending existing surface. Maximizes reuse of shipped authz spine.

## 5. SOTA-informed feature set (researched: Metabase, Looker, Superset, Hex, Mode, Omni, Amplitude, Mixpanel)

Tailored to internal ~tens-to-low-hundreds users, single admin team.

- **MUST (v1):** master-detail user console (exists, polish); fine-grained per-user panel — role, status, workspace grants (= switching ability), game grants w/ count, feature toggles grouped by area; pre-provision by email (exists); audit-log viewer (data exists, no UI); observability dashboard — counts by status, last login, inactive-user detection, chat-session counts, per-user feature usage + recent queries.
- **NICE (v2):** bulk multi-grant, CSV invite, org-wide role defaults, query duration/cost (if Cube exposes), per-user activity timeline.
- **SKIP (overkill internal):** column-level security, SCIM/LDAP, custom-role proliferation, cost-allocation.
- **UX patterns to copy:** Metabase group-grant clarity; Mixpanel inline audit-log w/ filters+export; Amplitude inactive-user detection; empty-state prompts; two-tier model (role→features; workspace/data access separate).
- **Privacy:** per-user query/feature telemetry acceptable for internal monitored tool; document it; bound retention (≥90d).

## 6. Architecture (3 sub-projects, one phased plan)

### A. Segment isolation (small)
- List: `WHERE (owner = ? OR visibility IN ('shared','org'))`; new segments default `personal`.
- Mutations: owner/admin only for `personal`; shared/org follow workspace rules.
- **Backfill existing → `shared`** (preserve current behavior; no surprise hiding).
- Add visibility control to segment UI. **MUST reconcile with §7 unified trust/visibility ladder.**

### B. Activity telemetry — full (medium-large)
- New append-only `activity_events`: `id, actor_email, event_type, target_type, target_id, workspace, game, detail_json, ts`; indexes `(actor_email, ts)`, `(event_type, ts)`. Mirror `business_metric_audit` pattern.
- Emit points: query-run, segment create/edit/delete/refresh, chart/export, feature-open (route-level), workspace-switch.
- **Cross-service:** chat stats in `chat-service/chat.db` → add internal `GET /internal/stats` (shared-secret, mirror existing `/internal/access/:email`); admin API aggregates main-DB events + chat stats. **Do not read chat.db directly.**
- Retention ≥90d. Ship spine + 2–3 highest-value event types first, widen incrementally.

### C. Sys-admin hub UI — huashu-design (large)
- Extend `/admin/access` → tabs: **Users & Access** (exists, re-skin for fine-grain) · **Observability** (new, consumes B) · **Dev / Chat-Audit** (move existing in).
- Centerpiece = per-user panel: role/status, workspace multi-grant (clear "can switch" affordance when >1), game grants w/ live count, feature toggles by area, + that user's activity snapshot.
- Backend grant API already exists (`PUT …/workspaces|games|features`) → mostly frontend.
- huashu hi-fi HTML prototype of per-user panel first → port to React w/ `tokens.css` per design-guidelines.md (do NOT ship raw prototype).

## 7. ⚠ Collision: unified-concept-fabric (completed 2026-06-03)

`plans/260603-0324-unified-concept-fabric/` introduced a **single unified trust/visibility ladder** across data-model fields, metrics, glossary, **and segments** (phase-02 registry-trust-model, phase-04 authoring-governance). Authoritative spec: `plans/reports/brainstorm-260603-0324-unified-concept-fabric.md`.

**Implication for sub-project A:** segment `visibility` is now part of a unified vocabulary — the planner MUST read phase-02/04 + that brainstorm before designing A, and map "personal/shared/org" onto the existing unified ladder rather than inventing a parallel one. Possible the visibility semantics already partly exist; A may be "enforce + wire" not "add column".

## 8. Build order

`A (isolation)` + `B (event spine)` parallel → `C (hub UI)` consumes B's data. C's Users&Access tab can start against existing grant API before B lands; Observability tab gated on B.

## 9. Risks / mitigations

| Risk | Mitigation |
|---|---|
| Telemetry scope creep ("full" open-ended) | Event-spine-first + incremental event types; v1 = top 3 |
| Cross-service aggregation (2 DBs) | Internal `/internal/stats` seam on chat-service; never touch chat.db directly |
| Segment backfill hides existing data | Default existing rows → `shared` |
| Visibility model divergence | Reconcile with unified-concept-fabric ladder (§7) — gate A on reading those phases |
| huashu prototype shipped raw | Reconcile to tokens.css; prototype = design artifact only |
| Privacy of per-user telemetry | Internal monitored tool; document + bound retention |

## 10. Success criteria

- Two users in same workspace+game see only own `personal` segments; shared/org visible to all; no regression to chat/dashboard isolation.
- `activity_events` records query-run + segment ops + feature-open; admin dashboard shows per-user last-login, chat count, recent features.
- Admin can, from one hub, set a user's role/status/workspaces/games/features and see their activity — without leaving the page.
- All new UI passes design-guidelines token cross-check.

## 11. Out of scope

Metrics multi-user approve/edit/approval workflow; Cube row/measure-level data isolation; KC group→role sync / SCIM; column-level security.

## 12. Unresolved questions

1. Does Cube expose per-query execution metrics (duration/rows) for the "queries run" stat, or only that a query ran? (Affects B emit richness.)
2. `org` visibility — admin-only to set, or any user? (Governance.)
3. Exact overlap of `segments.visibility` semantics with the unified-concept-fabric trust/visibility ladder — does A add a column or just enforce existing? (Planner must verify in phase-02/04.)
4. Inactive-user threshold for "inactive" flag (e.g. no login 30/60/90d)?
