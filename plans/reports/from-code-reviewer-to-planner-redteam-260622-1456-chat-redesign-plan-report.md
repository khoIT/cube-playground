# Red-Team: chat-main-layout-redesign plan vs codebase

Date 2026-06-22 · Reviewer code-reviewer · Read-only verification
Plan: `plans/260622-1446-chat-main-layout-redesign/`
Verdict: **plan is broadly sound but undercounts FE wire-points (P02) and rests on one broken FE assumption (#9) + one mischaracterised "5-min" task (#10 scope chip relocation). Cache-replay (#1) is the single biggest risk — verified, and it is bigger than the plan's one bullet.**

Severity legend: Blocker (will ship broken) / Major (rework or silent regression) / Minor (polish/doc).

---

## P02 — verdict, full-stack

### #1 Cache-hit re-emit — **MAJOR** (the single biggest risk; CONFIRMED bigger than stated)
**Claim:** "on a cache hit, re-emit stored `verdict_json` over SSE."
**What code shows:**
- Cache hit does NOT short-circuit to text — it fully replays over SSE via `replayCachedTurn` (`chat-service/src/cache/replay-cached-turn.ts:45-104`): emits `loading → token×N → query_artifact×N → chart×N → result`. So re-emitting verdict on the cache path is mechanically possible.
- BUT the cache **does not store structured side-channel fields at all**. `CachedValue = { text, toolCalls, artifacts?, charts? }` (`response-cache-store.ts:25-30`). `maybeWriteResponseCache` only writes `{text, toolCalls:[], artifacts, charts}` (`response-cache-write.ts:77-82`). Proposals and disambig are **never cached** (disambig turns are explicitly skipped — `response-cache-write.ts:69`).
- Therefore "re-emit the stored verdict" requires a **schema change to the cache value**, not just a replay tweak. Concretely the plan must ALSO:
  1. add `verdict?: VerdictData` to `CachedValue` (`response-cache-store.ts`),
  2. capture+pass `collectedVerdict` into `maybeWriteResponseCache` and write it (`response-cache-write.ts`, `turn.ts:770-798`),
  3. emit it in `replayCachedTurn` (new event before `result`),
  4. persist it on the cache-hit turn row in `try-response-cache-hit.ts:92-117` (which today writes `assistantText/artifacts/charts` only — verdict would be dropped on the replayed turn's DB row otherwise, so a *reload of a replayed turn* loses the verdict even if SSE showed it).
- `verdict_json` is **not** read on the cache path today (nothing to read). So the plan's phrase "push a verdict event from `verdict_json`" is wrong about the source: on a fresh write the verdict lives in `CachedValue.verdict`, and `try-response-cache-hit.ts` must persist it onto the new turn row from `cachedValue.verdict`, not from a `verdict_json` column on the cache table (no such column).

**Impact:** if implemented as the one-line plan bullet implies, cache hits emit no verdict (silent) AND reloading a cache-hit turn shows no verdict even when the live replay did — an inconsistency users will notice ("it had a verdict, I refreshed, it's gone").
**Fix:** treat cache-verdict as a 4-file change (list above). Add a test: write a verdict turn → cache it → bypass=off replay → assert `verdict` SSE event AND persisted `verdict_json` on the replayed row. Cheaper alternative worth surfacing to user: **don't cache/replay verdict at all** — gate the verdict block to `cacheHit === false`. YAGNI-justified since a cache hit already shows text+charts; the verdict is derivable-looking. Recommend asking user which.

### #2 SSE client tolerates unknown event types — **CONFIRMED SAFE (no action)**
- Parser passes any event through: `parseSseFromResponse` does `yield { type: block.event, data: parsed }` with no allow-list (`src/api/chat-sse-client.ts:399`).
- Reducer `applySseEvent` is a `switch` with **no `default:` throw**; falls through to `return entry` (`src/stores/chat-stream-store-actions.ts:120-299`). An unknown `verdict` event is silently ignored by a stale FE. **Backwards-compatible.** Plan's risk #3 ("SSE contract drift") is already mitigated by the architecture.

### #3 Structured-field precedent — **MAJOR: precedent is `proposals` (a section) but verdict is a top-level block; the chain diverges**
**Claim:** "mirror `propose_segment`/`disambig` exactly (emit→capture→persist→load)."
**What code shows — the BE chain matches; the FE chain does NOT:**
- BE proposals chain verified end to end: emit via `ctx.sseEmitter.emit('segment_proposal', …)` → captured `collectedProposals` (`turn.ts:431-434`) → `appendTurn` serializes `proposals_json` (`chat-store.ts:360,384`) → `rowToTurn` deserializes assistant-only (`sessions.ts:84-87`). `disambig_json` identical (`turn.ts:439-444`, `chat-store.ts:398`, `sessions.ts:80-83`). A `verdict_json` mirrors this **on the BE 1:1** — low risk.
- **FE divergence (the gap):** proposals/disambig render as **sections inside `bodyUnits`** (`sessionTurnsToMessages` pushes `{type:'segment_proposal'}` — `chat-thread-page.tsx:86-88`; `buildStreamingSections` pushes them — `:233`). The verdict must render **ABOVE `bodyUnits`** (plan, phase-02:71), so it is **not** a section — it must be a new top-level field on `ChatMessage`/`StreamEntry`. That means the verdict does NOT reuse the section plumbing and needs its own wire at **every** FE stage the plan's bullet ("SSE client type + persisted mapping + verdict block") **undercounts**:
  1. `applySseEvent` — new `case 'verdict'` storing `entry.currentVerdict` (`chat-stream-store-actions.ts`).
  2. `StreamEntry` type + `clearStreamBuffers` reset (`:303+`) — else verdict bleeds into the next turn.
  3. `buildStreamingSections` is sections-only — verdict needs a sibling field on the live `__streaming__` `ChatMessage` (`chat-thread-page.tsx:241-248`).
  4. committed-message construction (`chat-thread-page.tsx:266-277`) — carry verdict across the done/aborted commit.
  5. persisted mapping — `TurnDto.verdict` (`sessions.ts:30-51`) + `rowToTurn` (`:62-89`) + `sessionTurnsToMessages` map to a `ChatMessage.verdict` field (`chat-thread-page.tsx:57-88`).
  6. `AssistantMessage` prop + render block (`assistant-message.tsx`).

**Impact:** plan lists ~3 FE files; real surface is ~6 wire-points across 3 files. If any of 1–4 is skipped, live verdict either never shows, shows then vanishes on commit, or persists into the next turn.
**Fix:** expand phase-02 FE step to enumerate the 6 points. Ordering nuance the plan also omits: proposals render AFTER charts (action cards); verdict renders FIRST/above — confirm the verdict field is read in BOTH the live (`:241`) and committed (`:266`) `ChatMessage` builds.

### #4 Migration safety — **CONFIRMED SAFE**
- `addColumnIfMissing` exists, swallows only `duplicate column name`, rethrows else (`migrate.ts:22-30`). `disambig_json` added the same way (`:91`) — exact precedent; idempotent.
- `rowToTurn` uses `safeParseJson(row.x_json, null/[])` (`sessions.ts:53-60,80-87`) — old rows / null columns hydrate to null → renderer hides block. **No NOT NULL, no default-value trap.** Add `verdict_json TEXT;` (nullable, no default) and the plan's "no backfill" claim holds.

### #5 Live streaming order — **CONFIRMED FEASIBLE, with a model-behaviour caveat (Minor)**
- Tool `tool_use` blocks map to `tool_call` SSE events as the SDK yields them mid-stream (`sse-stream.ts:105`), and `emit_verdict` would fire via `ctx.sseEmitter` exactly like `emit_query_artifact` (`emit-query-artifact.ts:258`) — so a verdict event CAN arrive before the final `result`. No layout jank if verdict is a top-level field (not a reordered section), so the body's text-before-artifacts order (`buildStreamingSections:216-234`) is untouched.
- **Caveat:** "stream in early" depends on the *model* calling `emit_verdict` first. The agent typically explores (many tool calls) before it can state a takeaway, so in practice the verdict likely emits LATE (near `result`), not early. The "renders before body text arrives" success criterion is aspirational, not guaranteed by the wire. Don't write a test that asserts verdict-before-first-token; assert verdict-present-by-done.

### #6 emit_verdict tool registration — **CONFIRMED contained, but plan UNDERCOUNTS files**
Registering a tool touches **4 places**, not the 2 the plan implies:
1. new `tools/emit-verdict.ts` exporting `{ name, description, inputSchema, handler }` (shape per `emit-query-artifact.ts:32-56`).
2. import + push into `REGISTRY` array (`tools/registry.ts:10-32, 49-204`) — manual, easy to forget; `TOOL_NAMES` derives from it (`:233`).
3. add `emit_verdict` to `allowed_tools:` in **every** analytical SKILL.md (`explore/diagnose/advise/compare`, and consider `segment`/`metric_explain`). The runner filters tools to `allowedToolNames` (`claude-runner.ts:172-175`); a skill missing the entry **cannot call the tool** — silent capability loss.
4. **boot-guard is bidirectional and will CRASH the service** if a SKILL.md lists `emit_verdict` before the registry has it — `validateSkillRegistry` throws `SkillRegistryMismatchError` at boot (`registry-boot-guard.ts:64-73`). So steps 2 and 3 must land together; sequencing matters (register tool first, or same commit).

**Impact:** miss #3 → verdict never emits on that skill (no error). Do #3 before #2 → boot crash.
**Fix:** phase-02 step "tool + register" must spell out all 4; land registry + SKILL edits atomically.

---

## P01 — frontend

### #7 Chart-run grouping feasibility — **MAJOR (the adjacency premise is largely wrong)**
**Claim:** "group adjacent `chart` units in `bodyUnits` into a 2-col grid."
**What code shows:**
- Charts reach the body via **two** section types: `query_artifact` (chart embedded INSIDE `QueryArtifactCard`, the common path — `emit-query-artifact.ts` attaches `chart` inline; `SectionRenderer` case `query_artifact` → `QueryArtifactCard` — `assistant-message.tsx:800-801`) and standalone `chart` (`AssistantChartSection` — `:803-804`). `buildStreamingSections` confirms most charts are embedded on artifacts and standalone charts are de-duped out (`chat-thread-page.tsx:222-231`).
- So "adjacent chart units" are mostly **`query_artifact` sections**, each a full card carrying summary + chart + **refine row + Open-in-Playground footer** (refine lives inside `QueryArtifactCard`, `query-artifact-card.tsx:184,200`). Grouping two cards into a 2-col grid puts a full refine/Playground footer inside each ~half-width cell — exactly the per-card chrome the plan's fix-4 is trying to quiet, now squeezed into 450px.
- There IS an existing grouping abstraction to extend: `groupToolCallRuns` (`assistant-message.tsx:660,721-733`) collapses consecutive `tool_call`s. The plan can add a parallel `groupChartRuns` that buckets consecutive `query_artifact`+`chart` sections — but it must decide whether a 2-col artifact card is even legible (summary text + chart + refine in half width).

**Impact:** grouping `chart`-type sections only (as literally written) will rarely fire, because charts are usually embedded in artifacts. Grouping artifact cards instead breaks the refine/footer layout fix-4 is solving. The two P01 fixes (3a grid + 4 refine-collapse) are coupled, not independent.
**Fix:** redefine "chart unit" to include `query_artifact` sections; collapse the refine row to a single affordance (fix-4) FIRST so a half-width card is viable; only then grid. Or: grid only standalone `chart` sections and leave artifact cards full-width (simpler, honest, but rarely triggers). Surface this coupling to user.

### #8 Y-axis autoscale per-type — **CONFIRMED FEASIBLE**
- `renderChartBody` switches on `spec.type` (`assistant-chart-section.tsx:337`): bar(338)/h-bar(351)/stacked(377)/grouped(397) vs line(410)/multi-line(486)/area(508)/dual-axis(455) are cleanly separable at the YAxis. Apply `domain` to the latter only.
- Dual-axis separable: left axis `yAxisId="left"` (`:458`), right axis (`:459`) — autoscale the line axis independently. Scatter precedent `domain={['auto','auto']}` (`:613,627`) confirmed.
- **Real risk the plan's risk section half-notes:** a **multi-line** chart where one series sits near zero and another high — a non-zero `[dataMin,dataMax]` domain computed across ALL series compresses the low series to a flat line and visually exaggerates the high series' volatility. `['auto','auto']` (recharts per-chart, not per-series) has the same effect. This is a genuine "autoscale misleads" case. Guard: only autoscale single-series line/area; for multi-line keep `['auto','auto']` but document it can mislead, or floor at 0 when min/max ratio is extreme. Also handle min==max degenerate (plan already flags).

### #9 compact/embedded forces 1-col — **BLOCKER (assumption is FALSE as written)**
**Claim:** "rely on `compact`/`embedded` to force single-column in the side panel."
**What code shows:**
- `AssistantMessage` receives `compact?` (`assistant-message.tsx:467,514`) and threads it to padding/indent — good, the flag IS available at the grouping site.
- BUT the chart renderers do **not** receive it: `SectionRenderer` renders `<AssistantChartSection artifact={section.artifact} />` with **no `embedded`/`compact` prop** (`:804`). `embedded` is only passed by `QueryArtifactCard` (`query-artifact-card.tsx:184`) for the card's OWN internal layout — it is a different concern from a bodyUnits-level grid.
- So "force 1-col via embedded" conflates two things. The grid the plan adds lives at the `bodyUnits` map (`:660`), where only `compact` exists. The fix is real but the mechanism named in the plan (`embedded`) is wrong; the correct lever is `compact` (already in scope), gated at the new grouping wrapper.

**Impact:** if implemented per the plan's wording (key off `embedded`), the panel grid guard silently no-ops because the body chart path never sees `embedded`. 2-col grid then renders in the ~360px panel → unreadable. This is the explicit "panel width" risk the plan lists, and the named mitigation doesn't wire up.
**Fix:** gate the grid wrapper on `compact` (and a container/width query), NOT on `embedded`. Verify `chat-panel.tsx:206` passes `compact=true` down to `AssistantMessage` (plan key-insight asserts it — verify during impl).

### #10 Scope chip + chrome — **LOCATED (de-risks the "5-min scout"); but relocation is bigger than framed (Major)**
- **Scope chip** = `src/pages/Chat/components/chat-header-focus-chip.tsx` (`ChatHeaderFocusChip`), the Brain chip showing the session's pinned metric/dim/timeRange focus slots (`chat-header-focus-chip.tsx:1-11`), rendered in the thread HEADER (`chat-thread-page.tsx:43`). The mockup's "etl_money_flow.total_in · money_type · last 10 days" = exactly these three focus slots.
- **Composer toggles** = `src/pages/Chat/components/chat-composer.tsx` + `composer-tool-toggle.tsx` (`ComposerToolToggle`: Web Search / DeepThink / Bypass cache — `chat-composer.tsx:8,139-142`).
- **Header pills** = `ChatModeChip` (`chat-thread-page.tsx:41`), `ChatShareButton` (`:44`), Debug — all in chat-thread-page header.
- **Catch:** the focus chip is **session-scoped state** (one chip per thread, driven by `useSessionFocus(sessionId)`), not turn-scoped. Plan fix-5 wants it "under the user question / inside the query-card header" — i.e. **per-turn**. Moving session-scoped focus into a per-turn position is a data-model relocation, not a CSS move. Either (a) keep it in header but restyle as a pill (low-risk, satisfies "not floating centered"), or (b) genuinely re-derive a per-turn scope badge from the turn's artifact query (new derivation). The plan's "move it under the question" implies (b) but budgets it as a 5-min scout. **Re-scope or pick (a).**

---

## Cross-cutting

### Sequencing / merge conflict P01↔P02 on assistant-message.tsx — **MAJOR if parallel**
Both phases edit `assistant-message.tsx` (812 lines) in the **same region**:
- P01 fix-3a wraps the `bodyUnits` map (`:659-670`) in grid grouping.
- P02 inserts the verdict block immediately **above** `bodyUnits` (plan says "before line ~659").
These are adjacent (within ~10 lines). Done in parallel → near-certain conflict at the body-render block, plus both touch `SectionRenderer`/props. Plan says phases are "independent — order flexible"; on this file they are **not** independent.
**Fix:** serialize the two edits to `assistant-message.tsx`, or pre-carve the insertion: land P02's verdict block first (it's an additive sibling above the map), then P01 wraps the map. One owner for this file across both phases.

### "Out of scope / YAGNI" that may be load-bearing
- **Cache verdict (see #1):** plan treats replay as one bullet; it's a cache-schema change OR a deliberate "no verdict on cache hits" decision. Not YAGNI either way — pick explicitly.
- **Verdict gating on clarification turns:** decision says "emit on ANY data-backed answer; renderer hides when null" + prompt ban on clarify turns. Relies entirely on prompt obedience (model may over-emit). No server-side guard. Acceptable for a playground, but the live-eval (step 7) is the ONLY backstop — keep it in scope, don't cut it.

### Hard-to-write tests
- **Live verdict-before-body SSE ordering** (#5): can't deterministically assert (model controls call order). Assert verdict-present-by-`done`, not ordering.
- **Cache replay verdict round-trip** (#1): needs a seeded cache row with the new `CachedValue.verdict` field + a refresh-hook stub; doable but touches `replay-cached-turn` test + `try-response-cache-hit` persist assertion.
- **2-col→1-col panel collapse** (#9): jsdom has no layout; container-query/width branch can't be exercised by width — must be prop-driven (`compact`) to be testable. Another reason to gate on `compact` not a CSS container query alone.

---

## Single biggest risk
**#1 cache-hit verdict.** Verified: the response cache stores only `{text, toolCalls, artifacts, charts}` — it has no concept of structured side-channel fields, and disambig/proposals are deliberately never cached. "Re-emit the stored verdict" is therefore a 4-file cache-schema change (CachedValue, write-gate, replay emit, cache-hit row persist), not the one-line replay tweak the plan implies. If shipped as written, cache hits silently drop the verdict and reloading a replayed turn loses it even after the live replay showed it. Decide up front: extend the cache value, or gate verdict to `cacheHit===false`.

## Unresolved questions
1. Cache verdict: extend `CachedValue` (full parity) or skip verdict on cache hits (YAGNI)? — needs user call (affects #1 scope).
2. Fix-5 scope chip: restyle in-header (low-risk) or re-derive a per-turn scope badge from the artifact query (new derivation)? Plan budgets the latter as 5 min — confirm intent.
3. Multi-line autoscale (#8): floor-at-0 heuristic vs single-series-only autoscale — which does the user prefer given the mislead risk?
4. Do P01 and P02 land in one branch (recommended for assistant-message.tsx) or two? If two, who owns the shared file?
