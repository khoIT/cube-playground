# Research: Demo Flows for Semantic-Layer Data Product

**Date:** 2026-05-22 11:45 ICT
**Scope:** Non-tech users (liveops / analyst / leadership) exploring data via Cube semantic layer → creating + activating segments.
**Question:** Are "playground-first" and "AI-agent-first" the only viable demo flows? What's missing?

---

## TL;DR

You're missing **3 flows** the SoTA treats as first-class, not nice-to-have. None require building from scratch on top of Cube — all map to capabilities your `playground`, `segments`, `push-modal`, `identity-map` modules already hint at.

| # | Flow | Primary user | Concrete value |
|---|---|---|---|
| 1 | Playground → Segment (you have it) | Analyst | Exploration, ad-hoc |
| 2 | AI Agent NL → Result (you have it) | Anyone | Speed, accessibility |
| **3** | **Metric Tree drill-down → "who caused this?" → Segment** | **Leadership / Liveops** | **Root-cause of a KPI move in <60s** |
| **4** | **Anomaly push → "act on this now" → Segment + Activation** | **Liveops / Ops** | **Catch drops before stand-up, retain users at risk** |
| **5** | **Segment → Activation (push to LiveOps / CRM / Notif)** | **Liveops** | **Closes the loop: insight → revenue / retention** |

Flow 5 is the *only* one with measurable ROI in days. Flows 1/2 sell exploration; flow 5 sells outcomes. **Lead the demo with 5.**

---

## Why "playground vs agent" is the wrong axis

Both 1 and 2 are *exploration* flows. Both stop at "I built a segment." For non-tech users that's where value is least obvious — the segment is an artifact, not an outcome. SoTA tools have moved past this:

- **ThoughtSpot Spotter/Sage** — agentic semantic layer, but the demo lead is *autonomous investigation*, not chat.
- **Mixpanel / Amplitude (2026)** — metric trees + cohort sync are now the headline feature, not the funnel.
- **Hightouch / Census** — entire product is "warehouse → tool"; segment building is the *means*.
- **Tableau Pulse / SpotIQ** — push-based anomaly digests, no user query required.

Translation: the axis is **pull (user-initiated) vs push (system-initiated)**, *and* **exploration vs action**. Your two flows live in one quadrant.

```
                  PULL (user asks)        PUSH (system tells)
EXPLORATION   |  1. Playground          |  (rare; "daily digest")
              |  2. AI Agent NL         |
--------------+-------------------------+-----------------------
ACTION        |  3. Metric tree → seg   |  4. Anomaly → seg
              |  5. Segment → activate  |
```

---

## Flow 3 — Metric Tree drill-down  (Leadership / Liveops)

**Demo script (60s):** Leadership opens dashboard. ARPDAU is down 12% WoW. Click → tree decomposes ARPDAU = DAU × ARPDAU/DAU. DAU is flat; revenue/DAU dropped. Click → split by country, by platform, by cohort. One cohort (KR + iOS + day-7 retained) explains 70% of the drop. One click → "save as segment" → opens in segments page.

**Why it wins:** Leadership question = "why did X move?" Playground requires them to know which dimensions to slice. Agent requires them to phrase it. Tree gives them clicks. SoTA: Mixpanel Metric Trees, Power BI Decomposition Tree, Levers Labs.

**Build cost on your stack:** Low. Cube measures + dimensions → recursive split + contribution math. Reuses your existing query layer.

---

## Flow 4 — Anomaly push  (Liveops)

**Demo script:** Morning Slack: "🔴 Retention D1 for new KR iOS users dropped 8% yesterday (z=-3.1). Top contributing event: tutorial step 3 completion -22%." Click → opens segment "KR iOS new users, low D1" preloaded → push to liveops campaign.

**Why it wins:** Liveops doesn't have time to ask questions. SoTA: Tableau Pulse, ThoughtSpot SpotIQ, Anomalo, Sifflet. This *requires* a semantic layer to be reliable (you have one).

**Build cost:** Medium. Needs scheduled jobs + simple z-score / EWMA over Cube queries. No ML needed for v1.

---

## Flow 5 — Segment → Activation  (Liveops) ⭐ LEAD THE DEMO HERE

**Demo script:** Analyst builds segment in playground (your flow 1). Hits **Push** → choose destination (push-notif service, email, ad audience, LiveOps tool). Choose identity (you already have `identity-map`). Sync runs. 10 min later: "12,431 users matched, sent." 2 days later: dashboard shows retention lift on synced cohort.

**Why it wins:** This is the *only* flow that produces revenue / retention numbers in a demo. Hightouch's entire pitch. Composable CDP category. Your `push-modal` + `identity-map` dirs suggest you already started.

**Risk:** Without this, you're a BI tool with a chat skin. With it, you're a Composable CDP — a much bigger story for leadership.

**Build cost on your stack:** You started it. Polish + 1–2 destination connectors covers the demo.

---

## What about a third "flow" we keep seeing — Cohort comparison?

Compare segment A vs B over a funnel / time series. Mixpanel / Amplitude staple. **Skip for v1** — it's a *feature inside* flow 1 (playground), not a separate demo. YAGNI.

---

## Recommendation

**Demo order for leadership pitch:**

1. **Flow 5 (Activation)** — 90s — "we make segments go do work." *Outcome value.*
2. **Flow 3 (Metric Tree)** — 60s — "we answer 'why did X move' in 3 clicks." *Leadership value.*
3. **Flow 4 (Anomaly push)** — 30s — Slack screenshot, short narrative. *Liveops value.*
4. **Flow 1/2 (Playground / Agent)** — 90s — "and here's how analysts work." *Power-user value.*

Order matters: lead with outcomes (5), not capabilities (1/2). Agent is a *modality*, not a value prop — every tool has one in 2026; it's table stakes, not a differentiator.

---

## What you can skip for v1

- **Notebook surface** (Hex-style) — too tech for the target user.
- **Anomaly ML** — start with simple thresholds; ship the loop first.
- **Multi-modal AI generation** — answer text + chart is enough.
- **Governance UI / catalog browser** — your `/data-model` already covers it.

---

## Unresolved questions

1. Who owns the **identity map** between Cube `user_id` and downstream tool IDs (CRM email, device token, ad platform hashed email)? Demo of flow 5 collapses if this is fuzzy.
2. Is the metric tree **author-curated** (someone defines ARPDAU = DAU × ARPDAU/DAU) or **auto-derived** (system guesses)? SoTA is curated; auto-derive is research-grade.
3. Anomaly digest delivery channel — **Slack vs in-app vs email**? Drives plumbing scope.
4. Activation destinations for v1 — **internal LiveOps tool only**, or include external (Braze / OneSignal / Meta CAPI)? Drives connector scope.
5. Leadership demo audience — **analysts who want exploration** or **execs who want outcomes**? Changes the demo order materially.

---

## Sources

- [Top AI Analysis Agents 2026 — Tellius](https://www.tellius.com/resources/blog/best-ai-data-analysis-agents-in-2026-12-platforms-compared-for-nl-to-sql-autonomous-investigation-and-governance)
- [Semantic Layer for AI and BI 2026 — Omni](https://omni.co/articles/best-semantic-layer-for-ai-and-bi-2026)
- [ThoughtSpot Spotter / Agents](https://www.thoughtspot.com/product/agents)
- [Mixpanel — Metric Trees 101](https://mixpanel.com/blog/metric-trees-benefits-guide/)
- [Power BI Decomposition Tree for RCA](https://powerbitraining.com.au/turning-data-into-decisions-using-the-power-bi-decomposition-tree-for-root-cause-analysis/)
- [Levers Labs — RCA with Metric Trees](https://www.leverslabs.com/article/root-cause-analysis-with-metric-trees)
- [Hightouch — Reverse ETL / Data Activation](https://hightouch.com/platform/reverse-etl)
- [Hightouch vs Census](https://hightouch.com/blog/hightouch-vs-census)
- [mParticle Composable Audiences UX](https://docs.mparticle.com/guides/composable-audiences/user-guide/audiences/)
- [Best AI Analytics Tools 2026 — Mitzu](https://mitzu.io/post/best-ai-analytics-tools/)
- [Best Customer Segmentation Tools 2026 — Usermaven](https://usermaven.com/blog/customer-segmentation-software)
