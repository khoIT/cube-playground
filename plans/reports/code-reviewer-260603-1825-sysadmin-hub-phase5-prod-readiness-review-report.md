# Sys-Admin Hub Phase 5 — Production-Readiness Review

Scope: tabbed admin hub at `/admin` + cross-user chat audit. Reviewed 11 new/edited files.
Verified: server typecheck clean; FE typecheck clean for all Phase-5 files (pre-existing errors elsewhere out of scope); 19/19 server admin-chat-audit tests pass; 51/51 FE tests (tab-shell + hub panels) pass.

Overall: server-side authorization boundary is **correct and well-tested** (sub-isolation invariant holds, defense-in-depth in chat-service). The blocking issue is **FE auth**: the new cross-user + activity calls use bare `fetch()` and will 401 in production. Plus a project-rule violation (plan/phase strings in code, some user-visible).

---

## Critical

### C1 — Cross-user audit + activity-snapshot calls omit the Bearer token; 401 in production
**Files:** `src/pages/Admin/hub/cross-user-audit-data.ts:29` (`adminAuditFetch`), `src/pages/Admin/hub/per-user-panel.tsx:580` (`ActivitySnapshot` fetch).

In real-auth mode (`AUTH_DISABLED=false`, i.e. production), `server/src/middleware/authenticate.ts:111-145` populates `request.user` ONLY from a verified `Authorization: Bearer <jwt>`. The `X-Owner` header is explicitly ignored in real-auth mode (`authenticate.ts:146` path only runs when no valid JWT, and never sets `request.user`).

The new admin routes sit behind `requireRole('admin')` + `requireFeature('admin')` (`admin-chat-audit.ts:67-68`), both of which 401 when `request.user` is undefined (`require-role.ts:24`).

Both new FE call sites use **bare `fetch(url)`** with no headers:
- `cross-user-audit-data.ts:29` → `const res = await fetch(url);`
- `per-user-panel.tsx:580` → `fetch('/api/admin/activity/users/...')`

The app attaches auth via `apiFetch` (`src/api/api-client.ts:94-97`, reads `readAppToken()` → `Authorization: Bearer`). The sibling admin-access hooks correctly use `apiFetch` (`use-admin-access.ts:8`). These two new paths bypass it.

Result: in production every cross-user session list, session detail, and activity snapshot returns 401. The panel renders a permanent "Error: HTTP 401" / "chat-service unreachable" state. Works in local dev only because `AUTH_DISABLED=true` synthesizes an admin for every request regardless of headers.

The data-contract comment in `cross-user-audit-data.ts:11-12` even acknowledges "The admin JWT (Bearer) is still required — callers are responsible for ensuring the session is authed" — but no caller attaches it.

**Fix:** route both through `apiFetch` (preferred — it adds Bearer + workspace + game headers and parses error envelopes), or at minimum attach `Authorization: Bearer ${readAppToken()}`. For `adminAuditFetch`, replace the bare fetch with `apiFetch<T>(url)`; the existing `{ message }` error-envelope parsing can be dropped since `apiFetch`/`SegmentApiError` already surfaces server error bodies. For `ActivitySnapshot`, same swap. Add an FE test that asserts an Authorization header is sent (the existing FE tests mock fetch and never assert on headers, which is why this slipped through).

---

## High

(none)

---

## Medium

### M1 — `resolveTab` uses substring prefix, not path-segment prefix (latent mis-route)
**File:** `src/shell/tab-shell.tsx:70-84`, criterion (d).

`pathname.startsWith(tab.path)` is a raw string prefix. `'/admin/access-foo'.startsWith('/admin/access')` is `true`, so a future sibling route `/admin/access-foo` would resolve to the `access` tab. Same in the `navigate()` push-guard (`tab-shell.tsx:172`).

Not an active bug — current ADMIN_TABS (`access`/`observability`/`dev`) and AUDIT_TABS have no such collision, and longest-prefix would still pick the more specific tab if both were registered. But it is exactly the foot-gun (d) asks about, and it bites silently the day someone adds an adjacent path.

**Fix:** require a segment boundary: treat a tab as matching when `pathname === tab.path || pathname.startsWith(tab.path + '/')`. Keep the longest-prefix tiebreak. Add a `resolveTab` test for the `/base` vs `/base-foo` case.

### M2 — Plan/phase/brainstorm labels in code (some rendered to users) violate the stable-reason rule
**Files:** `src/pages/Admin/hub/index.tsx:11,33,157,158`; `src/pages/Admin/hub/per-user-panel.tsx:2,4,682`; `src/shell/tab-shell.tsx:36`.

Per the project rule (review-audit-self-decision.md §5 / CLAUDE.md): code + UI strings must not reference plan artifacts (phase numbers, variant labels). Offenders:
- `index.tsx:33` — `tag: 'Phase 7'` is a **user-visible pill** in the tab bar.
- `index.tsx:157-158` — placeholder `title="Observability — Phase 7"` and body "...shipped in Phase 4" are **user-visible**.
- `per-user-panel.tsx:2,682` — `Variant B` (a brainstorm option label, unresolvable once the brainstorm is gone).
- `per-user-panel.tsx:4` — `Layout (signed off 2026-06-03)` — date-stamped sign-off note; describes provenance, not the why.
- `tab-shell.tsx:36` — `'Phase 7'` appears only as a doc-comment example; lowest severity but trivially fixable.

**Fix:** Replace with stable, self-contained language. e.g. tab tag `'soon'` or drop the pill; placeholder "Observability — coming soon" / "renders on the activity-aggregator data"; drop "Variant B" → "two-column per-user control panel"; drop the sign-off date. The `[relocated]` tag on the dev tab is fine (describes current state, not a plan).

---

## Low

### L1 — `aria-controls` target id mismatch in refactored AuditTabs panels
**Files:** `src/shell/tab-shell.tsx:212` vs `src/pages/DevAudit/dev-audit-shell.tsx:136,143,150,157`.

TabShell emits `aria-controls={`${testIdPrefix}-panel-${key}`}` → `audit-tab-panel-sessions`. The DevAudit panels have `id="audit-panel-sessions"` (no `-tab` segment). So `aria-controls` dangles. The reverse link (`aria-labelledby="audit-tab-sessions"` → tab id `audit-tab-sessions`) is correct, so labelling still works; only the tab→panel pointer is broken. Backward-compat of tab IDs is preserved as claimed; the panel-id pointer was never wired before either. Non-functional, ARIA-only.

**Fix:** either align panel ids to `audit-tab-panel-*` in dev-audit-shell, or have AuditTabs pass panels' real id scheme. The AdminHub panels (`index.tsx:142`) use `id="hub-tab-panel-access"` which DOES match TabShell's `hub-tab-panel-access` — so the hub side is correct; only DevAudit drifts.

### L2 — `Initials` avatar slices raw email, can render `@`/`.`
**File:** `src/pages/Admin/hub/per-user-panel.tsx:138` — `email.slice(0,2)`. For `a@x.com` shows `A@`. Cosmetic.

### L3 — `relativeTime` "today" for any future/clock-skew timestamp
**File:** `per-user-panel-helpers.ts:131-133` — `days <= 0 → 'today'`. Fine for last-login; just noting negative diffs collapse to "today" rather than guarding.

---

## Acceptance-criteria verdict

- **(a) Admin-only enforcement** — Server: PASS. Both `requireRole('admin')` + `requireFeature('admin')` re-declared on the plugin (`admin-chat-audit.ts:67-68`); Fastify encapsulation comment is accurate; 401/403 covered by tests. FE guard: PASS — `AdminHubRoute` (`src/index.tsx:102-106`) wraps `path="/admin"` non-exact (`index.tsx:231`), so it covers `/admin`, `/admin/access`, `/admin/observability`, `/admin/dev` — all sub-paths, not just `/admin/access`. Redirect to `/` for non-admin.
- **(b) Cross-user authorization boundary** — PASS (server). `resolveTargetSub` (`admin-chat-audit.ts:44-59`) resolves email→`kcSub` via `getAccess`, 400 on missing email, 404 on unknown/no-sub. Proxy always uses `resolved.targetSub` as `X-Owner-Id`, never the admin's. Test `admin-chat-audit-route.test.ts:173-188` asserts the target sub reaches upstream and the admin sub does not. A non-admin cannot reach the route at all (403 before resolution). chat-service adds defense-in-depth (`debug.ts:178` `owner_id !== ownerId → 403`).
- **(c) No regression** — PASS. `proxyJson`/`chatServiceUrl` exported as plain functions, bodies unchanged; all existing chat.ts routes still call them identically. DevAudit still imports `AuditTabs` (`dev-audit-shell.tsx:18,123`); tab IDs `audit-tab-*` preserved; `/dev/chat-audit` route untouched (`index.tsx:195`). `/admin/access` deep-link + Settings "Access" entry preserved via the retained `AdminAccessPage`/`AdminAccessRoute` (`index.tsx:73,92`). (See L1 for a pre-existing ARIA panel-id drift, not a regression.)
- **(d) Contract safety** — `proxyJson`/`chatServiceUrl` behavior unchanged: PASS. `resolveTab` longest-prefix: works for current tabs but substring-prefix can mis-route a future adjacent path — see **M1**.
- **(e) Design system** — PASS on tokens. All new surfaces use `var(--*)` tokens; no hex literals (the `#fff` button text + `rgba(0,0,0,0.04)` shadow match the pattern already used across existing cards). Header mirrors the Dashboards/Access pattern (eyebrow + 20px/700 title + 24px/32px padding + maxWidth 1200 centered). No hermes `T.*`. (Token rule satisfied; M2 is a separate content-string rule, not a token issue.)
- **(f) Privacy** — PASS. Server `projectQueryShape` (`activity-store.ts:86-120`) strips `filters[].values`, `dateRange`, `uid_list`; keeps only cube/measure/dimension NAMES. The activity endpoint returns the already-projected `recentQueryShapes` (`activity-aggregator.ts:56,149`). FE `formatQueryShape` (`per-user-panel-helpers.ts:149`) binds `shape.cubes/measures.length/dimensions.length` directly — names + counts only, no re-derivation from raw query, no values rendered.

## Error/loading/empty states
PASS. `adminAuditFetch` throws typed errors caught by `SessionDetail`/`SessionsList` `.catch` → `InlineError` (never bubbles to the shell). `ActivitySnapshot` `.catch(() => setFailed(true))` degrades to "chat-service unreachable" without throwing. Empty states present for sessions/turns/users. No unhandled rejections. `502` graceful-degradation covered by server test. No `any`-driven runtime hazards in the new mappers — they read typed fields with `?? 0` / `??` fallbacks. Note: all of these graceful paths will be the *only* thing users see in prod until **C1** is fixed (everything degrades to the 401 error state).

## N+1 / efficiency
PASS. Admin sessions route forwards to chat-service `listSessionsForDebug`, which caps `LIMIT` at 50 by default (`observability-store.ts:251`), so the missing FE `limit` default is not an unbounded-query risk.

---

## Unresolved questions

1. **C1 scope:** does any production smoke path exercise `/admin/dev` or the activity snapshot under real auth? If Phase 5 ships before a prod auth run, C1 won't be caught by CI (dev mode masks it). Recommend an FE test asserting the Authorization header before landing.
2. **Settings "Access" convergence:** `index.tsx:222-230` notes `/admin/access` (old page) and the hub will converge in a follow-up. Confirm the Settings nav target switch is tracked for Phase 6/7 so the duplicate `AdminAccessPage` mount doesn't linger.
3. **`/admin/observability` placeholder** ships as a user-visible "Phase 7" card — confirm intentional for this release vs. hiding the tab until wired.
