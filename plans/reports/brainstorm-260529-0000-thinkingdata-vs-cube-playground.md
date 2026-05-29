# Brainstorm: ThinkingData (Agentic Engine v6.0) vs. cube-playground

**Date:** 2026-05-29 · **Source notes:** `plans/reports/Thinking Data/Agentic Engine Architecture.md` · **Status:** Draft — feeds back into claude-in-chrome research queue

---

## Part 1 — Cohesive Brief on ThinkingData Agentic Engine

### 1.1 What it is (one paragraph)

ThinkingData's Agentic Engine (AE) is a **closed-loop player-intelligence and activation platform** for live games. Raw SDK/server events flow into a governed schema → an analytics model catalog turns events into insight → those insights become reusable user labels (Tags) and groups (Cohorts) → Cohorts power activation surfaces (push, in-app, journey, remote config) → activation outcomes feed back into analytics. Five top-level modules: **Analytics**, **Users**, **Engage**, **Config Center**, **Data (DataOps)**.

### 1.2 The closed-loop architecture

```
Data (Events / Tracking Plan / Real-time / Debugger)
   ↓
Analytics (9 models + SQL IDE + Dashboard + Leaderboard + Heatmap)
   ↓
Users (Tags ← analytics + raw)  →  Cohorts (rule-based or result-saved)
   ↓
Engage (Tasks · Journey · Campaigns · Workspace)
   ↓
Config Center (live remote config delivery)
   ↓
Effect Analysis → feeds Analytics again
```

Tags + Cohorts are the **pivot**: Analytics outputs flow into them; Engage and Config Center consume them.

### 1.3 Module 1 — Analytics (the 9 + 3 model catalog)

| # | Model | Question it answers | Key visual |
|---|---|---|---|
| 1 | **Events** | "How many / how much across time?" multi-metric + formula (A/B, A+B) | Trend / bar / pie / cumulative |
| 2 | **Retention** | "Of users who did X, what % came back Day N?" with cohorts + LTV-as-secondary-metric + Hold Property Constant | Heatmap + Day-N line |
| 3 | **Funnel** | "Ordered N-step conversion + drop-off" up to 30 steps, conversion window, Hold Property Constant | Conversion bar + trend |
| 4 | **Retention by Interval** | "How long between event A and event B?" with numeric-property-increases-by-N rule | Box-plot + histogram |
| 5 | **Distribution** | "Bucket users by aggregated event/property" (spend tier, login-days) | Range bucket bar + Also-Show metric |
| 6 | **Flows / Path (Sankey)** | "What sequences do users actually follow?" forward-from or backward-from a chosen anchor event | Sankey, ≤10 steps |
| 7 | **Composition** | "What does the user base look like across properties/tags?" up to 10 user-group side-by-side | Bar / pie / stacked / cross-tab |
| 8 | **Attribution** | "Which touchpoint drove the conversion value?" First/Last/Linear, Same-Day or custom window | Per-touchpoint table |
| 9 | **Leaderboard** | "Rank users by metric" with VS-comparison | Ranked user list |
| 10 | **Heatmap (spatial)** | "Where on the map do events cluster?" X/Y property + uploaded map background | Density overlay |
| 11 | **SQL IDE** | Ad-hoc SQL against 5 system tables (`ta.v_event_12`, `ta.v_user_12`, `ta.user_result_cluster_12`, `ta.history_tag_12`, `ta.user_day_serial_12`) | Result set + chart |
| 12 | **Dashboard** | Pinned reports + folder spaces (My / Team / Shared) | Multi-panel auto-refresh |

**Cross-cutting analytics primitives:**
- Entity = User / Device / Role / custom
- Granularity = hourly / daily / weekly / monthly / total
- "Hold Property Constant" — same property value across multi-event analyses (powerful)
- "Calculate another metric" / "Also Show" — secondary metric per cell or bucket
- Drill-down → User List → save as **Result Cohort** (the bridge into Users module)

### 1.4 Module 2 — Users (segmentation pivot)

| Primitive | What | How defined |
|---|---|---|
| **Tag** | Persistent per-user label updated on schedule | 5 types: ID-import · Behavioral (event rule) · First/Last (capture at occurrence) · Metric-Value (aggregate over window) · SQL |
| **Cohort** | A user group (saved filter) | Rule-based (live conditions) **or** Result-cohort (saved from any analytics drill-down) |
| **User Look-Up** | Single-user inspector | Filter by property → click into per-user properties + tags + event timeline |

Tags are the **vocabulary of player identity**. Cohorts are the **target unit** the rest of the platform reads.

### 1.5 Module 3 — Engage (activation)

| Surface | Trigger | Channels |
|---|---|---|
| **Operation Task** | Timed (cron) · Triggered (server event) · Client-Triggered (SDK on-device condition) | Webhook · JPush · FCM · APNs · in-app SDK |
| **Journey** | Visual drag-drop flow (branch / delay / push / exit) seeded by cohort entry, event entry, or schedule | Same channels, sequenced |
| **Campaign** | Container grouping multiple tasks under one theme | Aggregated effect reporting |
| **Engage Workspace** | Global ops dashboard — daily task count, push CTR, calendar Gantt | Auto-aggregated |

Every Engage object specifies: **Audience** (cohort) · **Timing** · **Channel** · **Content template** · **Conversion goal event** (closes loop back to Analytics) · optional A/B + whitelist + localization + delivery cap.

### 1.6 Module 4 — Config Center

Remote-config delivery without app re-release. Hierarchy: **Config Item** (game module) → **Config Template** (parameter set) → **Config Parameter** (reusable variable) → **Config Strategy** (active combo deployed to a cohort/condition). Delivered via webhook poll or SDK pull. Strategy Data Analysis closes the loop.

### 1.7 Module 5 — Data (DataOps governance)

- **Events & Properties Management** — registry; 171 events in VNG instance; columns include volume yesterday, real-time availability, data status.
- **Tracking Plan + Validation** — declared contract vs. live data; type/range checks fire alerts.
- **Real-Time Data Monitor** — last 1,000 records, with separate "data with error" view.
- **Debugger** — per-device event stream for QA before patch release.
- **Product Metrics & Currency** — canonical KPI formulas (ARPU etc.) + virtual-currency → real-money mapping reused across every model.

### 1.8 The single most important insight

Three concepts hold the whole platform together:
1. **Hold Property Constant** in multi-event models — keeps multi-step analyses semantically clean (same product_id across funnel steps; same episode in retention).
2. **Result Cohort** — every analysis drill-down can be saved as a targetable user group with one click. This is what closes data→action.
3. **Conversion Goal Event** on every Engage object — every action is evaluated against a measurable downstream event. This is what closes action→data.

---

## Part 2 — Side-by-Side: ThinkingData vs. cube-playground

Cube-playground modules surveyed: `Chat`, `Build/Explore` (QueryBuilder), `Catalog` (Data Model · Glossary · Concept Detail · CDP projection · Digest · Metric Card), `Segments` (Editor · Predicate Builder · Funnel Builder · Identity Map · Library · Presets · Push Modal), `Dashboards`, `Liveops` (KPI hero · Cohort retention grid · Anomaly inbox), `DevAudit` (chat audit · cache dashboard), `Settings` (Identity map · Coverage matrix · Game visibility · Chat preferences · Nav visibility), `Data Model Wizard`.

### 2.1 Coverage matrix

| ThinkingData feature | cube-playground equivalent | Coverage |
|---|---|---|
| **Analytics — Events** | `/build` QueryBuilder | 🟡 partial — single-cube; no multi-metric formula (A/B, A+B); no comparison (this vs last); no preset KPI library beyond Liveops |
| **Analytics — Retention** | `/liveops/cohort` | 🟡 partial — has Day-N retention grid; missing Hold-Property-Constant, secondary-metric (LTV), churn-mirror view |
| **Analytics — Funnel** | `/segments/funnel-builder` | 🟡 partial — exists; need to verify step cap, conversion window, group-by, drill-to-user-list, hold-property-constant |
| **Analytics — Retention by Interval** | — | 🔴 **missing** — no box-plot / time-to-event |
| **Analytics — Distribution** | — | 🔴 **missing** — no range-bucket histogram with Also-Show |
| **Analytics — Flows / Sankey** | — | 🔴 **missing** — no path discovery |
| **Analytics — Composition** | Catalog `metric-card-how-to-slice` (single-axis) | 🟡 partial — slice viewer exists; no multi-group side-by-side or up-to-10 user-group comparison |
| **Analytics — Attribution** | — | 🔴 **missing** |
| **Analytics — Leaderboard** | — | 🔴 **missing** |
| **Analytics — Heatmap (spatial)** | — | 🔴 **missing** (niche for non-spatial games) |
| **Analytics — SQL IDE** | `/build` shows compiled SQL **read-only** | 🟡 partial — no editor/execute |
| **Analytics — Dashboard** | `/dashboards` + `/dashboards/:slug` | 🟢 match — pin-to-dashboard, tile viz renderers; folder/spaces (My/Team/Shared) likely missing |
| **Users — Tags** | — | 🔴 **missing** — no first-class Tag primitive; only Segments-as-cohort |
| **Users — Cohorts** | `/segments` + `/liveops/cohort` | 🟡 partial — rule-based cohorts present; Result-Cohort save-from-analytics flow unclear |
| **Users — User Look-Up** | — | 🔴 **missing** — no per-user inspector with property + tag + event timeline |
| **Engage — Operation Tasks** | `Segments/push-modal` | 🟡 partial — push modal exists; need to verify whether it's a real push or just metadata/export |
| **Engage — Journey** | — | 🔴 **missing** — no visual flow builder |
| **Engage — Campaigns** | — | 🔴 **missing** — no campaign container |
| **Engage — Workspace** | `/liveops` (KPI hero + anomalies) | 🟡 partial — health overview exists but not push-calendar / campaign-pipeline focused |
| **Config Center (live remote config)** | — | 🔴 **missing** (likely out-of-scope) |
| **Data — Events & Properties Management** | `/catalog/data-model` | 🟡 partial — read-only from Cube meta; no raw event-volume / data-status / connection-status |
| **Data — Tracking Plan & Validation** | — | 🔴 **missing** — no declared-contract layer |
| **Data — Real-Time Data Monitor** | `/dev/chat-audit` cache dashboard | 🟡 different domain — observes chat traffic, not SDK events |
| **Data — Debugger** | `/dev/chat-audit` session detail | 🟡 different — debugs chat sessions, not device-level SDK events |
| **Data — Product Metrics & Currency** | `/catalog/glossary` + `/settings` coverage matrix | 🟡 partial — glossary owns metric definitions; no currency-conversion concept (real-money) |

### 2.2 What cube-playground has that ThinkingData does NOT (visibly)

| cube-playground module | Why it's interesting |
|---|---|
| **Chat** (`/chat`) | Conversational analytics with Claude-driven exploration — ThinkingData is point-and-click only; no LLM agent |
| **Catalog: Glossary + Concept Detail + CDP projection** | Curated semantic vocabulary on top of Cube meta — ThinkingData has Product Metrics but not a layered concept/glossary/projection model |
| **Catalog: Digest (subscriptions)** | Periodic curated reports — not visible in ThinkingData notes |
| **Liveops: Anomaly Inbox** | Active anomaly detection feed — ThinkingData has trend charts but no anomaly inbox in notes |
| **DevAudit (cache + chat audit)** | Internal observability surface for the analytics agent itself |
| **Settings: Metric Coverage Matrix** | Metric ↔ cube coverage tooling — explicit gap-finding for the semantic layer |
| **Data Model Wizard** (`/data-model/new`) | Scaffold new cubes/measures — ThinkingData assumes events already exist; cube-playground assists schema authoring |
| **Segments: Identity Map** | Cross-system entity reconciliation — ThinkingData has Entity type but no UI for identity stitching |

### 2.3 Strategic interpretation

cube-playground today = **insight discovery + semantic-layer curation, agent-led**, anchored by Chat → Catalog → Segments → Liveops. ThinkingData = **packaged closed-loop ops platform with activation built in**, anchored by 9 fixed analytics models → Tags/Cohorts → Engage/Config.

Two qualitative differences:
1. **Activation half is the whole right side of ThinkingData; entirely absent in cube-playground.** Engage (Tasks/Journey/Campaigns) + Config Center together are a fully separate product surface. If cube-playground is meant to stay analytics-only, this is by design; if it ever wants to "close the loop", these are the missing halves.
2. **cube-playground's chat-first stance is a fundamental UX bet ThinkingData hasn't made.** ThinkingData users learn 9 model UIs; cube-playground users ask questions. Both have semantic primitives behind them, but the agent surface is the differentiator.

### 2.4 Highest-leverage gaps to potentially close (preliminary, no decision)

| Priority guess | Gap | Why it might matter |
|---|---|---|
| 🔥 high | **Result Cohort** (save-from-analytics drill-down) | Single mechanism that bridges every analytics view into Segments — minimal new surface, large reuse |
| 🔥 high | **Hold Property Constant** in funnel + retention | Unlocks correct multi-event semantics (same product across steps) without redesign |
| 🔥 high | **Tags** as a first-class primitive distinct from Cohort | Persistent labels reused across analytics + segmentation — currently we have only Cohorts |
| 🟠 medium | **Flows / Sankey** | Closes a clear analytical gap; pairs well with Chat (LLM can suggest journey questions) |
| 🟠 medium | **Distribution** + **Retention-by-Interval** | Two small models, easy to add given Cube engine |
| 🟠 medium | **User Look-Up** (single-user inspector) | Lightweight; uses existing Cube meta + segment membership |
| 🟢 low | **SQL IDE** | Useful for power users; cube-playground already shows compiled SQL — extension only |
| 🟢 low | **Tracking Plan + Validation** | Useful if cube-playground starts owning ingestion-side schema (not today) |
| ⬜ deferred | **Engage / Journey / Campaigns / Config Center** | Adjacent product surface; probably belongs elsewhere unless scope expands |

---

## Part 3 — Questions to send back to claude-in-chrome

Group A — **Analytics model specifics** (verify our understanding before scoping any port):

1. In **Events Analysis**, what's the full operator set in the formula field (A+B, A/B confirmed — division-by-zero handling? cross-event property arithmetic?)
2. In **Retention**, exactly what does "Hold Property Constant" allow — single property only, multi-property AND, ranges, or arbitrary expression?
3. In **Funnel**, screenshot the conversion-window picker — is it per-step or global only? What's the max steps cap actually shown in UI (notes say "up to 30")?
4. In **Funnel**, how is "Step-level drill-down to User List" surfaced — right-click? hover button? side panel? And does it offer "save as Result Cohort" from there?
5. In **Retention-by-Interval**, how is the "numeric property difference (episode +1)" condition expressed in the UI — dropdown? expression?
6. In **Flows**, where is the "session interval" set (1 sec to 24 hr) — is it per analysis or per project?
7. In **Composition**, how are the "up to 10 user groups" defined — as cohorts? ad-hoc filters? A mix? Side-by-side rendering as bar groups or small-multiples?
8. In **Attribution**, are the three models (First/Last/Linear) selectable per analysis only, or is there a project-default? Any custom decay/positional model?
9. In **Leaderboard**, what is the **"att" entity** that appears in the example — is it a generic attribute container or VNG-specific?
10. In **Heatmap**, is the map file a real game-engine asset or a static image? Coordinate space mapping logic?

Group B — **Tags vs. Cohorts mechanics** (most strategic for us):

11. Screenshot the Tag-create UI for each of the 5 tag types — especially "First/Last Tag" capture semantics and "Metric Value Tag" time-window picker.
12. What's the tag update cadence in practice — fixed schedule, on-event, or both? Cost/latency hints?
13. Is "Result Cohort" really one-click from every analytics drill-down, or does it require choosing a filter first? Screenshot the flow from a Funnel step → save cohort.
14. Can a Cohort reference another Cohort (composition)? Can a Tag reference a Cohort?
15. What happens to a Cohort when the underlying Tag definition changes — recompute, snapshot, or break?
16. How are Cohort sizes shown — live count, last computed count, both? Any "stale cohort" warning?
17. User Look-Up: what's in the "behavioral timeline" view — raw events, sessionized, or both? Filterable?

Group C — **Engage activation** (decide scope-in vs. scope-out):

18. For **Operation Tasks**, is the "Webhook channel" effectively a server-side notification to the game backend (we publish, they consume) — or does ThinkingData itself send to APNs/FCM directly?
19. Screenshot the **Journey builder** canvas — node types, branch logic UI, how delays/timers are configured, version control affordance.
20. Are A/B tests at task-level only, or can they be at Journey-node-level?
21. What's the relationship between **Campaign** and **Journey** — can a Journey live inside a Campaign? Or are they parallel containers?
22. **Engage Workspace** Gantt — does it show conflicts (same-cohort, overlapping send-windows) automatically?

Group D — **Config Center scope check**:

23. Is Config Center used by the game client at runtime, or only by ops staff at config-time? What's the typical delivery latency from "publish strategy" to "client sees new value"?
24. Are Config A/B tests measured against the same Conversion Goal event mechanism Engage uses, or a separate system?

Group E — **Data governance**:

25. Tracking Plan: does violating data still get ingested (and flagged), or rejected? Screenshot the validation rule UI.
26. Real-Time Data Monitor: is "last 1,000 records" project-wide or per-event? Any filter-by-user/device?
27. Debugger: how is a "test device" registered? Is there a privacy boundary preventing prod data from showing in debugger views?
28. Product Metrics: are formulas stored as expressions or compiled queries? Can they reference Tags?
29. Currency conversion — is the rate static or pulled from a live FX feed? Multi-currency project support?

Group F — **Cross-cutting**:

30. Permissions model — who can create Tags vs. Cohorts vs. Tasks vs. Config Strategies? Approval workflows?
31. Audit log — is there a per-object change history (especially for Tags and Config Strategies)?
32. Multi-project / multi-game support — is "VNG Games instance" one project per game or one project shared? Cross-project analysis possible?

---

## Open questions (about this brainstorm itself, not ThinkingData)

- Is the **Activation half** (Engage / Config / Journey) genuinely out-of-scope for cube-playground, or is it an "eventually" we should keep on a roadmap? Affects whether Result-Cohort + Tags should be designed with activation in mind.
- Does the **Settings → Coverage Matrix** already expose what `Catalog/glossary` doesn't, or is there duplication worth consolidating before adding more concepts?
- Should we treat ThinkingData as **a benchmark to match** or **a benchmark to deliberately differ from** (chat-first stance)? Determines whether the gap-closing list above gets ported as-is or reinterpreted.
