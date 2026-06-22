# Phase 07 — Docs + lessons-learned

**Priority:** P2 · **Status:** pending · **Service:** docs

## Context
Close out the four moves with documentation so the explore→segment flow is discoverable and the gotchas are captured.

## Requirements
- Update `docs/` (codebase-summary / system-architecture as relevant) with the new endpoints (`/api/distribution`, `/api/profile`, `/api/overlap-candidate`) and the query→predicate translator + lineage.
- Add `docs/lessons-learned.md` entries for any bug-shapes hit during build (per CLAUDE.md: each entry = a bug shape + signal). Likely candidates: per-user-grain enforcement vs raw mart latency; sample-vs-snapshot overlap approximation; CubeQuery→predicate operator drift.
- Document the segment **lineage** (`born_from`) and where it surfaces in the UI.

## Related code
- Modify: `docs/codebase-summary.md`, `docs/system-architecture.md`, `docs/lessons-learned.md`.

## Implementation steps
1. Document the 3 new endpoints + translator contract.
2. Lessons entries for bug-shapes encountered.
3. Note lineage model + UI surfacing.

## Todo
- [ ] Endpoint + translator docs
- [ ] Lessons-learned entries
- [ ] Lineage documentation

## Success criteria
- A new contributor can find the explore→segment flow and its endpoints from `docs/` without reading the source.

## Next
Plan complete. Revisit the deferred "saveable exploration" primitive (brainstorm Q1) if the open question resolves toward it.
