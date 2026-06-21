# Phase 05 — Saved Views refactor: wire Save action + capture query state

**Priority:** Medium. **Effort:** M. **Status:** pending. **Depends on:** none.

## Overview
Saved Views is half-built: it lists pinned links at `/catalog/saved-views`, is already server-persisted via the generic `user_prefs` store, but **nothing can create one** and it only stores a *route* (no Cube query state). Make it actually useful: wire a "Save view" action in Explore, and persist the full query so reopening restores it.

## Key insights (verified — corrects earlier "localStorage-only" claim)
- Already server-backed: `useSavedViews()` → `createUserPrefsStore('saved-views')` → dual-layer (localStorage mirror `compass:prefs:saved-views` + `/api/user-prefs/:key`, table `user_prefs(owner,key,value)`, per-owner). So storage is NOT the gap.
- `SavedView` today = `{ id, label, routeTo, createdAt }` (`src/shared/user-prefs/use-saved-views.ts:11-16`). Route-only.
- The "Save view" action is explicitly deferred — never wired into Explore/QueryBuilder (comment in the hook).
- Explore page query state is already deep-linkable (`/build?query=...`) — so capturing query state = capturing that serialized state, not new infra.
- Delete rewrites the whole array (not atomic) — acceptable at POC scale; note it.

## Requirements
- Extend `SavedView` to optionally carry the Explore query: `{ id, label, routeTo, query?, gameId?, kind: 'route'|'query', createdAt }` (back-compat: existing route-only entries still render).
- Add a **"Save view"** control to the Explore/QueryBuilder toolbar: capture current serialized query state + game + a default label (editable) → `useSavedViews().add(...)`.
- Saved-views list: query-kind entries open back into Explore with the query restored (build the `/build?query=...` link from stored state); route-kind entries behave as today.
- Optional (confirm in plan Q1): "Save view" from a metric/concept page (route-kind) — likely already the original intent; keep.
- Keep visibility personal-only for now (no sharing) unless user opts into the broader scope.

## Architecture / related files
- Modify: `src/shared/user-prefs/use-saved-views.ts` (extend type + `add` to accept query payload; keep `routeTo` for back-compat).
- Modify: Explore/QueryBuilder toolbar component (add Save view button; read current query state — reuse the same serializer that builds `/build?query=`).
- Modify: `src/pages/Catalog/saved-views/saved-views-page.tsx` (render query-kind rows; build restore link; show game + a small "query" badge).
- Reuse: Explore query (de)serialization util; design tokens.

## Implementation steps
1. Extend `SavedView` type + `add()` (additive, back-compat; default `kind:'route'`).
2. Find the Explore query serializer (the one powering `/build?query=`); expose current state to the toolbar.
3. Add "Save view" button → prompt/inline for label → store `{kind:'query', query, gameId, label}`.
4. Saved-views page: for `kind:'query'`, link to reconstructed `/build?query=...`; show badge + game; for `kind:'route'`, unchanged.
5. Verify server round-trip (user-prefs PUT/GET) + cross-tab via existing subscribe.

## Todo
- [ ] extend SavedView type + add() (back-compat)
- [ ] Save view button in Explore toolbar (reuse query serializer)
- [ ] saved-views page renders + restores query-kind entries
- [ ] back-compat: existing route-only views still open
- [ ] tests: save query view → reopen restores measures/dimensions/filters; server persistence round-trip

## Success criteria
- In Explore, build a query → "Save view" → it appears in Saved Views → click → Explore reopens with the exact query restored. Survives reload + other machine (server-backed).

## Risks
- Query-state schema drift: store the serialized `query` blob the Explore route already understands; don't invent a parallel schema.
- Blob-array delete is non-atomic — fine at POC volume; revisit (own table) only if needed (plan Q1).
- Don't break existing route-only entries.

## Open question for user
Confirm reframed scope (wire Save + capture query state, personal-only) vs adding shared/org visibility, and whether to migrate to a dedicated table for atomic delete. Default = reframed, personal-only, keep user-prefs blob.
