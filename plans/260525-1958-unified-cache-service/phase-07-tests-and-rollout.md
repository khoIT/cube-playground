# Phase 07 — Tests + Rollout Plan

## Context Links

- Test layout: `chat-service/test/cache/`, `chat-service/test/db/`, `src/pages/DevAudit/__tests__/`
- Config: `chat-service/src/config.ts`
- PII audit blocker (existing): see `chat-service/src/cache/response-cache-write.ts` PII note (line 9–11)
- Phase 01 schema + service: `phase-01-kv-cache-schema-and-service.md`

## Overview

- **Priority:** P1 (gates production flag flip)
- **Status:** pending
- **Description:** Final consolidation of tests across all kv_cache adapters plus a staged rollout plan with explicit kill-switch ladder. PII audit is the existing global gate — this phase documents pass criteria for it.

## Key Insights

- Each phase added its own tests already. This phase adds INTEGRATION tests crossing adapters + dashboard, and ensures the rollout has explicit go/no-go.
- The flag rename (`RESPONSE_CACHE_ENABLED` → `CACHE_SERVICE_ENABLED`) has a single-release overlap window. Document exact deprecation date.
- PII audit is a deploy-time blocker that exists already — this plan does NOT clear it; it only adds new surfaces to the same checklist.

## Requirements

### Functional
- Integration test: full chat turn → 2nd identical turn → both response cache AND prompt cache hit; assert tokens saved match expectations.
- Integration test: enable load+title kinds, disable compaction; verify CACHE_KINDS_DISABLED is respected per kind.
- Integration test: hard-delete session triggers turn_detail cache eviction.
- Rollout doc lives in PR description (not committed file).

### Non-Functional
- Total test suite must remain <2 min wall-clock on CI.
- No flaky tests (network mocks for /load lookups).

## Architecture

Test pyramid:
```
unit tests (per adapter)                        — phases 01, 03, 04, 05 already provide
integration tests (adapter + service + DB)      — this phase adds 3
end-to-end (HTTP → SSE → cache hit)             — this phase adds 1 (extend turn-flow.integration.test.ts)
```

## Related Code Files

### Create
- `chat-service/test/cache/cache-service-integration.test.ts` — kinds gating + flag override.
- `chat-service/test/cache/turn-detail-eviction.integration.test.ts` — hard-delete propagation.

### Modify
- `chat-service/test/turn-flow.integration.test.ts` — extend with a "2nd turn hits cache" assertion (use mocked SDK to return deterministic tokens).
- `docs/development-roadmap.md` — add roadmap entry under "Caching" topic (post-merge task per docs-management rules).
- `docs/project-changelog.md` — entry after phase-07 merges.

### Delete
- None.

## Implementation Steps

### Sub-phase 7A: Test additions
1. **Per-adapter tests** — verify each adapter test from phases 01–05 is in `chat-service/test/cache/`. Run `npm test -- cache/` to confirm coverage.
2. **Cross-adapter integration**: `cache-service-integration.test.ts`:
   - Setup: `CACHE_SERVICE_ENABLED=true CACHE_KINDS_DISABLED=compaction`.
   - Assert `isEnabledForKind('load')` true, `isEnabledForKind('compaction')` false.
   - Set+get on load works; set on compaction is a no-op (returns false / undefined).
3. **Hard-delete eviction**: `turn-detail-eviction.integration.test.ts`:
   - Seed session with 3 turns, populate turn_detail cache for each.
   - Soft-delete session, advance time past 7d, run `hardDeletePendingSessions(db, cutoff)`.
   - Assert kv_cache has 0 turn_detail rows for those turn ids.
4. **Turn-flow end-to-end**: extend `turn-flow.integration.test.ts` (the existing integration test):
   - With cache enabled, fire turn #1 (live LLM mock), then turn #2 with same message.
   - Assert turn #2 SSE stream contains `cache_hit: true`.
   - Assert no second mock SDK invocation occurred.
5. **FE integration**: in `src/pages/DevAudit/__tests__/cache-tab.test.tsx`, add a case where `byKind` includes load + title entries; assert segment buttons render.

### Sub-phase 7B: Rollout ladder

| Step | Action | Verify |
|------|--------|--------|
| 1 | Deploy phase-01 with `CACHE_SERVICE_ENABLED=false` (legacy alias still drives behaviour) | Boot succeeds, kv_cache table created empty |
| 2 | Land phases 02–05 in parallel branches; merge each behind `CACHE_KINDS_DISABLED=load,title,compaction,turn_detail` (all kinds OFF) | No production behaviour change |
| 3 | Land phase 06 (dashboard) — purely additive | Hero still defaults to response; byKind values mostly zero |
| 4 | Enable kinds incrementally: `turn_detail` first (no PII), then `load` (verify cross-owner check), then `title`/`compaction` AFTER PII audit signs off | DevAudit shows hits per kind |
| 5 | Set `CACHE_SERVICE_ENABLED=true` explicitly (drop legacy alias) one release later | Boot log loses deprecation warning |

### Sub-phase 7C: PII audit checklist (deploy-time gate)
The global PII rollout block (referenced in `response-cache-write.ts:9–11` comment) applies. For each new kind, this checklist must be verified BEFORE its kind is enabled in production:

- [ ] `load` — cube /load row data does not include per-user identifiers (cross-owner safe). If found, downgrade to per-owner key (per phase-03 step 1).
- [ ] `title` — owner-scoped lookup verified via test; per-kind disable flag exercised.
- [ ] `compaction` — same as title.
- [ ] `turn_detail` — payload is observability data ALREADY owner-gated at endpoint; cache adds no new exposure.
- [ ] `prompt` (Anthropic-side) — no local storage of prompt content; only token counts in `chat_turns`. No new PII surface.

## Todo List

- [ ] Verify per-adapter test coverage
- [ ] Write cache-service-integration.test.ts
- [ ] Write turn-detail-eviction.integration.test.ts
- [ ] Extend turn-flow.integration.test.ts
- [ ] Extend cache-tab.test.tsx for byKind
- [ ] Document rollout ladder in PR description
- [ ] Run PII audit checklist for each kind before enabling
- [ ] Update docs/development-roadmap.md
- [ ] Update docs/project-changelog.md

## Success Criteria

- All cache-related tests green; total suite stays <2 min.
- Rollout ladder followed; production behaviour unchanged until kinds enabled.
- DevAudit dashboard renders all 6 kinds with non-zero data after each is enabled.
- One release later: `RESPONSE_CACHE_ENABLED` removed from config, no boot warnings.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| PII audit blocks specific kinds (e.g. title) indefinitely | Medium | Medium | Plan ships even if some kinds stay disabled; dashboard handles zero-hit kinds gracefully. |
| Integration tests become flaky due to timing (TTL math) | Medium | Low | Inject `now` clock into kv-cache-service for tests; never use real `Date.now()` in TTL assertions. |
| Rollout step skipped (kinds enabled before audit) | Low | High | Audit checklist is PR-template item; kind enable is a deploy config change reviewed separately. |

## Security Considerations

- Deploy-time PII gate is unchanged; this phase only formalises the per-kind checklist.
- Logs MUST NOT print `value_json` content for any kind.
- `clearForKind` is reachable via debug endpoints only; no public API exposes raw cache content.

## Next Steps

- Post-merge: data migration phase (move legacy `response_cache` rows into `kv_cache` with `kind='response'`). Out of scope for this plan.
- Track Anthropic SDK issue #89 — explicit per-skill cache breakpoints unlock further savings.
- Owner-erasure endpoint (GDPR) — `DELETE /debug/cache?owner_id=X` purging all kinds. Out of scope.
