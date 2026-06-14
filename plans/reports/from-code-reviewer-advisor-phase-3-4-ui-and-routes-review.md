# Code Review — Optimization Advisor Phase 3 (Explore UI) + Phase 4 (Recommend/Drive + routes + stub hand-off)

Reviewer gate for `/cook --auto`. Scope: server/src/routes/advisor.ts, server/src/advisor/{recommend,handoff-scaffolder,command-center-draft-store,feedback-store}.ts, migration 054, src/api/advisor.ts, src/pages/Advisor/*, shell wiring. Build/typecheck/vitest already green (not re-run).

## Verdict: fix-then-ship

One should-fix authz gap (viewer can write advisor artifacts) — small, isolated fix. Everything else is nice-to-have. No blockers. The trust mechanic (never-launch, status='draft' only) is correct and test-covered.

---

## Blockers
None.

## Should-fix

### S1 — Advisor write routes are NOT behind the viewer write-gate (authz gap)
`server/src/middleware/enforce-write-roles.ts:26` — `PROTECTED_PREFIXES` does NOT include `/api/advisor`. The two mutating advisor routes both persist workspace-shared SQLite artifacts:
- `POST /api/advisor/handoff` → `saveDraft()` writes `advisor_handoff_draft`
- `POST /api/advisor/feedback` → `recordFeedback()` writes `advisor_feedback`

Same artifact-write semantics as `/api/care`, `/api/segments` (shared-within-workspace, role-gated, no per-row ownership). In real-auth mode a **viewer** can currently create drafts and record dismiss/pin feedback. In dev (AUTH_DISABLED) the gate is a no-op so tests don't catch it.
Fix: add `'/api/advisor'` to `PROTECTED_PREFIXES`. GET drafts/feedback stay readable (gate only blocks MUTATING methods). One line; matches existing pattern.

### S2 — Stores trust client-supplied gameId/segmentId; no workspace binding (cross-tenant write/read)
`command-center-draft-store.ts` + `feedback-store.ts` persist and query by `segment_id`/`game_id` taken verbatim from the request body — never validated against `req.workspace` nor stamped with `req.workspace.id`. Sibling stores do exactly this: `care-cases.ts:54 requireGame(req.workspace, …)` validates game against the workspace's known games and `clearCases(game, req.workspace.id)` scopes every read/write by workspace id (comment: "never crosses tenants"). Advisor diverges from that established tenant-isolation pattern.
Impact today is low (segment ids are globally unique-ish, demo is single-workspace), but this is the exact shape of a cross-workspace leak once multiple workspaces use the Advisor: drafts/feedback are not partitioned by tenant. Recommend: validate `gameId` against `req.workspace` and add a `workspace_id` column to both tables (scope all reads/writes by it) before this goes multi-tenant. At minimum, document the deferral explicitly like the stub-registry notice already does.

## Nice-to-have

### N1 — Route is `/advisor` (no `:id`); segment-scope path is unreachable from the router
`src/index.tsx:263` registers `path="/advisor"`, but `AdvisorPage` reads `useParams().id` (`index.tsx:46,49`). `id` is always undefined → `segmentId` always null → scope is always `{kind:'game'}`. Consequence chain:
- `recommendations.tsx:428` sets `segmentId = ''` for game-scope.
- `handoff()` and `sendFeedback()` are then called with `segmentId: ''`.
- Route rejects: `advisor.ts:138` (`!segmentId`) → 400; feedback `advisor.ts:180` → 400.
- handoff 400 surfaces as `alert('… live Cube connection required')` (N3, misleading); feedback 400 is swallowed (`recommendations.tsx:79` best-effort catch) → feedback silently lost in game-scope.
So the entire Drive (hand-off) + feedback path is effectively dead in the only routable scope. Either add a `/advisor/:id` route (segment-scoped entry, e.g. from a segment detail CTA) or make game-scope hand-off/feedback valid server-side (allow empty segmentId, key drafts by game). Decide which is intended — right now the live write paths can't succeed via the shipped route.

### N2 — `handoff` error copy is wrong: scaffold is pure, not a Cube call
`recommendations.tsx:188` shows "Could not create draft — live Cube connection required." But `scaffoldDraft()` is pure (no I/O — confirmed `handoff-scaffolder.ts:106` "Pure — no I/O"). The only failure modes are validation 400 (empty segmentId, see N1) or a transport error. The message misattributes the cause. Also `alert()` is off-design-system (every other surface uses token-styled inline panels). Replace with an inline token-styled error like the recommend block (`recommendations.tsx:458`).

### N3 — File-size guideline (CLAUDE.md: keep under 200 LOC)
`command-center.tsx` 725, `recommendations.tsx` 519, `aspect-card.tsx` 376, `decide-screen.tsx` 300, `use-advisor-investigation.ts` 266 all exceed the 200-line modularization guideline. Not a correctness issue; flag for a follow-up split (command-center especially — it bundles modal, card, store-call, and layout). Backend files all comfortably under.

### N4 — Hand-rolled body parsing instead of zod
`advisor.ts` parses every field by hand (`parseScope`, `parseGoal`, manual `typeof` checks). The sibling pattern uses zod `safeParse` (`announcements.ts:22` `markReadSchema`). The hand-rolled parsing is correct and arguably clearer for the discriminated scope, but it diverges from the repo convention and has no upper bound on array sizes (`parseLenses` accepts an unbounded numeric array; announcements deliberately caps at `.max(500)` to reject hostile payloads). Low risk (lenses are filtered to numbers and the engine ignores unknown ids) but worth a bound.

---

## Acceptance criteria (a–e)

a. **Acceptance** — PASS. Routes validate input (400 on bad scope / missing addressableN / bad feedback) and return correct shapes. Hand-off NEVER launches: `status` is hardcoded `'draft'` (`handoff-scaffolder.ts:64,137`), DB CHECK constrains `status IN ('draft')` (migration:26), test asserts it (test:72). `recommend` chains diagnose→rank deterministically (`recommend.ts:88-92`); LLM phrasing is additive-only and swallow-on-fail (`recommend.ts:100-104`). 502 → honest UI error, no fabricated metrics (`recommendations.tsx:420`, token-styled). Caveat: the live write flow isn't reachable via the shipped route — see N1.

b. **No regression** — PASS. index.ts is +2 additive lines (`be164b6` diff). Shell edits all additive: `NavItemId`/`FeatureKey`/`feature-open-beacon` union members appended; nav item appended to `NAV_ITEMS`; new `/advisor` route; `nav.advisor` i18n key in both en/vi. `showSection('advisor') = isVisible && hasFeature` — same gate as every sibling section (`sidebar.tsx:45,277`); default-on, no existing visibility logic touched.

c. **Contracts** — PASS. No change to existing exported signatures. Frontend duplicate types (`src/api/advisor.ts`) match server 1:1 — verified field-by-field against `candidate-types.ts`, `handoff-scaffolder.ts`, `diagnosis-types.ts` (Factor/GoalTree/Opportunity/Lens/Diagnosis/LeverRef/Feasibility/Power/Effect/Money/Candidate/Arm/Safety/Draft/RecommendParams). No drift found.

d. **Patterns** — MOSTLY PASS. Routes match Fastify style (`introspectionCtx(req)`, reply status codes). Stores use better-sqlite3 prepared-statement + named-param pattern correctly; idempotent upsert via `ON CONFLICT(draft_id)`. Migration 054 follows 053 numbering + style (CHECK constraints, `datetime('now')` defaults, `lower(hex(randomblob(16)))` id default, indexes). Divergences: hand-rolled parse vs zod (N4); no workspace scoping vs care-cases (S2).

e. **PII / security** — MOSTLY PASS. No contact columns persisted or rendered — drafts carry user_id-keyed cohort refs + numeric params only (verified `handoff-scaffolder.ts:58-91`, migration comments, feedback keyed by segment/factor/lever). No free-text SQL gate reintroduced (no `gateSql`/raw SQL string interpolation; all queries parameterized). Stack traces: routes return `err.message` in the 502 `detail` field (`advisor.ts:92,125`) — this is an internal-tool detail leak of low severity but worth noting; sibling care routes return a `{code,message}` envelope without raw `err.message`. The workspace-isolation gap is S2.

## Other assessments
- **Design tokens / page-header** — PASS. Zero raw hex in `src/pages/Advisor/` (grep-confirmed). Page header matches the fixed pattern: `padding '24px 32px'`, `maxWidth 1200`, centered `margin '0 auto'`, icon + 20px/700 sans title (`index.tsx:37-43,85-93`). Semantic tokens used for status (`--warning-soft/-ink`, `--bg-muted`, `--text-muted`). One off-pattern: `alert()` in N2.
- **Stub clarity** — PASS. Draft store, scaffolder, and migration all carry explicit "STUB / until the Command Center registry ships / this is the single swap seam" notices. Good.
- **Idempotency** — PASS. `draftId = ${segmentId}::${candidateId}` deterministic (`handoff-scaffolder.ts:113`); upsert keyed on it (test:128 asserts re-save updates, never duplicates).
- **Feedback append-only** — PASS. Insert-only, no update/delete path; read ordered desc (test:144 round-trips).
- **No plan-artifact refs in code** — PASS (grep-confirmed by builder; spot-checked, clean).

---

## Unresolved questions
1. (N1, decisive) Is the Advisor meant to be entered segment-scoped (`/advisor/:id` from a segment CTA) or game-scoped only? The shipped router (`/advisor`, no param) makes the live hand-off + feedback writes unreachable because they require a non-empty segmentId server-side. This should be resolved before calling Drive "wired."
2. (S2) Is multi-workspace Advisor in scope soon? If yes, the missing `workspace_id` partition on both stub tables is a near-term migration; if the registry swap is imminent, it may be acceptable to defer with an explicit note.
3. (e) Should the 502 `detail: err.message` be scrubbed to a generic message to match the care-route error envelope, or is raw error detail acceptable for this internal-ops tool?
