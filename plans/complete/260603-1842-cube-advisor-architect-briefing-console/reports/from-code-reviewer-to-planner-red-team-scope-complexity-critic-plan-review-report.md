# Red-Team Review — Cube Advisor plan (Scope & Complexity Critic / Contract Verifier)

- Reviewer lens: hostile YAGNI enforcer + contract-consistency verifier
- Target: `plans/260603-1842-cube-advisor-architect-briefing-console/` (plan.md + phases 1-8) and brainstorm report
- Verdict: the plan is over-scoped for a single-user, on-demand, local tool. ~5.5 dev-days for a personal advisor that has produced zero runs of data. Several cross-phase contract drifts will bite in implementation.

---

## Finding 1: 8-phase / 5.5-day full-stack build is gold-plated for a zero-data personal tool
- **Severity:** Critical
- **Location:** plan.md "Phases" table (8 phases); efforts in phase frontmatter (0.5+0.5+1+1+1+1.5+1+0.5 = ~7d incl. spike)
- **Flaw:** This is a single-user, localhost, on-demand tool with **one user (the architect)**. The plan builds: SQLite with 3 tables + migrations, an SSE transport layer, a dedup engine, a configurable-weight ranker, a status state-machine with audit log (`idea_status_log`), three React dashboard surfaces, a mermaid+recharts visual renderer, and a cross-repo plan-handoff writer — before a single real briefing has ever been generated. The brainstorm itself names the true MVP path (Approach C, "static HTML per run") and rejects it *only* because it "can't hold mutable backlog/status." But mutable backlog/status is itself an unproven assumption — you don't yet know if the ideas are even good enough to want a backlog.
- **Failure scenario:** Days 2-7 are spent building store/dedup/rank/landscape/handoff machinery, then Phase 5's first real run produces generic, low-signal ideas (the plan admits this: Phase 5 Risk "Generic v1 ideas → expected"). All the persistence/ranking/dedup scaffolding was built around output that needs prompt rework, and the weights/state-machine were tuned against zero examples. Sunk cost on infra that wraps an unvalidated core.
- **Evidence:** brainstorm line 29 (Approach C rejected); Phase 5 Risk line 52 ("Generic v1 ideas → expected; iterate prompt over runs"); Phase 4 line 22 (configurable weights "revisit after a few real runs" — i.e. no data yet).
- **Suggested fix:** Re-sequence to validate the engine first. v1 = Phase 1 (spike) → Phase 5 (prompt) → emit `ideas.json` → render ONE static HTML file (revived Approach C) per run. Prove the ideas are worth acting on across 3-5 real runs. Only then build the SQLite/dedup/rank/dashboard (Phases 2,3,4,6) once you have real idea corpus to tune against. Defer Phase 7 entirely (see Finding 2). This collapses the critical path from ~7d to ~2d for the value-proving slice.

## Finding 2: Phase 7 "Landscape" surface is scope creep — a separate concern bolted onto "generate ideas"
- **Severity:** High
- **Location:** Phase 7 (entire), brainstorm line 23 + line 30 ("dashboard also surfaces existing feature landscape")
- **Flaw:** The core value is "generate top-3 researched ideas × 2 categories." Landscape re-derives the *existing* feature/plan inventory by parsing `codebase-summary.md` headings + README "Surfaces"/Routes + every `plans/*/plan.md` frontmatter. That is a completely different product (a repo-inventory viewer) sharing only a nav bar. It was added mid-conversation ("your explicit ask" per Phase 7 line 13) and the brainstorm flags "Consolidation" as a *separate* locked decision (line 23), not part of the idea engine. It introduces a brittle dependency on cube-playground's doc structure — the plan itself admits "`codebase-summary.md`/README structure may change → parsers... degrade gracefully" (Phase 7 line 51), i.e. it will silently go stale.
- **Failure scenario:** cube-playground's README/summary headings drift (they change frequently — codebase-summary.md was touched today, 2026-06-03 17:36). Landscape silently shows a degraded/empty inventory, the architect stops trusting it, and a full day of parse-function + fixture + React-table work rots. Meanwhile the actual question Landscape answers ("what already exists, don't re-pitch it") is *already* handled by Phase 4 dedup against `plans/` (Phase 4 line 21).
- **Evidence:** Phase 7 line 22 (parses summary headings + README + plan frontmatter); Phase 7 line 51 (structure-change risk); Phase 4 line 21 (dedup already reads plan index, making Landscape's anti-duplication purpose redundant); `ls docs/codebase-summary.md` → mtime 2026-06-03 17:36 (volatile source).
- **Suggested fix:** Cut Phase 7 Landscape from v1 entirely. The dedup loop already prevents re-pitching planned work. Keep only the Backlog half (it's a trivial reuse of `GET /api/ideas` with no cap — Phase 7 line 23) and fold it into Phase 6. Revisit Landscape as a standalone "v2 if I actually miss it" item.

## Finding 3: Configurable ranking weights are premature tuning against zero data
- **Severity:** High
- **Location:** Phase 4 line 22 (`score = impact * w_i - effort * w_e + confidence * w_c`, "weights configurable")
- **Flaw:** Configurable per-term weights are a tuning knob for a system with a corpus to tune against. There are zero runs. With only top-3 per category to display from top-5 candidates, the ranking barely matters — you're picking 3 of ~5. A configurable weighted-sum scorer (plus the config plumbing, plus `rank.test.ts` asserting "deterministic ordering for known sets") is ceremony around a sort that, at v1 scale, a fixed `impact - effort` would satisfy. The plan even concedes weights are "subjective → revisit after a few real runs" (Phase 4 line 55) — that is an explicit admission the tuning is being built before the data needed to tune it exists.
- **Failure scenario:** Time spent on weight config + tests, then first runs reveal the LLM's `impact`/`effort`/`confidence` numbers are noisy/uncalibrated (non-deterministic engine), so the precise weighted score is sorting on noise. The configurability was never exercised because there's one user who never opens the config.
- **Evidence:** Phase 4 line 22 + line 55 (own admission); only 3-of-5 selection per category (Phase 5 line 16, "top-5 candidates per category" → "ranker keeps top-3").
- **Suggested fix:** v1 ranker = fixed `impact - effort` (or `impact - effort + confidence` with weights = 1), hardcoded, still a pure tested function. Drop the weight-config surface. Add weights only if/when real runs show the simple sort mis-orders ideas you care about.

## Finding 4: Contract drift — Phase 4 idea schema dropped `status`, `firstSeenRun`, `lastSeenRun` that the brainstorm + DB + ranker require
- **Severity:** Critical
- **Location:** Phase 4 line 20 (zod schema field list) vs brainstorm line 42 vs Phase 2 line 22 (DB columns)
- **Flaw:** The brainstorm's authoritative schema (line 42) lists `...fingerprint, status, firstSeenRun, lastSeenRun, dedupVerdict`. Phase 4's zod schema (line 20) lists `...sources[], fingerprint, dedupVerdict` — **`status`, `firstSeenRun`, `lastSeenRun` are missing**. Yet the same Phase 4 ranker filters on `status in (new, accepted)` (line 22) and dedup merges by "bump `run_last`, keep earliest `run_first`" (line 21), and Phase 2's DB has columns `run_first, run_last, status` (line 22). So three documents disagree on whether these are schema fields, and the naming flips between camelCase (`firstSeenRun`/`lastSeenRun`, brainstorm) and snake_case (`run_first`/`run_last`, Phase 2 DB) with no mapping layer specified.
- **Failure scenario:** Phase 5's `prompt-contract.test.ts` (line 33) "asserts every required `idea-schema` field is named in the prompt." If `idea-schema.ts` is built from Phase 4's list, the prompt won't be asked to emit `status`/`firstSeenRun`, and the DB upsert (which has those columns) gets undefined — or, worse, the LLM is asked to emit `status` (it shouldn't; status is backend-owned lifecycle state, not model output). The camel/snake split means the ingest mapping is unspecified and will be guessed differently in Phase 3 (ingest seam) vs Phase 4 (repo).
- **Evidence:** brainstorm line 42 (has `status, firstSeenRun, lastSeenRun`); Phase 4 line 20 (omits all three); Phase 2 line 22 (DB has `run_first, run_last, status`); Phase 5 line 33 (drift test keys off the schema field list).
- **Suggested fix:** Pin a single authoritative schema and split it explicitly into (a) **LLM-emitted fields** (no `status`, no run-tracking — the model can't know these) and (b) **backend-assigned fields** (`status`, `firstSeenRun`/`lastSeenRun`, `created_at`). State the camelCase-DTO ↔ snake_case-column mapping once. Update `prompt-contract.test.ts` to assert only the LLM-emitted subset, or it will demand the model emit fields it must not.

## Finding 5: `confidence` has no defined range while `impact`/`effort` are pinned 1-5 — under-specified contract that breaks the scorer
- **Severity:** High
- **Location:** Phase 4 line 20 (`impact(1-5), effort(1-5), confidence` — no range), used in score line 22
- **Flaw:** `impact` and `effort` are explicitly bounded `1-5`; `confidence` is listed with no range. But it's a direct addend in `score = impact*w_i - effort*w_e + confidence*w_c`. If the LLM emits confidence as 0-1 (probability convention) in some runs and 1-5 (matching its siblings) in others — and a non-deterministic engine *will* do both — the score term swings by 5×, silently re-ordering the ranking. The schema validation (Phase 4 line 33, "out-of-range impact rejected") can't catch an out-of-range confidence because no range is defined.
- **Failure scenario:** Run 1 emits `confidence: 0.8`, Run 2 emits `confidence: 4`. Same idea, wildly different score, ranking flips between runs for no real reason. Dedup merges them (same fingerprint) but which confidence wins is unspecified. The architect sees an idea jump from rank 3 to rank 1 across re-runs and loses trust.
- **Evidence:** Phase 4 line 20 (confidence unbounded) vs line 22 (confidence in additive score) vs line 33 (range validation only mentioned for impact).
- **Suggested fix:** Pin `confidence` to an explicit scale (e.g. `1-5` to match siblings, or `0-1` — pick one) in the zod schema and the prompt output contract. Add it to the range-validation test. If kept as `0-1`, the score formula must normalize the other terms or the confidence term is negligible.

## Finding 6: Two-package FE/BE split with cross-package zod type sharing is monorepo ceremony for a localhost tool
- **Severity:** Medium
- **Location:** plan.md line 27 (stack); Phase 2 line 20 ("Monorepo-lite layout... root package.json with workspace scripts"); Phase 6 line 24 ("import the zod-inferred `Idea` type from backend package (or a copied generated `.d.ts`)")
- **Flaw:** For a single-process localhost tool, splitting into `backend/` + `frontend/` workspaces forces a cross-package type-sharing problem the plan hasn't actually solved — Phase 6 hedges with "import from backend package **(or a copied generated `.d.ts`)**." That parenthetical is an unresolved contract: workspace import vs copied artifact are different build setups, and "copied" means the FE type can silently drift from the BE zod schema (the exact drift Phase 6 line 55 lists as a risk). Two `package.json`s, two test configs, proxy wiring (`:5180`→`:5181`), and workspace scripts are real overhead for a tool one person runs with `npm run dev`.
- **Failure scenario:** Dev copies the `.d.ts` once, later changes the zod schema (Finding 4/5 fixes), forgets to regenerate, FE compiles against a stale `Idea` type, runtime cards break on a renamed field. The "CI typecheck both" mitigation (Phase 6 line 55) doesn't exist — there's no CI for a personal local tool.
- **Evidence:** Phase 2 line 20 (workspace layout); Phase 6 line 24 (unresolved import-vs-copy); Phase 6 line 55 (names the drift risk + a CI mitigation that won't exist for a local tool).
- **Suggested fix:** Single package. Backend serves the built frontend static bundle (Fastify static) on one port — no proxy, no second package.json. Put the zod schema in one `src/shared/idea-schema.ts` imported directly by both server and client code (Vite + a TS path alias). Eliminates the copy-vs-import contract entirely.

## Finding 7: TDD-first framing is forced onto empirical/non-deterministic phases, adding ceremony
- **Severity:** Medium
- **Location:** plan.md line 25 ("each phase is tests-first"); Phase 1 line 30 ("TDD — Tests First" on an empirical spike); Phase 5 lines 31-34
- **Flaw:** The blanket "every phase is tests-first" is sound for pure functions (parser, dedup, rank, schema, path-guard, landscape-parse) but is contorted where the unit under test is a non-deterministic LLM. Phase 1 relabels a throwaway probe script as "the test" (line 31, "the test is an executable assertion script"). Phase 5's only real validation of prompt quality is "(Integration, manual/CI-optional) one real run" (line 34) — the meaningful check is manual, while the "tests-first" items (`run-context.test.ts`, `prompt-contract.test.ts`) test *template rendering and string presence*, not whether the briefing is any good. Calling these "TDD" oversells the rigor and risks the team treating green template-tests as "Phase 5 done" when the actual deliverable (good ideas) is unverified.
- **Failure scenario:** Phase 5 ships with both unit tests green (placeholders filled, schema fields named in prompt) but the prompt produces garbage ideas. The success criteria (line 45-48) are largely structural; "Tesseract content appears as evidence" (line 47) is the only quality gate and it's a single manual run. Team marks Phase 5 complete on green tests; quality regression invisible.
- **Evidence:** Phase 1 line 31; Phase 5 line 34 (real validation is manual/optional); Phase 5 line 45-46 (green-test criteria are structural).
- **Suggested fix:** Keep TDD-first for the pure functions (it's genuinely right there). For Phases 1 and 5, rename to "spike / empirical eval" and make the deliverable a recorded judgment (the spike-findings doc; a saved sample `ideas.json` reviewed by the architect) — not green unit tests. Don't let structural tests stand in for "the ideas are good."

## Finding 8: Plan-handoff (Phase 8) writes into a *different* git repo for a v1 personal tool — risk-laden convenience feature
- **Severity:** Medium
- **Location:** Phase 8 (entire), plan.md line 47, brainstorm line 40/59
- **Flaw:** `POST /api/ideas/:id/plan` writes a markdown brief into `cube-playground/plans/reports/` — i.e. the advisor app reaches across the filesystem and writes into a separate repo's tracked directory. The plan adds a path-guard + new-file-only + idempotency-by-slug to make this safe, which is correct *but is exactly the complexity tax of a feature that saves the single user one copy-paste*. The "act-on loop" can be the architect reading the idea card and running `/ck:plan` themselves with the idea text. Building a cross-repo writer (with traversal-guard tests, idempotency tests, route tests) is gold-plating a manual step that takes 10 seconds.
- **Failure scenario:** The advisor writes `advisor-<date>-<slug>-brief.md` into cube-playground, which then shows up in cube-playground's `git status` as untracked clutter mixed with real work (already visible: the current cube-playground has untracked `plans/reports/` files). The architect now manages briefs generated by a second app inside the primary repo. Idempotency-by-slug means an edited idea silently overwrites the prior brief, or a slug collision clobbers an unrelated file the guard didn't anticipate.
- **Evidence:** Phase 8 line 16-20 (cross-repo write + guards); Phase 8 line 49 (Risk: "Writing into another repo"); brainstorm line 59 (success criterion). The cross-repo write is the only place the advisor is not read-only.
- **Suggested fix:** v1: the "Accept" action renders the brief markdown to the clipboard or a download, OR writes it inside `../cube-advisor/briefs/` (its own repo). Let the human drop it into cube-playground if they want it. Defer the cross-repo writer + all its guards until the tool has proven it produces accept-worthy ideas often enough to justify the convenience.

## Finding 9: Phase 4 ranker status set contradicts the documented status lifecycle (snooze)
- **Severity:** Medium
- **Location:** Phase 4 line 22 (`"top 3" = top-scored status in (new, accepted)`) vs brainstorm line 43 / Phase 7 line 18 (statuses include `snoozed`)
- **Flaw:** Phase 4 says top-3 ranking includes `status in (new, accepted)` and excludes `already-planned` and `dismissed`. But the status vocabulary (Phase 7 line 18, brainstorm line 43 "Accept/Dismiss/Snooze") includes `snoozed` and `shipped`. The ranker's filter says nothing about `snoozed` — is a snoozed idea excluded from the briefing? Presumably yes (that's the point of snooze), but it's not in the exclude list, so by the literal rule (`status in (new, accepted)`) it's correctly excluded — yet then `accepted` ideas keep appearing in the top-3 forever, crowding out new ideas, since "accepted" isn't terminal. The lifecycle is under-specified: what removes an `accepted` idea from the briefing column?
- **Failure scenario:** After a few runs, the architect has accepted 3 ideas per category. Those `accepted` ideas remain `status in (new, accepted)` and keep ranking into the top-3 (they likely score high — that's why they were accepted), permanently displacing fresh ideas. The briefing stops surfacing anything new. Snooze has no defined wake-up, so snoozed ideas vanish forever.
- **Evidence:** Phase 4 line 22 (ranker includes `accepted`, no snooze handling); Phase 7 line 18 (status list has snoozed/shipped); brainstorm line 58 ("Re-runs don't re-pitch... previously-dismissed" — silent on accepted).
- **Suggested fix:** Define the status state-machine explicitly: which statuses appear in Briefing (likely `new` only, or `new` + freshly-`accepted`-this-run), what `accepted` transitions to once a plan is handed off (e.g. `planned`/`shipped` → excluded), and snooze semantics (wake after N runs/days, or manual). Without this the core "top-3 open" promise degrades over exactly the multi-run usage the persistent backlog was built for.

---

## Summary of recommended cuts (MVP-first re-sequence)

1. **Cut Phase 7 Landscape** entirely from v1 (Finding 2). Keep Backlog, fold into Phase 6.
2. **Defer Phases 2/3/4 persistence+dedup+rank** until the engine (Phase 1 + 5) has produced 3-5 real, reviewed runs (Finding 1). v1 = spike → prompt → static HTML render (revived Approach C).
3. **Drop configurable weights** → fixed `impact - effort` (Finding 3).
4. **Collapse to a single package**, Fastify-serves-static, shared zod via path alias (Finding 6).
5. **Defer cross-repo plan-handoff** (Phase 8) → clipboard/own-repo brief (Finding 8).
6. **Pin the schema once** with explicit LLM-emitted vs backend-assigned split + camel/snake mapping + bounded `confidence` + a real status state-machine (Findings 4, 5, 9).
7. **Re-label Phases 1 & 5 as spikes/evals**, not TDD (Finding 7).

True MVP that proves value: Phase 1 (does MCP work headless?) + Phase 5 (prompt that emits good ideas) + a one-file HTML render. ~2 dev-days vs the planned ~7. Everything else is infrastructure betting that the unvalidated core is worth persisting.

## Unresolved questions

1. Is multi-run longevity actually a v1 requirement, or would the architect be satisfied generating a fresh briefing each time (no backlog)? This single answer determines whether 60% of the plan (store/dedup/rank/backlog/status-machine) is needed now.
2. Is `confidence` intended as a 1-5 self-rating or a 0-1 probability? Blocks the schema + scorer.
3. Does `status` belong in the LLM output contract at all, or is it purely backend-assigned lifecycle? Blocks Phase 5's `prompt-contract.test.ts`.
