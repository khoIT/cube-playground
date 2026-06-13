# ThinkingData Deep-Dive — Q&A Summary + Cube-Playground Analysis

**Date:** 2026-05-29 · **Companion to:** `brainstorm-260529-0000-thinkingdata-vs-cube-playground.md` · **Source:** claude-in-chrome session inspection of `thinkingdata-web.vnggames.net` (project ID 12)

---

## Part 1 — Q&A Summary (32 answers, condensed)

Status legend: ✅ verified in live UI · 📖 from documentation only · ⚠️ feature not active in VNG instance

### Group A — Analytics Model Specifics

| # | Question | Verdict |
|---|---|---|
| A1 | Events formula operators | ✅ Calculator-only: `+ - * / ( )` + digits. No functions (no `%`, `^`, `abs`, `round`, `if`). Operands are pre-aggregated metrics, not raw properties. Division by zero → null/dash. No explicit cap on metric count. |
| A2 | Retention "Hold Property Constant" semantics | ✅ **Single property, equality only.** No multi-property AND, no ranges, no expressions. Same pattern reused in Funnel + Interval. |
| A3 | Funnel conversion window | ✅ **Global, not per-step.** Picker: Same day / Days (1, 7, 14, custom) / Hours (custom) / Minutes (custom). Range 1 min – 180 days. Default max 30 steps, raisable via CSM. |
| A4 | Funnel drill-down to user list | 📖 Click a cell → side panel with users → **one-click "Save as Result Cohort"** button. Same pattern across Funnel/Flows/Distribution. |
| A5 | Interval numeric-property-diff UI | ✅ Toggle ON → dropdown after ending event: `the same` (strings) or `greater by N` / `lower by N` (numerics, with offset input). |
| A6 | Flows session interval | ✅ **Per-analysis, not per-project.** Numeric input + unit dropdown (second/minute/hour, no day option). Range 1 sec – 24 hr. Persisted with saved report. |
| A7 | Composition user groups | ✅ "Group Comparison" mode lets you define **up to 10 ad-hoc filter groups inline** (not cohort-based). "All Users" exists as control group. Rendered as grouped bar / pie, not small-multiples. |
| A8 | Attribution models | ✅ Exactly 3: **First Click · Last Click · Linear**. Per-analysis only, no project default, no custom/decay/positional. |
| A9 | "att" entity in Leaderboard | ✅ **VNG-specific custom entity**, not generic. Entities are configured per-project (User/Device/Role/Guild/Server etc.). |
| A10 | Heatmap map file | ✅ **Static image upload** (no engine connection). X/Y axes mapped from numeric event/user properties. Multi-group layering supported. |

### Group B — Tags vs. Cohorts Mechanics

| # | Question | Verdict |
|---|---|---|
| B11 | Tag-create UI per type | ✅ 5 types confirmed: ID (CSV upload) · Behavioral (event rule) · First/Last (capture at occurrence) · Metric (aggregate over window) · SQL. Standard time-window picker (last-N-days / custom). |
| B12 | Tag update cadence | ✅ **Batch only — no on-event triggers.** Modes: Auto (daily scheduled) / Manual / Create+Edit triggers. ID tags are manual-only. |
| B13 | Result Cohort save flow | 📖 **Truly one-click from any drill-down panel.** Drill-down context = cohort definition automatically. Result Cohorts are **static snapshots** (do not recalculate). |
| B14 | Cohort↔Cohort, Tag↔Cohort references | ✅ Behavioral cohort has Have Done / Have Done In Sequence / Have Property. **Cohort cannot reference another cohort directly.** Tag cannot reference cohort. Cohort CAN filter by tag value via Have Property. Flat composition. |
| B15 | Cohort behavior when tag definition changes | 📖 No auto-cascade. Documentation warns of "exceptional volatility." **"Update with Dependents" toggle** on cohort recomputes before next Engage push. Result Cohorts unaffected (snapshots). |
| B16 | Cohort size: live vs. last-computed | ✅ **Last-computed only**, with "Last updated" timestamp. **No stale warning badge** — user judges by date. |
| B17 | User Look-Up timeline | 📖 Raw event-level (not sessionized). Sessions are a Flows concept only. Filterable by user property + event. Drill-down to 1,000-user lists per tag value. |

### Group C — Engage Activation

| # | Question | Verdict |
|---|---|---|
| C18 | Webhook channel semantics | 📖 **Two distinct channels.** Webhook = ThinkingData → your backend (you decide downstream). Push (JPush/FCM/APNs) = ThinkingData → device directly. Client channel = SDK polls in-app. |
| C19 | Journey builder | ⚠️ **Returns 404 in VNG instance — feature not enabled.** Per docs: Entry / Action / Branch / Delay / Exit nodes; condition + % A/B splits; version control on publish. |
| C20 | A/B test scope | 📖 **Task-level only** in accessible UI. Journey branching uses conditions; % A/B may exist there but unverified. |
| C21 | Campaign vs. Journey relationship | 📖 **Parallel sibling containers.** No nesting. User can be in both simultaneously; Delivery Caps prevent over-messaging. |
| C22 | Engage Workspace Gantt | 📖 **Visibility only, no auto conflict detection.** Fatigue prevented via separate Delivery Caps engine. |

### Group D — Config Center

| # | Question | Verdict |
|---|---|---|
| D23 | Config delivery model | ✅ **Both roles simultaneously.** Ops author strategies; client SDK pulls (configurable interval) OR game-server webhook receives push (near-instant). |
| D24 | Config A/B vs. Engage A/B | 📖 **Different systems.** Config uses Strategy Data Analysis + external Events Analysis to compare; no dedicated A/B test wizard like Engage Tasks have. |

### Group E — Data Governance

| # | Question | Verdict |
|---|---|---|
| E25 | Tracking Plan validation behavior | 📖 **Warn-and-pass** — violators still ingested, flagged in compliance report. Not configured in VNG instance. |
| E26 | Real-Time Data Monitor scope | ✅ **Project-wide**, last 1,000 records, search box, separate "data with error" tab. Download for bulk export. |
| E27 | Debugger test-device registration | 📖 SDK debug mode (`setDebugMode(DEBUG_ONLY)`) or `ta.identify("test_id")`. Privacy: no storage-layer isolation; test events tagged `#debug_mode=true`, filterable but co-mingled. |
| E28 | Product Metric storage | ✅ **A saved analysis bookmark**, not a free-form formula. References an Events or Retention analysis config — inherits filtering + tag-aware behavior. |
| E29 | Currency rates | ✅ **Static preset by default**, optional external FX integration (not configured in VNG). Multi-currency supported. |

### Group F — Cross-Cutting

| # | Question | Verdict |
|---|---|---|
| F30 | Permissions | 📖 4 roles: **Company Root · Admin · Analyst · Regular Member.** Tags/cohort matrix confirmed in docs. Engage tasks require **separate Approver role**. Creator cannot self-approve unless Root/Admin. |
| F31 | Audit log | ⚠️ **No formal per-object audit log in user-facing UI.** Tag detail shows last-updated + creator; task list shows status transitions; no full before/after history. Notable compliance gap. |
| F32 | Multi-project / multi-game | ✅ **One project per game**, fully isolated, project ID in every URL. No cross-project analytics. SQL IDE *might* allow it depending on cluster config. **Multiple entities per project supported** (User/Device/Role/Guild/Server). |

---

## Part 2 — What Changed in Our Understanding

These deep-dive answers materially change 7 conclusions from the earlier brainstorm:

| Original assumption | Revised understanding | Implication for us |
|---|---|---|
| Formula language is rich | **Calculator only — 4 ops + parens, no functions** | Trivial to match in our QueryBuilder. Re-frame as "metric arithmetic", not a DSL. |
| "Hold Property Constant" is powerful & flexible | **Single property, equality only** | Far cheaper to implement than I scoped. Add to funnel + retention with one property picker + equality check. |
| Conversion window might be per-step | **Global only** | Simpler funnel UI. One picker below the step list. |
| Tags update on schedule OR on events | **Batch only — no real-time / event triggers** | Closer to materialized user properties than reactive labels. Existing daily-Cube refresh cycle is compatible. |
| Cohorts compose hierarchically | **Flat — no cohort-references-cohort** | Simpler graph. Tag values reused via property filter is the only composition path. |
| Engage Workspace auto-detects send conflicts | **Visibility only; Delivery Caps separate** | If we ever build activation, Delivery Caps is the load-bearing piece — not the calendar. |
| Audit log exists | **No formal per-object change log** | Cube-playground could *outperform* ThinkingData here if compliance matters (git history of YAMLs already gives us this for free). |

Three things ThinkingData does that I now see as **architecturally clever**:

1. **Result Cohort as universal drill-down endpoint.** Every analytics surface ends in the same one-click action. This collapses N analytics → segmentation pathways into one UX primitive.
2. **Product Metric = saved analysis bookmark.** Not a new formula language — it reuses the existing analytics engine via a named pointer. Zero new compute path, full metric reuse.
3. **Tag as 5 fixed types, not free-form.** Forces clarity. ID / Behavioral / First-Last / Metric-Value / SQL covers ~95% of label use cases. Free-form SQL is the escape hatch.

---

## Part 3 — Updated Gap Matrix (with implementation complexity)

Re-scoring the gaps from the earlier brainstorm using what we just learned:

| Gap | Before (priority) | After (priority) | New cost estimate | Why changed |
|---|---|---|---|---|
| **Result Cohort save-from-drill-down** | 🔥 high | 🔥🔥 highest | ~1 sprint | Confirmed it's literally one button on a user-list panel. We have the drill-down + segments primitives. Glue is small. |
| **Hold Property Constant** in funnel/retention | 🔥 high | 🔥 high | ~3-5 days | Single-property equality — much simpler than scoped. One property picker + WHERE clause join. |
| **Tags as first-class** | 🔥 high | 🟠 medium | ~2 sprints | Now I see Tags = materialized labels, 5 fixed types. Doable but our Segments already overlaps. Decide before building: do we add Tags **alongside** Segments, or evolve Segments to host both rule-based and result-snapshot variants? |
| **Composition (multi-group side-by-side)** | 🟡 partial | 🔥 high | ~1 sprint | Their "Group Comparison" is ad-hoc filter sets, not cohorts — easier than thought. Pairs perfectly with chat ("compare A vs B vs C"). |
| **Flows / Sankey** | 🟠 medium | 🟠 medium | ~2 sprints | Unchanged. Still a meaningful gap. Session-interval-per-analysis confirms it's a self-contained widget. |
| **Distribution + Interval** | 🟠 medium | 🟠 medium | ~1 sprint each | Unchanged. Two small models. |
| **User Look-Up** | 🟠 medium | 🟠 medium | ~1 sprint | Raw event timeline + property panel. Cube can answer this with existing meta. |
| **Attribution** | 🔴 missing | 🟢 low | ~2 sprints | Only 3 fixed models (First/Last/Linear). Less than I feared. But low business signal vs other gaps for us. |
| **SQL IDE** | 🟢 low | 🟢 low | ~1 sprint | Unchanged. Already render compiled SQL — make it editable. |
| **Tracking Plan & Validation** | 🟢 low | 🟢 low | n/a | Validation is "warn-and-pass" — equivalent to lint+CI on our YAML model files. We already have this via git/PR review. |
| **Engage stack (Tasks/Journey/Campaigns)** | ⬜ deferred | ⬜ deferred | very large | **Reinforced: Journey is 404 even in VNG's own instance.** Strong signal to deprioritize activation entirely. |
| **Config Center** | ⬜ deferred | ⬜ deferred | very large | Distinct product surface; out of scope for analytics tool. |
| **Audit log** | n/a | 🟢 low (defensive) | small | **We can already beat ThinkingData here** via git history on cube YAMLs + chat-turn persistence. Surface it. |

### New short-list (top 5, ordered):

1. **Result Cohort save-from-drill-down** — keystone interaction; small surface; unlocks every other analytics→segmentation flow.
2. **Hold Property Constant** in funnel + retention — single-property equality; small change, large semantic gain.
3. **Composition / Group Comparison** — multi-group side-by-side with inline filters; pairs naturally with Chat ("compare A vs B").
4. **Flows / Sankey** — discrete model, valuable for journey discovery + churn-path analysis.
5. **Tags as first-class** *(only if we decide to)* — bigger architectural question than expected because it overlaps with Segments. Decision needed before scoping.

---

## Part 4 — New Questions That Emerged

These are second-order questions the deep-dive surfaced. Could go back to claude-in-chrome later, or resolve internally:

For ThinkingData (next claude-in-chrome session, if scoped):

- N1. When a Result Cohort is saved from a drill-down, can it be later **converted** to a rule-based cohort, or is it forever a snapshot?
- N2. Does the "Update with Dependents" toggle work transitively (tag → cohort → engage task), or only one hop?
- N3. In **Composition Group Comparison** mode, can a single "group" filter reference a cohort? Or only ad-hoc property filters?
- N4. What happens when a Behavioral Cohort condition references a **deleted** tag? Hard-error, silent skip, or zero-match?
- N5. Sankey/Flows performance — is the "10 step" limit a query-cost cap, a rendering cap, or both? Any sampling?
- N6. **Tag versioning** — when a Behavioral Tag definition changes, do historical tag values (via "Dates of Tag" / historical clock) reflect the old rule or the new rule?
- N7. SQL IDE — is the result truly arbitrary SQL or restricted (no joins to external schemas, no DDL, row limits)?
- N8. Are there published API endpoints to programmatically read cohorts/tags (for integration with our chat-service)?

For our own decision-making (internal, no need to ask ThinkingData):

- N9. Do we adopt the ThinkingData primitives' **names** (Tag, Cohort, Result Cohort) or invent our own? Consistency vs. team-fluency tradeoff.
- N10. Should `Segments` host both rule-based ("Behavioral Cohort") and snapshot ("Result Cohort") variants, or should we add a separate "Tags" surface?
- N11. Does cube-playground's **Glossary** already cover what ThinkingData's "Product Metrics" provides? If yes, do we need a separate metric registry?
- N12. Is the **Identity Map** in Segments already our equivalent of ThinkingData's "Entity" abstraction (User/Device/Role/Guild)?
- N13. If we add Result Cohort save-from-drill-down, what existing surfaces have the right drill-down hook? Funnel-builder, Liveops cohort grid, anomaly inbox, and Catalog metric-card all need an audit.

---

## Part 5 — Strategic Decisions To Surface

Three calls that should be made before any scoping work:

1. **Activation scope** — is cube-playground analytics-only, or does it eventually own the activation half (Engage/Journey)? Inferred answer from VNG's own instance: even ThinkingData treats Journey as optional. **Recommendation: hold the line as analytics-only.** Save the energy.

2. **Tags vs. Segments** — do we introduce Tag as a separate primitive, or generalize Segments to host both rule-based + result-snapshot? The deep-dive shows ThinkingData treats them as separate but tightly linked. **Recommendation: one new primitive at a time. Start with Result Cohort save-from-drill-down inside the existing Segments surface; only introduce Tags later if labels need to be reused outside Segments.**

3. **Match ThinkingData primitives or differentiate?** ThinkingData is point-and-click with 9 fixed models. Cube-playground is chat-first with a semantic-layer foundation. **Recommendation: borrow the load-bearing concepts (Result Cohort, Hold Property Constant, Group Comparison), reject the rigid 9-model catalog, and keep Chat + Catalog/Glossary as the differentiators.**

---

## Open Questions

- Is the Group A–F Q&A reference also useful to other folks (analytics/ops team), or just for this brainstorm thread? If shared, it may want to live as its own doc under `docs/` rather than `plans/reports/`.
- Should the top-5 short-list (Part 3) flow into a `/ck:plan` next, or wait until the Tags-vs-Segments call is made?
- Any of the 13 new questions (N1–N13) worth resolving before we plan, or are they all "decide during planning"?
