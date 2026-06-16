# Phase 04 — Optimization-playbook catalog + matcher

## Context
- Pattern to mirror (NOT the CS care playbooks — build a NEW optimization catalog): seed+override at `server/src/care/playbook-registry.ts` (declarative seed shape), `care-playbooks-store.ts` (override persistence), `playbook-merge.ts` (seed⊕override), authoring routes `care-playbooks-authoring.ts`.
- Matcher keys off P3 classifier verdict (`matchability` + `preaggHit` + `reason`).

**Priority:** P2. **Status:** pending. **Depends on:** P3 (verdict drives match).

## Decision: seed-only catalog first; override layer = YAGNI for v1
- The care registry's full seed+override+authoring stack exists because CS playbooks are business-curated per game. Optimization remedies are **generic engineering remedies**, stable, few. Ship a **seed catalog** (declarative array, like playbook-registry.ts's seed shape) + a pure **matcher**. Defer the DB override/authoring layer (KISS/YAGNI) — add later only if admins need per-deployment custom remedies. Document the deferral so the override pattern is a known extension point.

## Seed catalog — `server/src/services/optimization-playbooks.ts`
Each remedy (mirror the declarative `Playbook` interface spirit, trimmed):
```ts
interface OptimizationPlaybook {
  id: string;                 // 'add-rollup' | 'narrow-time-grain' | ...
  title: string;
  appliesWhen: (v: Verdict) => boolean;  // pure predicate over P3 verdict
  rationale: string;          // why this query is slow / how the remedy helps
  steps: string[];            // human action list
  scaffolds: 'rollup' | null; // 'rollup' → P5 generates a draft YAML; null → text-only
}
```
Required seed remedies (from task):
1. **add-rollup** — `appliesWhen`: matchable, additive, rollup absent/time-dim-mismatch, preaggHit=miss. → `scaffolds:'rollup'`. Steps cite rollup authoring rules (time_dimension must match query's bound time dim; additive measures only; add `*_ts_batch` sibling for dteventtime; `LEAST(MAX(...),current_timestamp)` cap for ts-keyed — lessons-learned.md:57-67).
2. **narrow-time-grain** — query spans many partitions; suggest tighter dateRange / coarser grain to prune. `scaffolds:null`.
3. **pre-filter / segment** — query is broad scan; suggest predicate-scoping (cite scope-by-predicate-not-uid-IN, lessons-learned.md:45-49). `scaffolds:null`.
4. **materialize as membership snapshot** — `appliesWhen`: matchability=unmatchable (per-user row listing — the verified root cause). Point to the SHIPPED nightly segment-membership snapshot job (stag_iceberg, commit ac25dfc — memory "Segment membership lakehouse snapshot"): serve per-user listings from the snapshot, not a live Cube scan. `scaffolds:null`.
5. **can't-optimize → accept / raise timeout** — fallback when no structural remedy fits (genuine one-off per-user pull). Note the proxy 30s ceiling already shipped (cube-proxy.ts:27); document raising nginx/timeout as last resort. `scaffolds:null`.

## Matcher — `server/src/services/optimization-playbook-matcher.ts`
- `matchPlaybooks(verdict): OptimizationPlaybook[]` — pure; returns all seeds whose `appliesWhen(verdict)` is true, ordered by specificity (most-specific structural remedy first, accept-timeout last).
- `bestPlaybook(verdict): OptimizationPlaybook | null` — top match, or null → triggers P6 LLM fallback.
- Both pure, no I/O. The matcher is the gate: a non-null `bestPlaybook` means NO LLM call (P6 fires only on null).

## Read API
- Extend `query-perf.ts`: `GET /api/query-perf/:id/suggestion` — loads the row, runs P3 classifier → P4 matcher, returns `{ verdict, playbooks: [...], best, needsLlm: boolean }`. `needsLlm=true` only when `bestPlaybook` is null (P6 hook). On-demand (admin clicks) — not auto-run.

## Related files
- Create: `server/src/services/optimization-playbooks.ts`, `optimization-playbook-matcher.ts`, `optimization-playbook-matcher.test.ts`.
- Modify: `server/src/routes/query-perf.ts` (`/:id/suggestion`).

## Todo
- [ ] optimization-playbooks.ts seed catalog (5 remedies, appliesWhen predicates)
- [ ] matcher (matchPlaybooks + bestPlaybook)
- [ ] /:id/suggestion route (classify→match→respond, needsLlm flag)
- [ ] unit tests: each verdict class → expected playbook(s); unmatchable→materialize-snapshot; matchable+no-rollup→add-rollup w/ scaffolds:'rollup'; no-match→needsLlm

## Success criteria
- Root-cause query verdict (unmatchable) → top playbook = materialize-snapshot (NOT add-rollup — a rollup can't serve a per-user listing).
- A matchable additive query missing a rollup → top = add-rollup with `scaffolds:'rollup'`.
- A verdict no seed covers → `bestPlaybook=null`, `needsLlm=true`.
- Matcher pure + deterministic (fixture-tested).

## Risks
| Risk | L×I | Mitigation |
|---|---|---|
| Wrong remedy suggested (e.g. add-rollup for a per-user listing) | M×H | matchability gate: unmatchable suppresses add-rollup; tested explicitly. The exact trap the root-cause illustrates. |
| Over-engineering with override layer | M×L | Seed-only v1, override deferred (documented extension point). |
| Seed predicates drift from classifier shape | L×M | Predicates consume the typed Verdict from P3; shared type prevents drift. |

## Security
Pure logic + one admin-gated read route (inherits preHandlers). No PII (operates on NAMES-only verdict).

## Open questions
1. Should the matcher return ranked playbooks or just the single best? Plan = return all + best; UI shows best, lists alternatives. Confirm UX in P5.
