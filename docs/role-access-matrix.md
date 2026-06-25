# Role & Access Matrix

Single reference for what each role can do. Roles are `viewer | editor | admin`
(`server/src/auth/authz-decisions.ts:22`, `src/auth/auth-context.tsx:45`).

> **The server is the authority.** The FE mirrors these rules cosmetically (hides
> what you can't use), but every mutation is re-checked server-side. Bypassing
> the UI does not bypass the gate.

## Three independent authorization layers

Access is the **AND** of three orthogonal checks — passing one does not grant another:

| Layer | Question it answers | Enforced by |
|-------|--------------------|-------------|
| **Role** | viewer / editor / admin tier | `require-role.ts`, `enforce-write-roles.ts` |
| **Feature flag** | Is this surface enabled for the user? (per-user/per-role) | `require-feature.ts`, `feature-keys.ts` |
| **Game / workspace grant** | May the user see this game in this workspace? | `userCanAccessGame` / `userCanAccessWorkspace` (`authz-decisions.ts`) |

This matrix covers the **role** layer. Feature flags (`advisor`, `admin` are
default-off; all others default-on) and game grants are separate and apply on
top regardless of role.

### A fourth gate for segments & chat: owner-sharing (visibility)

Role decides **read-vs-write** and admin see-all. It does **not** by itself make
one user's segment or chat session visible to another. Those artifacts default
to **private/personal** and are visible to other users **only after the owner
explicitly shares them** — independent of whether that other user is a viewer or
editor:

| Artifact | Default | Who else can view | How it opens up |
|----------|---------|-------------------|-----------------|
| **Segment** | `personal` (`trust-mapping.ts:43`) | owner + admin only | owner shares → `shared`; admin may set `org` (`segments.ts:1227`, `:287`) |
| **Chat session** | `private` | owner + admin (`scope=all`) only | owner `POST /sessions/:id/share` → `shared` (`sessions.ts:192,325`) |

So "viewer can see shared/org segments" in the table below means **after an owner
has shared** — not that all segments are broadly visible. A non-owner (viewer or
editor) gets `403`/`404` on another user's *personal* segment or *private* chat.
Admin is the only role that sees everything regardless of sharing.

## Core principle: read-everywhere, write-gated-by-role

The write gate is centralized, not per-route. `enforce-write-roles.ts` blocks
**all** `POST/PUT/PATCH/DELETE` to these prefixes for `viewer`:

```
/api/segments      /api/dashboards    /api/cube-aliases   /api/user-prefs
/api/business-metrics   /api/analyses   /api/onboarding   /api/glossary
/api/concepts      /api/care          /api/experiments
/api/advisor/handoff   /api/advisor/feedback   /api/advisor/agent/turn
```

→ **viewer** = read-only on every shared artifact. **editor/admin** may mutate.

## Role × action matrix

✅ allowed · ❌ blocked · ⚠️ conditional (see notes)

| Action | viewer | editor | admin | Source |
|--------|:---:|:---:|:---:|--------|
| **Segments** (visibility-gated first — see owner-sharing above) | | | | |
| View own segment | ✅ | ✅ | ✅ | `can-access-segment.ts:33` |
| View *personal* segment owned by someone else | ❌ | ❌ | ✅ | `can-access-segment.ts:31-33` |
| View a segment **another user shared** (`shared`/`org`) | ✅ | ✅ | ✅ | `can-access-segment.ts:34` |
| Create new segment (`POST /api/segments`) | ❌ | ✅ | ✅ | `enforce-write-roles.ts:27,71` |
| Edit shared/org segment (rename, cadence, tags, analyses, refresh) | ❌ | ✅ | ✅ | `canMutateSegment` |
| Delete / redefine cohort / remove activation | ❌ | ⚠️ owner only | ✅ | `canAdministerSegment:54` |
| Change segment visibility (share/unshare) | ❌ | ⚠️ owner only | ✅ | `canAdministerSegment:54` |
| Set visibility to **`org`** | ❌ | ❌ | ✅ | `segments.ts:287` |
| **Dashboards / analyses / cube-aliases / user-prefs** | | | | |
| View | ✅ | ✅ | ✅ | — |
| Create / edit / delete | ❌ | ✅ | ✅ | `enforce-write-roles.ts:28-30` |
| **Glossary / concepts** | | | | |
| View | ✅ | ✅ | ✅ | — |
| Create / edit term or concept | ❌ | ✅ | ✅ | `enforce-write-roles.ts:36-37` |
| Promote concept → glossary term | ❌ | ✅ | ✅ | `concept-promote.ts:61` |
| Promote/curate glossary term (`/api/glossary` admin op) | ❌ | ❌ | ✅ | `glossary.ts:186` |
| **Business metrics** | | | | |
| View / edit draft metric | ✅(view) | ✅ | ✅ | `enforce-write-roles.ts:31` |
| Mark metric **certified** | ❌ | ❌ | ✅ | `business-metrics.ts:321,444` |
| **VIP Care console** | | | | |
| View monitor / ledger | ✅ | ✅ | ✅ | `enforce-write-roles.ts (GET open)` |
| Mutate case ledger / author playbooks | ❌ | ✅ | ✅ | `care-tab.tsx:22`, `enforce-write-roles.ts:40` |
| Run Care precompute | ❌ | ❌ | ✅ | `care-precompute.ts:26-27` |
| **Advisor** | | | | |
| `/diagnose`, `/recommend` (read-only POSTs) | ⚠️ feature-gated | ⚠️ | ✅ | open POST, but `advisor` feature default-off |
| Scaffold hand-off draft / pin / dismiss feedback | ❌ | ✅ | ✅ | `enforce-write-roles.ts:44-45` |
| Run agent turn (paid LLM loop) | ❌ | ✅ | ✅ | `enforce-write-roles.ts:48` |
| **Experiments** | | | | |
| View list / scorecard | ✅ | ✅ | ✅ | `enforce-write-roles.ts:52 (GET open)` |
| Create draft / freeze arm assignment | ❌ | ✅ | ✅ | `enforce-write-roles.ts:52` |
| **Admin surfaces** (all `/api/admin/*` + ops) | | | | |
| Access-management (grant roles/features/games) | ❌ | ❌ | ✅ | `admin-access.ts:64-65` |
| Chat-audit (see all users' sessions) | ❌ | ❌ | ✅ | `admin-chat-audit.ts:67` |
| Cost / activity / advisor-audit consoles | ❌ | ❌ | ✅ | `admin-cost.ts`, `admin-activity.ts`, `admin-advisor-audit.ts` |
| LLM auth-mode switch | ❌ | ❌ | ✅ | `admin-llm-auth.ts:40` |
| Pre-agg runs / query-perf / cube-parity ops | ❌ | ❌ | ✅ | `preagg-runs.ts`, `query-perf.ts`, `cube-parity.ts` |
| Segment-refresh ops (snapshot triggers) | ❌ | ❌ | ✅ | `segment-refresh-ops.ts:35-36` |
| **Chat sessions** (visibility-gated first — see owner-sharing above) | | | | |
| View / list own sessions | ✅ | ✅ | ✅ | owner-scoped |
| View another user's *private* session | ❌ | ❌ | ✅ | `sessions.ts:192` |
| View a session **another user shared** (`shared`) | ✅ | ✅ | ✅ | `sessions.ts:192`, `listSharedSessions` |
| Share / unshare own session | ⚠️ owner only | ⚠️ owner only | ⚠️ owner only | `sessions.ts:325-326` |
| Query `scope=all` chat sessions (everyone's, incl. private) | ❌ | ❌ | ✅ | `chat.ts:757-758,790` |
| **Cross-cutting** | | | | |
| See *all* games (ignores game grants) | ❌ | ❌ | ✅ | `userCanAccessGame:65` |

## viewer vs editor — the short version

A **viewer** can open and read every shared surface (segments, dashboards,
glossary, metrics, Care monitor, experiment scorecards) but **cannot change
anything** — any write returns `403 WRITE_FORBIDDEN`. An **editor** gains write
access to all shared artifacts (create segments/dashboards, edit glossary,
mutate Care ledger, run advisor/experiments) but **not** owner-only destructive
ops on artifacts they don't own, the `org` visibility tier, metric
certification, or any `/api/admin/*` surface.

## Notes & nuances

- **No per-row ownership for collaborative edits.** Artifacts are workspace-shared;
  any editor may *edit* any shared/org segment in the workspace
  (`enforce-write-roles.ts:8-11`). The `owner` column is provenance, not a write
  boundary — **except** the *administer* set (delete, visibility change, cohort
  redefinition, activation removal), which stays owner-or-admin
  (`canAdministerSegment`).
- **`org` visibility is admin-only.** Editors can share to `shared` (if owner) but
  only an admin may promote a segment to org-wide visibility (`segments.ts:287`).
- **Dev mode bypass.** When `AUTH_DISABLED=true`, the write gate is skipped and the
  synthesized dev user is `admin` — everything is permitted locally.
- **Migration fallback.** `AUTHZ_GRANT_FALLBACK` (default on) makes un-seeded users
  fall back to role-based workspace access + all-games. Once a user has any grant,
  they're checked strictly. Admins always bypass game grants.

## Unresolved questions

- The FE `segments-save-bar` does not gate Save on role (relies on server 403).
  Intentional (server-authoritative) but means a viewer sees an enabled Save
  button that fails on click — confirm this is acceptable UX vs. disabling it.
- `advisor` read-only POSTs (`/diagnose`, `/recommend`) are open to any role but
  the whole surface is feature-gated (`advisor` default-off). Verify whether a
  viewer with the `advisor` feature granted is intended to reach them.
