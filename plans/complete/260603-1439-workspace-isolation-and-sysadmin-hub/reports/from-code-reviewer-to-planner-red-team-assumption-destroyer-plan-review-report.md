# Red-Team Plan Review — Assumption Destroyer + Scope Auditor

**Plan:** `260603-1439-workspace-isolation-and-sysadmin-hub`
**Lens:** Assumption Destroyer / Scope Auditor. Every "already exists / already works" claim verified against live code.
**Verdict:** Plan is mostly well-grounded (feature-keys, admin PUT endpoints, migration 018, segment LIST gap all verified accurate), but **3 load-bearing "already exists" claims are FALSE or backwards**, and one core invariant contradicts the code's own documented intent. These will break Phase 2, 3, and 5 as written.

---

## CRITICAL

### C1. Phase 3 chat bridge "mirror the existing `/internal/access/:email` bridge" — bridge is on the WRONG service, and chat-service has no secret-gate to mirror
**Evidence:**
- The existing `/internal/access/:key` route lives on the **main server** (`server/src/routes/internal-access.ts:42-63`), guarded by `x-internal-secret` + `CUBE_AUTH_INTERNAL_SECRET` (`internal-access.ts:23-40`). Its direction is **cube-dev → server** (`internal-access.ts:1-4` "for cube-dev's checkAuth"). It is NOT a chat-service endpoint.
- Phase 3 (phase-03 line 27, line 34) says: add `GET /internal/stats` **on chat-service**, "Mirror auth + fail-closed posture of the existing `/internal/access/:email` bridge" and "reuse existing shared-secret guard" in chat-service `internal-auth middleware`.
- chat-service has **no** internal-secret middleware. `grep "INTERNAL_SECRET" chat-service/src` → nothing. chat-service's only auth is `X-Owner-Id` self-scoping (`chat-service/src/middleware/rate-limit.ts:92`, `chat-service/src/api/turn.ts:87-96`).

**Impact:** Phase 3 assumes it can copy a chat-service shared-secret guard that does not exist. The thing to mirror is on the *other* service and guards the *other* direction. Phase 3 must (a) introduce a NEW shared-secret env + middleware in chat-service (net-new, not "reuse"), and (b) decide whether the main server is even allowed to hold that secret. Effort estimate "3-4d" omits standing up cross-service auth from scratch. Scope claim "behind the existing shared-secret pattern" is false.

### C2. Phase 3 `/internal/stats` shape + key collides with an ALREADY-EXISTING `/stats` endpoint that 403s cross-user reads
**Evidence:**
- chat-service **already has** `GET /stats` (`chat-service/src/api/stats.ts:26-68`), returning `{ turns, input_tokens, output_tokens, cost_usd, by_skill }` keyed on `owner` — and it **hard-403s when `owner !== ownerId`** (`stats.ts:42-44`), i.e. a user can only read their own stats.
- Phase 3 wants `/internal/stats?email=` returning `{ sessionCount, turnCount, lastChatAt }` (phase-03 line 20) for **admin cross-user aggregation** (Phase 4 fans out over the whole user list, phase-04 line 27).
- Chat artifacts are keyed on `owner_id` = `X-Owner-Id` = the Keycloak **sub** (`turn.ts:95-96` enforces `header === body.owner_id`; owner is set from `req.owner = claims.sub` upstream). The plan's new endpoint keys on **email** (phase-03 line 20 `?email=`).

**Impact:** Three problems compounded: (1) the admin aggregation needs cross-user reads, but the only existing chat stats path forbids them by design; (2) the new endpoint keys on email, but chat.db stores sub — chat-service has no sub↔email map (the `users` table is on the main DB, `018-users-audit.sql`), so `/internal/stats?email=` can't resolve a sub without the main server passing it the sub. So the bridge must take sub, not email — contradicting the plan's stated signature and Phase 4's `users/:email` fan-out. (3) `sessionCount`/`lastChatAt` are not in the existing `queryStats` shape — new chat-store queries required, not a thin wrapper.

### C3. Phase 2 "backfill NULL → shared" directly contradicts the code's documented intent (NULL = personal = owner-private)
**Evidence:**
- Phase 2 (phase-02 line 19, line 33; plan.md line 57) asserts: "Existing rows were created under shared semantics → backfill NULL → `shared`" to prevent a "vanish trap."
- The segment row mapper says the **opposite**, in a comment written specifically about pre-column rows (`segments.ts`, the `mapSegmentRow` block): *"Map NULL visibility to 'personal'... This preserves existing behavior: segments created before the visibility column existed are treated as **owner-private** until the owner opts in to share."*
- `SEGMENT_DEFAULT_VISIBILITY = 'personal'` (`trust-mapping.ts:43`), and its own comment (`trust-mapping.ts:39-40`): visibility defaults to personal "to **exactly preserve today's owner-only access** (sharing is opt-in)."

**Impact:** The plan's premise that legacy rows were "shared" is false per two independent code comments. **Today's behavior is: the LIST does not filter at all (`segments.ts:137` `WHERE 1=1` + workspace) so everything is visible, but the *intended* semantics of NULL is owner-private.** Backfilling NULL→shared is a real product decision (making owner-private rows org-visible), NOT a no-op "preserve" as the plan frames it. This is a §3 "user-confirmed decision" (plan.md line 57) built on a false factual premise — surface to user before executing. It may be the right call, but the justification ("they were already shared") is wrong; the real justification is "the LIST never enforced, so users *saw* them as shared."

---

## HIGH

### H1. Phase 1 emit/telemetry on `actor_email` can be NULL — and the "no_email" path can't even create artifacts, so the stated risk is mis-aimed
**Evidence:**
- `users.email` is **nullable** (`018-users-audit.sql`: `email TEXT` — no NOT NULL).
- Auth: `const access = claims.email ? getAccess(claims.email) : null` (`authenticate.ts:100`). If no email, `access` is null → `request.user` stays undefined → route 401/403 (`authenticate.ts:114-116`). `request.owner = claims.sub` is still set (audit only).

**Impact:** The plan's Phase 1 risk note ("pre-provisioned email with no users row → emailForSub null → grant stays email-keyed") under-describes the actual failure: a principal with **no email never becomes an active `req.user`** at all, so it can't run queries or create segments — meaning telemetry `actor_email` null is mostly unreachable for *authenticated* flows. BUT: (a) **dev mode** synthesizes `id:'dev'` with role admin (`authenticate.ts:52-65`, `devUser`) — does `devUser` set an email? `principal.email` in dev must be synthesized or `actor_email` is null for ALL local telemetry, defeating Phase 1's "deterministic per-user dev principal" (phase-01 line 25, 50). (b) The `activity_events` index is `(actor_email, ts)` (phase-03 line 17) — if email can be null, aggregation keyed on email silently drops rows. Plan should key telemetry on **sub** (always present: `req.owner`) and treat email as a display join, not the partition key. Phase 3 line 24 stores both but Phase 4 aggregates on email (phase-04 `users/:email`).

### H2. Phase 6 "extend the existing `use-admin-access` hooks with mutation calls + cache invalidation" — there is no cache layer to invalidate, and mutators are not hooks
**Evidence:**
- `use-admin-access.ts` mutators are **plain exported async functions** (`createAdminUser`, `patchAdminUser`, `putAdminUserWorkspaces/Games/Features` — `use-admin-access.ts:88-121`), not hooks.
- State is manual `useState` + a `refetch` callback (`useAdminUsers`, `use-admin-access.ts:36-53`); there is **no react-query / SWR cache**. "Cache invalidation" (phase-06 line 26, line 43) has nothing to invalidate — it's a manual `refetch()` call. Post-mutation refetch is currently a full `/api/admin/users` re-list + client-side find (`fetchAdminUser`, `use-admin-access.ts:72-75`).

**Impact:** Minor mis-scoping but it cascades: "optimistic UI with rollback" (phase-06 line 23, 38) is not free — there's no cache primitive doing it; it must be hand-rolled on `useState`. The plan's "reuse existing mutation hooks if present" (phase-06 line 26) — none are hooks. Effort under-counted; the per-user panel state machine (optimistic + rollback across 5 mutation endpoints) is the bulk of Phase 6, not a wiring task.

### H3. Phase 5 "move dev + chat-audit into tabs, every pixel uses tokens.css" — DevAudit is built on a different (legacy) theme module, and is single-owner-scoped, not an admin view
**Evidence:**
- The surface is `src/pages/DevAudit/` — one cohesive shell `dev-audit-shell.tsx` with its own tab bar (`AuditTabs`: Sessions / Search / Leaderboard / Cache, `dev-audit-shell.tsx:5-6,18-21`), routed at `/dev/chat-audit` (`src/index.tsx:178-179`).
- It uses the **legacy theme** `T` from `shell/theme` (`dev-audit-page.tsx:11` `import { T }`, uses `T.fSans`, `T.surface`, `T.n200`, `T.n600`) — NOT `tokens.css`. The CLAUDE.md design system mandates `var(--…)` tokens.
- DevAudit data is "always scoped to the current owner via X-Owner-Id" (`dev-audit-page.tsx:3-4`). It is a self-scoped dev triage tool, not a cross-user admin observability surface.

**Impact:** Two conflicts in Phase 5's own success criteria: (1) "move, not rewrite" (phase-05 line 30, 53) vs "every shipped pixel uses tokens.css" (phase-05 line 20, 46) — you cannot drop a `T`-themed shell into a token-mandated hub without rewriting its styling, which IS a rewrite. (2) Putting an X-Owner-Id-self-scoped tool inside an admin hub does not make it show other users' chats — an admin viewing the "Chat-Audit" tab still sees only their *own* sessions unless the data scoping is changed (which the plan does not mention). The "Dev/Chat-Audit tab" may be near-empty/misleading for an admin auditing *other* users.

---

## MEDIUM

### M1. Phase 1 line-number citations are stale → erodes confidence in "verified" tag
**Evidence:** Phase 1 line 16 cites `authenticate.ts:111,116` for "owner = req.owner = sub". Actual `request.owner = claims.sub` is at `authenticate.ts:111` and `:116` (two assignments — the active path at 111, the unauthorized-fallback at 116) — this one happens to be close. But Phase 2 line 16 cites `trust-mapping.ts:43` for `SEGMENT_DEFAULT_VISIBILITY` — **verified correct** (`trust-mapping.ts:43`). `segments.ts:137` for the `WHERE 1=1` LIST — **verified correct**. `segments.ts:113,124` for the row mapper — close (mapper is ~line 95-130). Net: citations are mostly accurate, but the Phase-1 "Key Insight (verified)" tag on the backfill-shared claim (C3) is the dangerous one — it is labeled verified but is contradicted by the code comment. Per repo rule "verified decisions are sticky," a wrong "verified" tag is worse than no tag.

### M2. Phase 4 admin-activity routes assume mount point + guards that need confirming against actual app registration
**Evidence:** Phase 4 (phase-04 line 18, 33-34) mounts `admin-activity` under "`requireRole('admin')` + `requireFeature('admin')`" by modifying `admin-access.ts` "or app route registration." `admin-access.ts` applies those guards via `app.addHook('preHandler', …)` at **router scope** (`admin-access.ts:46-47`) — these hooks apply only within that plugin's encapsulation context. A *separate* `admin-activity.ts` plugin will NOT inherit `admin-access.ts`'s hooks; it must re-declare them or be registered inside the same encapsulation scope. Plan says "mount under same guards" without noting Fastify encapsulation means the guards don't transfer for free.

### M3. Phase 6 `GrantMatrix` "reuse, add count/bulk/effective-default" — current component has none of these and is a dumb controlled checkbox list
**Evidence:** `grant-matrix.tsx:13-22` props are `{title, options, selected, onToggle, onSave, saving, saved, error}` — no count, no bulk select-all/clear, no effective-default/override display. Phase 6 (phase-06 line 19-20, 45) wants live count ("4 of 12"), bulk actions, and effective-default vs override rendering added to it. This is fine as "extend," but Phase 5's "reuse existing `GrantMatrix`… do not fork" (phase-05 line 20) implies it's ready; it is a minimal primitive. Feature toggles grouped "by area" (phase-06 line 20) also don't exist — current matrix is a flat list; grouping by the 8 feature-keys is net-new layout.

---

## What the plan got RIGHT (verified, do not re-litigate)

- **Feature-keys exact list** (phase-06 line 20, plan focus #3): `FEATURE_KEYS = ['chats','playground','data-model','metrics-catalog','liveops','dashboards','segments','admin']` — **exact match** (`server/src/auth/feature-keys.ts:16-25`). `admin` is default-off (`DEFAULT_OFF_FEATURES`), `featureDefaultEnabled()` exists exactly as Phase 6 line 28 assumes.
- **Admin PUT endpoints + payloads** (plan focus #1): `PUT …/workspaces` (`{workspaceIds}`), `…/games` (`{gameIds}`), `…/features` (`{features: Record<string,boolean>}`), `PATCH …/:email` (`{role?,status?}`) — all exist with exactly the payloads Phase 6 line 17 assumes (`admin-access.ts:97-122`, schemas lines 39-42). 409 LastAdminError surfaced (`admin-access.ts:72,90`). Audit written on every mutation (`recordAccessAudit`).
- **FE mutator functions exist** with correct URL/method/body (`use-admin-access.ts:88-121`) — Phase 6 can call them (just not as "hooks with cache invalidation" — see H2).
- **migration 018 = users table with id(=sub) + email** (plan focus #2): confirmed (`018-users-audit.sql`), id is KC sub PK, email nullable, role is explicitly a non-authoritative snapshot.
- **segments LIST gap**: `SELECT * FROM segments WHERE 1=1` + workspace, no visibility filter (`segments.ts:137`+) — confirmed; visibility column read by mapper, accepted on create.
- **`Visibility` enum + `VISIBILITY_VALUES` in trust-mapping.ts** (plan focus #6): `trust-mapping.ts:17-18,43` — confirmed.

---

## Unresolved Questions (for planner / user)

1. **C3 (backfill direction):** The "they were already shared" premise is false (code says NULL=personal=owner-private). Confirm the *real* intent: are we deliberately promoting all pre-existing owner-private segments to org-/team-visible? That's a product/governance decision, not a "preserve current behavior" no-op. Whose segments, across which workspaces?
2. **C1/C2 (chat bridge):** Given chat-service has no internal-secret middleware and `/stats` is sub-keyed + self-scoped, does the planner accept that Phase 3 is "build a new cross-service admin bridge" (new secret, new middleware, new sub-keyed bulk query) rather than "reuse existing pattern"? Re-estimate effort.
3. **H1 (telemetry key):** Switch `activity_events` partition/index key from `actor_email` to `actor_sub` (always present), email as join-only? Confirm `devUser()` synthesizes an email or dev telemetry is all-null.
4. **H3 (DevAudit move):** Is the "Chat-Audit" hub tab meant to show the *admin's own* chats (current X-Owner-Id scoping, trivial move) or *cross-user* audit (requires re-scoping + new auth)? And is the legacy-`T`-theme rewrite into tokens.css accepted as in-scope (contradicts "move, not rewrite")?
5. **M2:** Confirm Fastify encapsulation strategy for admin-activity guards (re-declare hooks vs register inside admin-access scope).
