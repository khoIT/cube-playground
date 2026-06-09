# Red-Team Review — Cube Advisor Plan (Assumption Destroyer / Scope Auditor)

- Reviewer lens: hostile skeptic. Goal: prove load-bearing "will work" claims are unverified.
- Target: `plans/260603-1842-cube-advisor-architect-briefing-console/` (plan.md + phase-01..08 + brainstorm report).
- Method: every codebase-fact claim grep/probe-verified against `cube-playground`. Live `claude -p` probes run to test the gating MCP assumption.
- Verdict headline: the SINGLE biggest assumption the plan fears (MCP-in-headless) **empirically holds** — but several *secondary* assumptions the plan states as fact are wrong or unspecified, and the plan has internal contradictions.

---

## Finding 1: The gating risk is real but MIS-CHARACTERIZED — headless MCP works; the actual fragility is per-connector auth state, which the plan never models
- **Severity:** High
- **Location:** Phase 1 (whole), plan.md:25 + :45, brainstorm:18/34/47
- **Flaw:** Plan treats Phase 1 as a binary PASS/FAIL on "does headless `claude -p` load claude.ai remote MCP connectors at all." That framing is wrong. I ran the probes. Headless DID load remote connectors and DID fetch the page. So the gate as written passes trivially — but it gives false confidence, because MCP availability is **per-connector and per-auth-state**, not global. `claude mcp list` shows 18 connectors; only Atlassian, Microsoft 365, Figma are `✓ Connected`. The VNGGames data connectors that actually matter for cube-playground product signal — `GDS Connector`, `VDA - VNGGame Data Analytics`, `ADA-STG Analytics`, `Sensor Tower` — all show `! Needs authentication`. Phase 1's success criteria only test Atlassian + Outlook; it will report PASS while the data-signal connectors are silently unusable. The fallback branch is also mis-scoped: it's spec'd for "Confluence REST + Graph" but says nothing about the un-authed VNGGames connectors, which have no documented REST fallback.
- **Failure scenario:** Phase 1 passes (Atlassian + M365 work). Phases 3/5 ship. First real briefing run silently produces zero VNGGames-data-layer evidence because GDS/VDA tokens expired or were never authed headless; the architect gets a "product/data-layer experience" briefing with no actual product data signal, and nobody notices because the gate was green.
- **Evidence:**
  - Live `claude mcp list`: `claude.ai Atlassian … ✓ Connected`, `claude.ai Microsoft 365 … ✓ Connected`, but `claude.ai GDS Connector … ! Needs authentication`, `claude.ai VDA - VNGGame Data Analytics … ! Needs authentication`, `claude.ai ADA-STG Analytics … ! Needs authentication`.
  - Live `claude -p … fetch Confluence page 1609334800` returned `{"success": true, "title": "🏛️ Tesseract — Architecture (target) v0.2"}` exit 0 — proves headless MCP+Atlassian works, so the gate-as-written is not actually a risk.
  - `~/.claude.json` `mcpServers: []` (empty) but `claudeAiMcpEverConnected` lists all 8 connectors — confirming these are claude.ai remote OAuth connectors, NOT local `.mcp.json` servers, and live in app state not project config.
- **Suggested fix:** Reframe Phase 1: (a) drop the binary gate; it passes. (b) Make the gate a per-connector auth-state assertion — probe each connector the briefing actually needs (Atlassian, M365, AND the VNGGames data connectors) and record which are authed; (c) add a runtime pre-flight in Phase 3 that calls `claude mcp list`-equivalent and refuses/flags a run if a required connector is `Needs authentication`; (d) spec the fallback per-connector, not globally — VNGGames connectors have no public REST and need their own decision.

## Finding 2: Phase 1 cost/latency is empirically ~$0.6–1.0 per single trivial probe — full-run cost assumption is hand-waved and likely 10–50× that
- **Severity:** High
- **Location:** plan.md (no per-run budget), brainstorm:64 ("minutes + meaningful spend"), Phase 1 step 4 ("token cost"), Phase 3 NFR (15-min timeout)
- **Flaw:** The plan acknowledges cost as a "risk" but never bounds it, and the design (`--output-format stream-json`, opus, deep-research fan-out × ~10 candidates × 2 categories + full repo reads + Confluence + Outlook) is structurally expensive. My probes — which did *nothing* but list tools / fetch one page — each cost $0.62, $0.88, $1.02, on ~40–100k input tokens with 1M context window and opus-4-8. A real briefing run does multi-file repo scans (cube-playground + cube-dev), per-candidate deep research, and web search. Extrapolating, a single "Generate briefing" click plausibly costs several to tens of dollars and runs many minutes against the 15-min timeout.
- **Failure scenario:** Architect clicks "Generate briefing" a few times during a demo; bill is tens of dollars/day. Or: a real run exceeds the 15-min Phase 3 timeout mid-deep-research, child is killed, run marked `failed`, `ideas.json` never written, zero output for the spend.
- **Evidence:** Live probe `total_cost_usd` values: `0.624763`, `0.8838952`, `1.02037175` for trivial single-tool prompts (from `--output-format json` result envelopes). `duration_ms: 22132` for the trivial tool-list probe alone (`ttft_ms: 9309`).
- **Suggested fix:** Phase 1 must record measured cost/latency of a *representative* run (not a tool-list probe) and the plan must set an explicit per-run budget + token ceiling. Reconsider the 15-min timeout against measured deep-research latency. Consider sonnet for fan-out research, opus only for ranking. Add a cost guard in Phase 3.

## Finding 3: Stack-mirror claim is partly false — `mermaid` is NOT a cube-playground dependency
- **Severity:** Medium
- **Location:** plan.md:27 ("Stack (mirrors cube-playground): … recharts + mermaid"), Phase 6 NFR + `VisualRenderer.tsx`, brainstorm:43
- **Flaw:** Plan repeatedly asserts the frontend "mirrors cube-playground" and lists `recharts + mermaid`. recharts is real; **mermaid is not a dependency anywhere in cube-playground**. So `VisualRenderer`'s `kind:mermaid` branch (Phase 6) is net-new tech the team has not used here, not a mirror — and mermaid-in-React is explicitly flagged finicky by the plan itself. Building the `suggestedVisual{kind:mermaid}` path on an unproven lib while claiming it's a mirror is an unverified "will work."
- **Failure scenario:** Team adopts mermaid expecting parity with an existing integration; hits the well-known mermaid async-render/React-StrictMode double-render issues; `VisualRenderer.test.tsx` (Phase 6) needs jsdom mocking of `mermaid.render` that doesn't exist as prior art in this repo. Schedule slips on a "mirror" task.
- **Evidence:** `grep '"mermaid"' package.json server/package.json chat-service/package.json` → no match (NO mermaid dependency anywhere). `recharts` present: `package.json:75 "recharts": "^2.12.7"`. Cube-playground charts use recharts only (README:8 "recharts bar/line").
- **Suggested fix:** Drop the "mirrors cube-playground" wording for mermaid. Either restrict v1 visuals to recharts (proven) and defer mermaid, or explicitly call mermaid a new dependency with its own spike. The Mermaid Chart claude.ai connector also shows `✗ Failed to connect` in `claude mcp list`, so don't assume MCP-generated mermaid either.

## Finding 4: Backend "mirrors cube-playground stack" — TRUE, and verified; but type-sharing across two repos (Phase 6) is unverified and structurally hard
- **Severity:** Medium
- **Location:** plan.md:27, Phase 2 NFR, Phase 4 step 1 ("shared with frontend types via export"), Phase 6 ("import the zod-inferred `Idea` type from backend package (or a copied generated `.d.ts`)")
- **Flaw:** The Fastify + better-sqlite3 + zod backend claim IS verified (good). But the plan's type-sharing story is two unverified hand-waves with an "or": "import from backend package OR a copied generated `.d.ts`." cube-playground itself is NOT a monorepo with cross-package type sharing — server and frontend are separate `package.json`s. The advisor is described as "monorepo-lite" (Phase 2:20) with no workspace tooling decided (Phase 2 step 1 says "workspaces or simple prefix scripts"). A zod schema in `backend/src/ideas/idea-schema.ts` imported by `frontend/` requires either real workspace resolution + shared tsconfig paths or a build step — neither is specified. "Copied generated .d.ts" silently reintroduces the FE/BE drift the plan claims to prevent.
- **Failure scenario:** Phase 6 tries `import { Idea } from '../../backend/src/ideas/idea-schema'`; Vite/TS can't resolve across package boundaries without path aliases; team falls back to hand-copying the type; schema changes in Phase 5/8 silently desync FE and BE; the "CI typecheck both" mitigation (Phase 6 risk) doesn't catch a copied stale type.
- **Evidence:** `server/package.json` and root `package.json` are distinct (no workspaces field linking them); deps verified: `server/package.json:19 "better-sqlite3"`, `:20 "fastify"`, `:26 "zod"`, root `package.json:75 recharts`, `:62 react ^18.3.1`, `:105 vite`, `:106 vitest`, RTL at `package.json:85-87`. Phase 2 step 1 leaves workspace strategy undecided.
- **Suggested fix:** Decide the monorepo tool in Phase 2 (npm workspaces) and make the shared schema a real internal package with a path alias; delete the "or copied .d.ts" escape hatch. Add a contract test that imports the *same* module from both sides.

## Finding 5: Phase 7 Landscape parser assumes `plans/*/plan.md` frontmatter — but HALF the active plans have NO frontmatter
- **Severity:** High
- **Location:** Phase 7 Architecture ("parses … `plans/*/plan.md` frontmatter (title/status)"), Phase 7 risk ("Plan frontmatter variance … default unknown status to planned")
- **Flaw:** The Landscape surface (the architect's explicit ask, per brainstorm:23) sources existing-plan state from `plans/*/plan.md` frontmatter. Only **3 of 6** active `plans/*/plan.md` files have YAML frontmatter at all; the other 3 use a freeform `**Status:** …` markdown line instead. The plan's mitigation ("default unknown status to planned") would silently mislabel real in-flight/shipped work as "planned." E.g. `chat-turn-profiling` is "Phase 0 shipped" in prose but would render as "planned."
- **Failure scenario:** Architect opens Landscape to see ecosystem state; frontmatter-less plans either vanish (no title parsed) or all show "planned"; the consolidation surface — the whole reason Landscape exists — gives a wrong picture of what's shipped vs open, defeating dedup intent.
- **Evidence:** `ls plans/*/plan.md` → 6 files; `grep -l '^---' plans/*/plan.md` → only 3. Frontmatter-less example `plans/260601-1319-chat-turn-profiling-decompose/plan.md:1` starts `# chat-service turn.ts …` with `**Status:** Phase 0 shipped …` on line 3 (no YAML). `plans/complete/` is healthier (44/49 have frontmatter+status) but active `plans/` is the inconsistent set.
- **Suggested fix:** Parser must handle BOTH shapes: YAML frontmatter AND the `**Status:**`/`# Title` prose convention. Test fixtures (Phase 7) must include a frontmatter-less plan. Or: normalize the 3 active plans' frontmatter as a precondition (but that mutates cube-playground; advisor is supposed to be read-only toward it).

## Finding 6: README "Surfaces" is a prose bullet list, not a parseable "Surfaces" section header — Phase 7 parse assumption is loose
- **Severity:** Medium
- **Location:** Phase 7 Architecture ("README \"Surfaces\"/\"Routes\""), Functional req
- **Flaw:** Plan says it parses README "Surfaces"/"Routes" as if both are stable structured sections. Reality: `Surfaces:` is a lowercase inline label (line 5) followed by bold-prefixed bullets (`- **Chat** — …`), NOT a markdown heading. `## Routes` IS a heading but its content is a pipe TABLE, not a list. These are two different parse shapes, neither matching the "headings" assumption shared with `codebase-summary.md`. A naive heading-based scanner gets nothing from "Surfaces".
- **Failure scenario:** `scan-landscape.ts` keys off `##` headings; misses the `Surfaces:` bullet block entirely; Landscape shows routes-from-table but no surface inventory, or crashes on the table format if it expects bullets.
- **Evidence:** `README.md:5` = `Surfaces:` (inline, not `##`); `:7-14` bold-bullet list; `README.md:79` `## Routes` followed by a markdown table `| Route | Area |` (lines 81+). `docs/codebase-summary.md` by contrast uses real `##`/`###` headings (`:1 # Codebase summary`, `:47 ## App shell`, `:113 ### Routes (server-side)`).
- **Suggested fix:** Phase 7 must enumerate the THREE distinct parse shapes (codebase-summary `##/###` headings, README `Surfaces:` bold-bullets, README `## Routes` pipe table) with a fixture each. Treat README structure as brittle and pin to the exact current shapes, or scrape less and rely on codebase-summary headings only.

## Finding 7: Plan-handoff write target contradicts itself across documents (`plans/` vs `plans/reports/`)
- **Severity:** Medium
- **Location:** plan.md:47 vs Phase 8 (Functional + Architecture + Success), brainstorm:40/59
- **Flaw:** Three documents disagree on where the "Accept → create plan" handoff writes. plan.md:47 and brainstorm:40/59 say it writes "into `cube-playground/plans/`". Phase 8 says `cube-playground/plans/reports/` (`advisor-<date>-<slug>-brief.md`). These are different directories with different semantics: `plans/` holds plan folders; `plans/reports/` holds review/brainstorm reports. A `/ck:plan`-ready brief is conceptually a brainstorm-style handoff (Phase 8 says "reuse the brainstorm-report shape"), so `plans/reports/` is arguably right — but the contradiction means the success criteria and the path guard could be implemented against the wrong target.
- **Failure scenario:** Path guard (Phase 8) is built to allow `plans/reports/` but a reviewer reading plan.md:47 expects `plans/`; OR the brief lands in `plans/reports/` where `/ck:plan` doesn't look for plan seeds, breaking the "go straight from briefing to implementation" loop.
- **Evidence:** plan.md:47 "writes into `cube-playground/plans/`"; brainstorm:40 "writes `/ck:plan`-ready brief into `cube-playground/plans/`"; Phase 8:16/20/42 "`cube-playground/plans/reports/`". `plans/reports/` confirmed to exist and hold reports (this very review lives there).
- **Suggested fix:** Pick one target and make all three docs agree. Given the brief is brainstorm-shaped, `plans/reports/` is defensible — but then update plan.md:47 + brainstorm. Confirm `/ck:plan` consumes from that location.

## Finding 8: "Schema-valid ideas.json with correct dedupVerdict referencing real backlog ids" is an assumed LLM guarantee with a weak guard
- **Severity:** High
- **Location:** Phase 5 (output contract), Phase 4 ("Backend trusts the verdict but guards with a fingerprint match"), success criteria across 4/5
- **Flaw:** The plan's correctness rests on the spawned session reliably (a) writing a file at exactly `runs/<id>/ideas.json`, (b) matching a strict zod schema, and (c) emitting `dedupVerdict: duplicate-of:<id>` / `already-planned` that reference REAL ids from the injected backlog/plan index. LLM file-write + strict-schema compliance is assumed, not enforced at the boundary. The only backend guard is a fingerprint title+problem token match — that catches near-duplicate *titles* but cannot validate that a `duplicate-of:<id>` points at an id that exists, nor that `already-planned` corresponds to a real plan. A hallucinated `duplicate-of:idea-47` (no such id) would pass schema (it's a string) and silently drop or mis-merge a real idea.
- **Failure scenario:** Session, under a long expensive run, writes ideas.json but invents `duplicate-of:` ids or marks a novel idea `already-planned` citing a plan that doesn't exist; dedup merges/excludes it; the highest-leverage new idea never surfaces. Failure is silent (schema passes) and expensive (full run wasted on a wrong verdict). Or the session writes prose around the JSON / wrong path and ingest sees no file → run `failed`.
- **Evidence:** Phase 4 Architecture: "Backend trusts the verdict but guards with a fingerprint match (normalized title+problem tokens)" — no referential-integrity check on `dedupVerdict` ids. Phase 5 relies on prompt instruction for path+schema. Live probes show the model wraps JSON in ```json fences (`result` field contained "```json\n[…]\n```") even when asked for "ONLY a JSON array" — direct evidence the file-write contract needs defensive parsing, not trust.
- **Suggested fix:** Phase 4 ingest must (a) strip/extract JSON defensively (the model fences output — proven above); (b) validate every `duplicate-of:<id>` against actual stored ids and every `already-planned` against the real plan index, quarantining unverifiable verdicts as `new` + flag for human review rather than trusting; (c) assert the file exists at the exact path and fail loudly with the captured stdout if not. Add a fixture with a hallucinated id to the dedup test.

---

## Summary of verified facts (evidence ledger)

| Claim in plan | Verdict | Evidence |
|---|---|---|
| Headless `claude -p` loads claude.ai MCP connectors | TRUE (de-risked) | live probe fetched Tesseract page `1609334800`, exit 0 |
| Atlassian + M365 connected | TRUE | `claude mcp list`: both `✓ Connected` |
| VNGGames data connectors (GDS/VDA/ADA) usable | FALSE | `claude mcp list`: all `! Needs authentication` |
| Confluence page 1609334800 = Tesseract Architecture v0.2 | TRUE | probe returned exact title |
| backend = Fastify + better-sqlite3 + zod | TRUE | `server/package.json:19,20,26` |
| frontend = Vite + React18 + recharts + vitest + RTL | TRUE | `package.json:62,75,105,106,85-87` |
| frontend "mirrors" mermaid | FALSE | no `mermaid` dep in any package.json |
| `claude` ≥2.1 / `ck` 4.4.0 | TRUE | `claude --version` 2.1.161; `ck` CLI 4.4.0 |
| `docs/codebase-summary.md` has parseable `##/###` headings | TRUE | `:1,:47,:104,:113` etc. |
| README has Surfaces + Routes | PARTIAL | `Surfaces:` inline bullets `:5`; `## Routes` table `:79` (two different shapes) |
| `plans/*/plan.md` have frontmatter (title/status) | FALSE for active | 3 of 6 active plans have NO frontmatter |
| `plans/complete/` plan.md frontmatter | MOSTLY TRUE | 44/49 |
| per-run cost is "meaningful but controlled" | UNDERSTATED | trivial probes cost $0.62–$1.02 each |

## Unresolved questions
1. Do the VNGGames data connectors (GDS/VDA) need to be authed for the "product/data-layer experience" category to have real signal, or is Confluence+Outlook+repo enough? If needed, there is no fallback spec'd.
2. What is the measured cost/latency of a *full* representative run (not a probe)? Required to set the Phase 3 timeout and a budget guard.
3. Final handoff target: `plans/` or `plans/reports/`? (Finding 7.)
4. Monorepo tooling for cross-package type sharing — npm workspaces vs copied .d.ts? (Finding 4.)
