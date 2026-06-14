---
name: write-role-gate-is-prefix-based
description: Viewer write-protection is a central prefix allowlist, NOT per-route — new mutating route families silently ship writable-by-viewer unless added.
metadata:
  type: project
---

The server's viewer/editor write RBAC is enforced centrally by a single preHandler, `server/src/middleware/enforce-write-roles.ts`, against a hardcoded `PROTECTED_PREFIXES` allowlist (e.g. `/api/segments`, `/api/dashboards`, `/api/care`, `/api/analyses`, `/api/business-metrics`, `/api/concepts`). It blocks POST/PUT/PATCH/DELETE for `req.user.role === 'viewer'` only on those prefixes; everything else is unguarded by default.

**Why:** chosen over sprinkling `requireRole('editor','admin')` on each handler. Artifacts are workspace-shared, so write access is role-only (no per-row ownership). The gate is a **no-op when AUTH_DISABLED=true** (dev) — the synthesized dev user is admin — so missing-prefix bugs do NOT surface in local dev or in vitest (which runs auth-disabled).

**How to apply:** when reviewing ANY new mutating route family (`/api/<new>` with POST/PUT/PATCH/DELETE that persists shared artifacts), check whether its prefix was added to `PROTECTED_PREFIXES`. If not, it ships writable-by-viewer in real-auth mode and tests will be green. This bit the Advisor routes (`/api/advisor/handoff`, `/api/advisor/feedback`) which persist workspace-shared SQLite drafts/feedback but were not in the allowlist. Pair this check with the workspace-isolation pattern: sibling stores (care-cases.ts) validate game against `req.workspace` and stamp `req.workspace.id` on every read/write to prevent cross-tenant leakage — new SQLite-backed stores keyed only by client-supplied segmentId/gameId are a cross-workspace leak shape.
