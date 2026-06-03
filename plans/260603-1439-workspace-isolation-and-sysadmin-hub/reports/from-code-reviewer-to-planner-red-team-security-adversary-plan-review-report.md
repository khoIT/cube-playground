# Red-Team Security Review — Per-User Isolation + Sys-Admin Hub Plan

**Reviewer:** code-reviewer (Security Adversary + Fact Checker lens)
**Date:** 2026-06-03
**Verdict:** Plan has correct intent but rests on several FALSE premises about existing code. Two findings are auth-design flaws that, if built as written, ship a cross-user data-exposure bug. Every finding below is grep/read-verified with `file:line`.

---

## F1 — Phase 3/4 chat `/internal/stats` seam is built on a non-existent auth pattern; existing `/stats` route is self-scoped and CANNOT serve admin cross-user reads. (Critical)

**Plan claim (phase-03 §Requirements / §Architecture):** "Chat-service `GET /internal/stats?email=` … behind the existing shared-secret pattern (`CUBE_AUTH_INTERNAL_SECRET` sibling)" and "Mirror auth + fail-closed posture of the existing `/internal/access/:email` bridge."

**Verified reality:**
- `/internal/access/:key` lives in the **main server** (`server/src/routes/internal-access.ts:42-63`), gated by `CUBE_AUTH_INTERNAL_SECRET` (`internal-access.ts:30`). It is NOT in chat-service. The plan mislocates the pattern it intends to copy.
- chat-service has **no inbound shared-secret middleware at all**. `MAIN_SERVER_SERVICE_TOKEN` is only consumed by chat-service when it CALLS the main server (`chat-service/src/config.ts:82-86,237`); there is no gate validating inbound calls to chat-service. The reverse gate `buildServiceTokenGate` lives in the main server (`server/src/middleware/service-token.ts:21-46`) and protects the main server, not chat-service.
- chat-service ALREADY has a stats route: `GET /stats?owner=<id>` (`chat-service/src/api/stats.ts:27`), registered at `chat-service/src/index.ts:77`. Its only auth is **self-scoping**: `if (owner !== ownerId) return 403` where `ownerId = req.headers['x-owner-id']` (`stats.ts:30-44`). It is otherwise unauthenticated.

**Failure scenario:** The admin hub (Phase 4) must aggregate OTHER users' chat stats. The existing `/stats` route forbids exactly that (`owner !== ownerId → 403`, `stats.ts:42`). So the plan's new `/internal/stats?email=` must deliberately bypass self-scoping to return arbitrary users' data — but the plan gives it NO real authentication (the "shared secret" it references does not exist on chat-service). Built literally, this is an **unauthenticated cross-user stats endpoint**: anyone who can reach chat-service's port (it currently trusts a spoofable `X-Owner-Id` header, `stats.ts:30`) can read any user's chat volume by passing `?email=` / `X-Owner-Id`. There is no network-policy claim in the plan to compensate.

**Required fix:** Phase 3 must (a) add an actual inbound service-token gate to chat-service (new middleware mirroring `service-token.ts`, validating `MAIN_SERVER_SERVICE_TOKEN` which both services already share), (b) state that `/internal/stats` is reachable only from the main server over the internal network, and (c) note that `owner_id` in chat is the **sub** (`chat-service/src/db/chat-store.ts:26,57`), so an `?email=` param requires the Phase-1 email→sub resolution server-side BEFORE the call — chat-service must never receive an email it cannot map.

---

## F2 — Phase 1 picks the WRONG canonical sub↔email map; an authoritative one (`user_access.kc_sub`) already exists and is maintained. Building on `users` reintroduces null/ambiguity holes. (High)

**Plan claim (phase-01 §Key Insight line 18, §Architecture line 29-31):** "`users` table already holds both: `id` (=sub) + `email`. It's the canonical sub↔email map." Resolver `emailForSub`/`subForEmail` to be built over `users-store`.

**Verified reality:**
- `users.email` is **nullable** (`server/src/db/migrations/018-users-audit.sql:17`, `users-store.ts:15` `email: string | null`) and has **no unique or any index on email** (018 only indexes `username`, line 26). `subForEmail(email)` over `users` is therefore an unindexed scan that can match 0 or >1 rows. Two SSO identities sharing an email (or a re-provisioned email) silently collide → wrong-user attribution.
- `users` rows only exist AFTER first KC login (`upsertUser` is login-only, `users-store.ts:34`). Pre-provisioned invited users (the documented "invite-before-login" path, `admin-access.ts:65`) have NO `users` row → `emailForSub`/`subForEmail` return null for exactly the multi-user onboarding case the plan targets.
- The REAL maintained map is `user_access.kc_sub` (migration 019, indexed `idx_user_access_kc_sub`), with dedicated reconcile machinery: `reconcileSub` (`access-store-mutators.ts:100-107`), `ensurePendingUser` (`:81-97`), captured on login at `auth.ts:104`. `getAccess(email)` already returns `kcSub` in the `AccessRecord` (`access-store.ts:27,134`). Email is normalized (lowercase+trim) on read AND write here (`access-store.ts:42-44`) — `users` does no normalization.

**Failure scenario:** Phase 2 keys isolation on `principal.sub` derived via `subForEmail`. If the resolver is built on `users` (per plan), an invited-but-not-yet-logged-in user, or any email-case mismatch, yields `null sub` → the LIST predicate `owner = :sub` with a null sub either matches nothing (user loses their own segments) or, worse, if a fallback collapses null→a shared/dev value, exposes another principal's `personal` segments. This is the SAME "never matched / was null in dev" bug the plan says Phase 1 exists to kill — the plan's chosen map perpetuates it.

**Required fix:** Resolver MUST source sub↔email from `user_access.kc_sub` (normalized email key, already indexed, already reconciled), not `users`. `users` may remain a fallback only, with explicit null-handling that FAILS CLOSED (deny, never widen visibility). Phase 1 must add a test for the null-sub case asserting deny, not silent broadening.

---

## F3 — Phase 2 misses three unguarded segment mutation/read routes; `personal` enforcement on PATCH/DELETE alone still leaks via `/append`, `/refresh`, and `GET /:id`. (Critical)

**Plan claim (phase-02 §Requirements, §Architecture):** "Mutations (PATCH/DELETE/refresh) on a `personal` segment: allowed only for owner==sub or admin" and "wire into PATCH/DELETE/refresh/uid-list routes." Plan enumerates PATCH/DELETE/refresh/uid-list.

**Verified reality — the route inventory is wrong/incomplete:**
- `GET /api/segments/:id` (`segments.ts:256-262`) has **no workspace guard and no owner guard** — fetches `WHERE id=?` and returns full hydrated segment incl. `uid_list` (every UID). Cross-workspace AND cross-owner readable by raw id.
- `POST /api/segments/:id/append` (`segments.ts:379-397`) has **no workspace guard, no owner guard** — any caller who knows an id can mutate another user's cohort membership.
- `POST /api/segments/:id/refresh` (`segments.ts:563-579`) has **no workspace guard, no owner guard** — fetches `SELECT type` only, triggers a refresh on any id.
- `GET /api/segments/:id/sql-filter` (`segments.ts:544-560`) and `/refresh-log` (`:488-507`) — no guard; leak predicate SQL / history of arbitrary segments.
- Only PATCH (`:270`), DELETE (`:359`), and the two activations routes (`:608`, `:647`) check `row.workspace !== req.workspace.id`. None check owner today (by design — see file header `segments.ts:3-7`).

**Failure scenario:** Phase 2 adds `canMutateSegment` to PATCH/DELETE/refresh/uid-list per the plan's list. But `GET /:id`, `/append`, `/refresh`, `/sql-filter`, `/refresh-log` are omitted from the plan. After Phase 2 ships, User B still reads User A's `personal` segment in full (UIDs included — potentially PII) via `GET /api/segments/{A's-id}`, and mutates it via `/append`. The LIST-only + PATCH/DELETE-only enforcement gives a FALSE sense of isolation while the by-id routes remain wide open. The plan's own success criterion "personal segments are owner/admin-only for mutation" is unmet because the route set is under-enumerated.

**Required fix:** Phase 2 must enumerate and guard ALL by-id segment routes (GET/:id, append, refresh, sql-filter, refresh-log, activations) — both the missing workspace guard on GET/:id/append/refresh AND the new owner-or-admin check for `personal`. Add a test that User B gets 404/403 on `GET /api/segments/{A-personal-id}` and `/append`, not just LIST/PATCH.

---

## F4 — Phase 2 backfill `NULL → shared` contradicts the verified current contract and silently broadens exposure of every legacy segment. (High)

**Plan claim (plan.md §Resolved Q3, phase-02 line 19, 33):** "Existing rows were created under shared semantics → backfill NULL → `shared`." Justification: enforcing personal would hide pre-existing segments.

**Verified reality:**
- Current read maps NULL → `personal` (`trust-mapping.ts:43` `SEGMENT_DEFAULT_VISIBILITY = 'personal'`; applied at `segments.ts:113`). Migration 028 comment is explicit: "personal (default/NULL) — only the owner sees it … NULL maps to 'personal' on read" (`028-segments-visibility.sql:5-9`).
- The plan's premise that legacy rows are "shared semantics" is only true of the LIST route (which ignores visibility entirely today, `segments.ts:137`). The DECLARED data contract is `personal`.

**Failure scenario:** Backfilling NULL→`shared` takes every pre-existing segment — including ones an owner reasonably believed private (the column already says `personal`) — and makes them **org/workspace-visible permanently**. This is a one-way data-exposure migration. For any segment whose `uid_list` contains sensitive cohort UIDs, this is an isolation regression performed by the very plan meant to add isolation. The "vanish" risk the plan cites is reversible (owner re-shares); the over-share is not (cannot un-ring the bell once teammates have seen the cohort).

**This reverses a verified default (`personal`) — per repo rule, do NOT silently flip.** Surface to user: keep NULL→`personal` (matches declared contract, fail-safe) and accept that legacy segments become owner-only unless explicitly shared; OR backfill→shared ONLY for segments with >1 distinct historical editor / already-referenced by a shared glossary term. Ask the user which; do not hardcode `shared`.

---

## F5 — Dev-mode deterministic principal (Phase 1) + the dev break-glass in `/internal/access` is a prod data-exposure hole if `AUTH_DISABLED` leaks on. (High)

**Plan claim (phase-01 §Requirements line 25, Step 3):** "Dev mode (`AUTH_DISABLED=true`) yields a deterministic principal (`sub` + synthetic email) so local isolation tests are meaningful." Risk section calls it env-gated, zero behavior change.

**Verified reality:**
- `AUTH_DISABLED` defaults to OFF only by absence; any truthy value (`1|true|yes`) flips it (`authenticate.ts:47-50`). In that mode EVERY request becomes `id:'dev', role:'admin', allowedGames:all, features:all-on` (`authenticate.ts:52-74,130`).
- The internal bridge has a break-glass: with `AUTH_DISABLED` on, `/internal/access/:key` **skips the shared-secret gate entirely** and returns `{role:'admin', allowedGames:['*']}` for ANY key (`internal-access.ts:24-29,52-54`).
- It's controlled via `.env` / compose (`docker-compose.yml:12`), i.e. a single env var stands between "full SSO + per-user isolation" and "everyone is all-games admin, internal bridge open."

**Failure scenario:** The plan adds a deterministic *multi-user* dev principal but does not add any guard that `AUTH_DISABLED` is refused in prod. Today's risk is already real; the plan EXPANDS the dev path's surface (synthetic emails now flow into the new identity resolver, telemetry `actor_email`, and admin aggregation). If a prod deploy ships with `AUTH_DISABLED=true` (the override exists, `authenticate.ts:134`), the new admin hub + telemetry will happily attribute, aggregate, and expose every user's activity under a synth admin — and `/internal/access` leaks grants to cube-dev unauthenticated. Isolation tests passing in dev prove nothing about prod because dev collapses all principals.

**Required fix:** Phase 1 should add a fail-closed assertion: refuse to boot (or hard-warn + disable internal bridge) when `AUTH_DISABLED` is truthy AND `NODE_ENV==='production'` (or a `PROD_GUARD` env). Make the synthetic dev email a clearly non-routable domain (e.g. `@dev.invalid`) so it can never collide with a real grant key in `user_access`. Document that the deterministic dev principal is test-only.

---

## F6 — Telemetry `detail_json` query-shape may capture predicate VALUES (potential PII/sensitive filters), not just cube/measure names. (Medium)

**Plan claim (phase-03 §Architecture line 26, Risk line 60):** "`detail_json` carries query shape (cubes/measures/dimensions) … No PII beyond what the user already authored."

**Verified reality:**
- Segment predicates carry literal filter values, not just member names: predicate trees translate to Cube filters and to SQL (`predicateToSql`, surfaced at `segments.ts:553-554`). A query "shape" that includes the `filters` array captures values like `user_id IN (...)`, email fragments, country/cohort literals — these ARE potentially sensitive.
- `access_audit.detail_json` already stores full mutation payloads as JSON (`access-audit-store.ts:18-25`, migration `020-access-audit.sql:12`), so the codebase precedent is to dump whole payloads — easy to copy the same "store everything" habit into `activity_events.detail_json`.

**Failure scenario:** If the query-run emit point serializes the raw query payload (the easy implementation), `detail_json` retains filter literals for 90 days, readable by any admin via the Phase 7 audit viewer + CSV export (phase-07 §Requirements). "What the user authored" can include another user's UIDs (manual segments) or PII filter values. The plan asserts no-PII but never specifies a projection that strips values.

**Required fix:** Phase 3 must define `detail_json` as a **whitelist of member NAMES only** (cube, measures[], dimensions[], filter member keys — NOT filter values, NOT uid_lists). Add a test asserting filter values / UID arrays never appear in a recorded `detail_json`. State retention + admin-readability in the privacy doc (Phase 7 already lists this, but the redaction contract must be set in Phase 3 where the data is written).

---

## F7 — Phase 4 `/api/admin/activity/users/:email` fans out to chat by email, but chat keys on sub — the plan never closes the email→sub hop on the admin path, risking empty or mis-attributed stats. (Medium)

**Plan claim (phase-04 §Requirements):** per-user endpoint returns "session/turn counts (via chat `/internal/stats`)" keyed by `:email`.

**Verified reality:** chat `owner_id` = sub (`chat-store.ts:26,57,389`); `queryStats` filters `WHERE cs.owner_id = ?` with the owner id (`chat-store.ts:389`). The admin route receives `:email`. Without an email→sub translation (F2), the chat query runs with an email against sub-keyed rows → zero rows, silently. The plan's "graceful degradation → null" (phase-04 §Non-functional) would MASK this as "user has no chats" rather than a mapping bug.

**Failure scenario:** Admin sees "0 chats" for active chat users because email was passed where sub was needed — indistinguishable from genuine inactivity, corrupting the inactive-user detection (Phase 4 flags >30d inactive → quick-disable in Phase 7). An admin could disable an active user based on phantom-zero telemetry.

**Required fix:** Admin aggregation must resolve email→sub (via the F2-corrected `user_access.kc_sub` map) before calling chat, and pass sub. Add a test: a user with chat sessions under their sub returns non-zero counts through the admin-by-email path. Distinguish "mapping failed" (error/flag) from "genuinely zero" in the response.

---

## Cross-cutting fact-check summary

| Plan assertion | Verdict | Evidence |
|---|---|---|
| LIST `SELECT * FROM segments WHERE 1=1` never filters visibility | TRUE | `segments.ts:137` |
| `segments.visibility` exists, NULL→personal | TRUE | `028-...sql:12`, `trust-mapping.ts:43`, `segments.ts:113` |
| `users` is the canonical sub↔email map | FALSE — `user_access.kc_sub` is | `018-...sql:17` (email nullable, unindexed), `019`, `access-store-mutators.ts:100` |
| `/internal/access` shared-secret pattern exists on chat-service to mirror | FALSE — it's main-server only; chat-service has none | `internal-access.ts:42`, `service-token.ts` (main server) |
| No existing chat stats route | FALSE — `/stats` exists, self-scoped | `chat-service/src/api/stats.ts:27-44` |
| owner column = sub; written from `req.owner` | TRUE | `authenticate.ts:111,116`, `segments.ts:186` |
| Mutations limited to PATCH/DELETE/refresh/uid-list | FALSE — append/refresh/GET-by-id/sql-filter/refresh-log also exist, several unguarded | `segments.ts:256,379,544,563` |

---

## Unresolved questions (for planner/user)

1. **F4 (verified-default reversal):** keep legacy segments `personal` (fail-safe, may "hide" from teammates) or backfill→`shared` (broadens exposure, irreversible)? This reverses the declared NULL→personal contract — needs explicit user decision, do not hardcode.
2. **F1:** is chat-service network-isolated (only main server can reach it) in prod, or does it need its own inbound service-token gate built? The plan assumes a secret that doesn't exist.
3. Is there any prod environment where `AUTH_DISABLED=true` is intentionally set? If yes, F5 is already-live and Critical, not High.
