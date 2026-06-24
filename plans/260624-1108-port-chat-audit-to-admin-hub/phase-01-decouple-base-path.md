---
phase: 1
title: Decouple base path
status: completed
priority: P1
effort: 4h
dependencies: []
---

# Phase 1: Decouple base path

## Overview

The `DevAuditShell` and its children hardcode `/dev/chat-audit/...` in routes, redirects, tab defs, and every cross-nav link. To mount the same tool at `/admin/dev/chat-audit`, introduce a single source of truth for the base path via React context, and replace every literal. **Regression-safe refactor — `/dev/chat-audit` must behave identically after this phase.**

## Requirements

- Functional: all existing `/dev/chat-audit` behavior unchanged (routes, deep-links, hash nav, cmd-K, legacy `:sessionId` redirect, owner filter, skill cross-nav).
- Non-functional: no new prop-drilling through 6 levels — use context. No duplicated tab-def arrays.

## Architecture

New module `src/pages/DevAudit/audit-base-path.tsx`:
```tsx
const AuditBasePathContext = React.createContext('/dev/chat-audit');
export const AuditBasePathProvider = AuditBasePathContext.Provider;
export function useAuditBasePath(): string { return useContext(AuditBasePathContext); }
/** Join a sub-segment onto the active base, e.g. auditPath(base, 'sessions', id). */
export function auditPath(base: string, ...segs: string[]): string {
  return [base, ...segs.filter(Boolean)].join('/');
}
```

`DevAuditShell` accepts an optional `basePath` prop (default `/dev/chat-audit`), wraps its content in `<AuditBasePathProvider value={basePath}>`, and builds all its own `<Route path>` / `<Redirect to>` from it. Children read `useAuditBasePath()` instead of literals.

`AuditTabs` accepts `basePath`, builds `AUDIT_TABS` from it (single template list), and forwards to `TabShell`. The optional `tabs` prop lets Phase 2 omit Starters.

## Related Code Files

- Create: `src/pages/DevAudit/audit-base-path.tsx`
- Modify:
  - `src/pages/DevAudit/dev-audit-shell.tsx` — `basePath` prop + provider; routes/redirects/cmd-K from base; `LegacySessionRedirect` parameterized.
  - `src/pages/DevAudit/audit-tabs.tsx` — `basePath` + optional `tabs` prop; build paths from base.
  - `src/pages/DevAudit/sessions-tab.tsx` — `setSelectedSessionId`/`handleSearchSelect` use `auditPath`.
  - `src/pages/DevAudit/search-tab.tsx` — `handleTurnSelect` uses `auditPath`; cmd-K guard uses base (`pushUrl` already uses `location.pathname` — keep).
  - `src/pages/DevAudit/skill-leaderboard-page.tsx` — skill row → `auditPath(base,'sessions')?skill=`.
  - `src/pages/DevAudit/search-result-list.tsx`, `search-results-sessions.tsx`, `search-results-cached.tsx`, `cache-dashboard-top-queries.tsx` — any `/dev/chat-audit/...` link/onSelect target uses base (some receive target via `onSelect` callback already — prefer threading the callback over reading context in leaf rows).

## Implementation Steps

1. Add `audit-base-path.tsx` with context, provider, `useAuditBasePath`, `auditPath`.
2. `dev-audit-shell.tsx`: add `basePath = '/dev/chat-audit'` prop; wrap return in provider; replace every literal in `<Route>`/`<Redirect>`/cmd-K/`LegacySessionRedirect` (pass base into the helper as a prop/arg).
3. `audit-tabs.tsx`: `basePath` prop + optional `tabs?: TabDef[]`; default builds the 5-tab list from base; `resolveAuditTab` keeps working (still exact-prefix on whatever tabs it's given).
4. `sessions-tab.tsx` / `search-tab.tsx` / `skill-leaderboard-page.tsx`: swap literals for `auditPath(useAuditBasePath(), …)`.
5. Sweep the result/cached/cache-top-queries components: confirm each navigation flows through an `onSelect`/`to` that ultimately derives from base. Where a leaf builds its own `/dev/chat-audit` href, switch to context.
6. `grep -rn "/dev/chat-audit" src` → only `index.tsx` route registration + the default context value should remain hardcoded.
7. `tsc --noEmit` (filter to changed files) + run `src/pages/DevAudit/__tests__` and `src/shell/__tests__/tab-shell.test.tsx`.

## Success Criteria

- [ ] `grep -rn '"/dev/chat-audit'` / `'/dev/chat-audit` in `src/pages/DevAudit` returns only the default-context fallback value.
- [ ] All existing DevAudit + tab-shell tests pass unchanged.
- [ ] Manual: `/dev/chat-audit` sessions/search/leaderboard/cache/starters, deep-link `#turn-`, legacy `:sessionId` redirect, cmd-K, skill→sessions cross-nav all work as before.
- [ ] `tsc --noEmit` clean; `npm run lint` (theme tokens) clean.

## Risk Assessment

- **Risk:** missing a literal in a leaf row → broken link only in the admin mount. *Mitigation:* the grep gate in step 6 + Phase 5 manual click-through of every cross-nav on the admin surface.
- **Risk:** `resolveTab` prefix-matching breaks if admin paths share a prefix with another hub tab. *Mitigation:* `/admin/dev/chat-audit/*` is distinct; verified against `DevHubPanel` siblings.

## Next Steps

Unblocks Phase 2 (mount the parameterized shell in the hub).
