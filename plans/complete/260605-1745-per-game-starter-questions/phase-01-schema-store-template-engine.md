# Phase 01 — Schema + Store + Deterministic Template Engine

## Context Links
- Plan: [plan.md](plan.md)
- Meta machinery (REUSE): `chat-service/src/core/cube-meta-cache.ts` — `getMeta`, `getMetaVersion`, `computeMetaVersion`, `extractMemberNames`
- Migrate pattern: `chat-service/src/db/response-cache-migrate.ts`, `chat-service/src/db/migrate.ts:1-40`
- Store pattern: `chat-service/src/db/response-cache-store.ts`
- Static starters reference (intents to mirror): `src/pages/Chat/library/starter-questions.ts:40-170`
- StarterQuestion shape (FE contract): `src/pages/Chat/library/starter-questions.ts:15-38`

## Overview
- **Priority:** P2 (blocker for all later phases)
- **Status:** pending
- **Description:** Add the SQLite table + store module + the deterministic template engine. No HTTP, no LLM, no FE. This phase is the data + pure-logic foundation, fully unit-testable in isolation with `new Database(':memory:')`.

## Key Insights
- The meta-hash machinery ALREADY EXISTS (`computeMetaVersion`) — do not re-invent it. The store keys rows by that hash.
- `getMeta` returns meta already game-scoped and stripped of views + raw std_* cubes. The template engine consumes the structured object directly (NOT a serialized string — serialization is only for the LLM pass in phase 2).
- Generated questions MUST keep the exact `StarterQuestion` shape so the FE persona filter + histogram ranking work unchanged. `personaTags ∈ {pm,marketer,analyst}`, `categoryTags ∈ {explore,metric_explain,compare,diagnose}`, `targetCatalogIds` = real `cube.member` names from THIS game's meta.
- Member names differ per workspace model (bare `mf_users.payer_tier` local vs prefixed `cfm_user_recharge_daily.*` prod). The template engine must read the ACTUAL member names from meta, never hardcode them.

## Requirements
### Functional
- `migrateStarterQuestions(db)` creates `starter_question_sets` (idempotent, CREATE TABLE IF NOT EXISTS), wired into `migrate.ts`.
- Store module `starter-questions-store.ts`: `getSet(workspace, game)`, `upsertSet(params)`, `markInflight`/`clearInflight` helpers (single-flight support consumed in phase 2).
- Template engine `starter-question-templates.ts`: pure function `buildTemplateQuestions(meta) → StarterQuestion[]`.

### Non-functional
- Each file < ~200 lines; kebab-case.
- Store reads/writes synchronous (better-sqlite3).
- No code comment references plan/phase numbers.

## Architecture

### Table `starter_question_sets`
```sql
CREATE TABLE IF NOT EXISTS starter_question_sets (
  workspace       TEXT    NOT NULL,
  game_id         TEXT    NOT NULL,
  meta_hash       TEXT    NOT NULL,
  source          TEXT    NOT NULL,          -- 'template' | 'llm'
  questions_json  TEXT    NOT NULL,          -- StarterQuestion[] serialized
  status          TEXT    NOT NULL,          -- 'template' | 'refining' | 'llm' | 'failed'
  inflight_until  INTEGER,                   -- epoch ms single-flight lease; NULL = free
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  PRIMARY KEY (workspace, game_id)
);
```
- ONE row per (workspace, game) — the current best set. `meta_hash` records the hash the set was generated against; staleness = stored hash ≠ live hash.
- `source`/`status` separate WHAT we have from WHAT we're doing: `source='template', status='refining'` = baseline served while LLM runs; `source='llm', status='llm'` = refined set settled.
- `inflight_until` is a time-boxed lease (e.g. now+60s) for single-flight; an expired lease is reclaimable so a crashed refine never wedges generation forever.

### Store contract (`starter-questions-store.ts`)
```ts
interface StarterSetRow { workspace; game_id; meta_hash; source; questions: StarterQuestion[]; status; inflight_until: number|null; updated_at }
getSet(db, workspace, gameId): StarterSetRow | null
upsertSet(db, { workspace, gameId, metaHash, source, questions, status }): void   // updated_at=now
tryAcquireRefineLease(db, workspace, gameId, leaseMs): boolean   // atomic UPDATE ... WHERE inflight_until IS NULL OR inflight_until < now
releaseRefineLease(db, workspace, gameId): void
```
- `StarterQuestion` type duplicated server-side as a local interface (FE type can't be imported across the repo boundary) — keep field names identical. Document the cross-boundary contract in a comment.

### Template engine (`starter-question-templates.ts`)
Pure: `buildTemplateQuestions(meta): StarterQuestion[]`. No I/O.

1. Build a member index from `meta.cubes[].measures[]` / `.dimensions[]` → `Set<memberName>` (reuse `extractMemberNames`) + a lookup of `{name,title,type}`.
2. Define ~10-12 templates. Each template = `{ id, requires: string[] (member-name predicates), build: (resolved) → StarterQuestion }`. A template fires only when ALL its required members resolve in the index. Predicates match by member SUFFIX (`*.payer_tier`, `*.days_since_last_active`) so they work across bare + prefixed models.
3. Emit fired templates in a fixed priority order; cap at ~16-18 to match current grid density. Always emit `targetCatalogIds` = the resolved real member names.

### Template catalogue (mirror the 18 static intents, segment-biased)
| id | fires when members present (suffix match) | persona | category | intent |
|----|--------------------------------------------|---------|----------|--------|
| dormant-whales | `payer_tier` + `days_since_last_active` | pm,marketer | explore,diagnose | win-back list (SEGMENT) |
| churn-risk-payers | `churn_risk` + `payer_tier` | pm,analyst | diagnose,explore | churn segment (SEGMENT) |
| vip-outreach | `max_vip_level` + (`ltv_vnd`\|`ltv_total_vnd`) | pm,marketer | explore | VIP outreach list (SEGMENT) |
| reactivation-targets | `days_since_last_active` + ltv member | marketer,analyst | explore,diagnose | lapsed high-value (SEGMENT) |
| revenue-by-payer-tier | `payer_tier` + ltv/revenue measure | analyst,pm | explore,compare | revenue distribution |
| lifecycle-mix | `lifecycle_stage` + `user_count` | pm,analyst | explore | base by lifecycle |
| ltv-by-cohort | ltv measure + an install/time dim | analyst,marketer | metric_explain,compare | LTV by install cohort |
| new-cohort-retention | retention measures (`rnru_d*`/`retention_d*`) | pm,analyst | metric_explain,explore | D1→D30 curve |
| retention-compare | ≥2 retention measures | pm,analyst | compare | compare install cohorts |
| dau-trend | a dau/active measure | pm,analyst | explore,metric_explain | DAU trend |
| spend-by-channel | a marketing cost measure | marketer | explore,compare | spend split |
| cpi-or-roas | `cpi*`\|`roas` measure | marketer,analyst | compare,explore | CPI/ROAS by channel |
| platform-arpu | `arpu*` + a platform dim | analyst,marketer,pm | compare | iOS vs Android ARPU |

(Engine selects whichever fire; a sparse game still yields a few. If <3 fire, caller falls back to static.)

## Related Code Files
**Create:**
- `chat-service/src/db/starter-questions-migrate.ts`
- `chat-service/src/db/starter-questions-store.ts`
- `chat-service/src/core/starter-question-templates.ts`
**Modify:**
- `chat-service/src/db/migrate.ts` — import + call `migrateStarterQuestions(db)`.

## Implementation Steps
1. Write `starter-questions-migrate.ts` mirroring `response-cache-migrate.ts` (CREATE TABLE IF NOT EXISTS + idempotent ALTERs if needed).
2. Wire it into `migrate.ts` (import + call after the existing feature migrations).
3. Write `starter-questions-store.ts` with the contract above; define the local `StarterQuestion` interface + a `StarterSource`/`StarterStatus` union.
4. Write `starter-question-templates.ts`: member index builder + template table + `buildTemplateQuestions`.
5. Compile: `cd chat-service && npx tsc --noEmit`.

## Todo List
- [ ] `starter-questions-migrate.ts` + wired into `migrate.ts`
- [ ] `starter-questions-store.ts` (get/upsert/lease)
- [ ] `starter-question-templates.ts` (index + ≥12 templates + builder)
- [ ] Local `StarterQuestion` interface matches FE field-for-field
- [ ] `npx tsc --noEmit` clean in chat-service

## Success Criteria
- Migrate creates the table on a fresh `:memory:` db without error and is idempotent on second call.
- `buildTemplateQuestions(localMetaFixture)` returns ≥3 questions, every `targetCatalogIds` entry is a member present in the fixture, every `personaTags`/`categoryTags` is in the allowed unions.
- A sparse-meta fixture (few members) returns a smaller set, never throws, never invents a member.

## Risk Assessment
| Risk | L×I | Mitigation |
|------|-----|------------|
| Suffix predicate over-matches (e.g. `_id` collides) | M×M | Match on full member suffix segment after the last `.`, anchored; unit-test prefixed + bare fixtures |
| Template emits a member that exists in meta but not as the *type* assumed (dim used as measure) | L×M | Index carries `type`; templates assert measure-vs-dimension role before firing |
| Local `StarterQuestion` drifts from FE type | M×M | Comment cross-references the FE file path; phase-05 adds a shape test |

## Security Considerations
- No new auth surface this phase (pure data + logic). Table is workspace+game scoped; no owner/PII stored (questions are schema-derived, not user data).

## Next Steps
- Phase 2 consumes the store + engine behind the HTTP route and adds the LLM refine + staleness logic.
