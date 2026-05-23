# Brainstorm — Chat Assistant Q1 Roadmap (Non-Tech User JTBD)

**Date:** 2026-05-24
**Branch:** new_design
**Status:** Agreed — Shape α (Trust-first)

---

## Problem statement

Make chat-agent a true assistant for **non-tech users** (PMs, marketers, analysts) to:

1. **Discover** what data exists in the semantic layer.
2. **Translate** a business question (per `cube-business-case.html` 16-question library) into a Cube query + segment definition.
3. **Verify** the result is correct before saving.
4. **Monitor** saved segments over time (the user's stated end goal).
5. **Operationalize** — publish as CDP audience / MCP tool.

JTBD framing: *given a business question, shortest path to "what to look at" + "what segment to build"*.

Top frictions confirmed by user:
- F1: Don't know what data exists.
- F2: Hard to verify result is correct.

Persona scope: all three (PM, marketer, analyst). Risk acknowledged — generic UI trap.

---

## Existing infra (do not duplicate)

| Capability | Where it lives | Implication for chat |
|---|---|---|
| Business metric catalog | `src/pages/Catalog/` + `use-catalog-meta.ts` + `api/cdp-metrics-client.ts` | Editable plan READS catalog, does NOT create parallel definitions |
| Segments CRUD | `src/pages/Segments/` + `server/data/segments.db` + `api/segments-client.ts` | Chat deeplinks to existing pages; does not own a separate segment model |
| Chat catalog tools | `chat-service/src/tools/{list,get}-{business-metric,segment}.ts` | Already wired — extend, don't re-architect |
| Sessions persistence | `chat-service` SQLite + `/api/chat/sessions` proxy | Memory layer (#9) adds search + per-user-per-game scoping on top |
| Concept detail / glossary | `Catalog/concept-detail/` | Glossary feature (#3) renders/edits these |

---

## Evaluated approaches

**Shape α — Trust-first (CHOSEN).** M1 Discovery → M2 Studio → M3 Memory+saved-segments.
- Pros: nails F2 (verification) before automation; foundation for everything else.
- Cons: no proactive alerts in Q1.

**Shape β — Memory-first.** Rejected: shipping memory before verification means agent remembers bad definitions.

**Shape γ — Operationalize fast.** Rejected: alerts on unverified segments train users to ignore alerts.

---

## Final feature set (Q1)

### M1 — Discovery + Infra Foundation (parallel tracks)

**Track A — Discovery surface (UI/chat):**
- **F1 Starter library** — 16 business questions as clickable templates on chat landing.
- **F2 Schema cartographer** — agent-generated browsable map of cubes/dimensions/measures with plain-English labels. Linked from chat answers.
- **F3 Concept glossary** — user-facing definitions (whale, DAU, LTV…) → mapped to catalog fields. Click any term in chat to see chain.
- **F4 Suggested follow-ups** — every answer ends with 3 next-question chips.

**Track B — Monitoring infra (backend, front-loaded):**
- Scheduler primitive (cron or queue) on chat-service or server.
- Notification dispatch (in-app first, email/Slack later).
- Audit log table for who-saved-what-when.
- *Why front-load:* unblocks M3 + Q2; cheap to design alongside.

### M2 — Question Studio (the verification surface)

- **F5 Editable execution plan** — agent shows plan BEFORE running:
  > "Interpreting *whale* as `business_metrics/whale_payer` from catalog (top 5% by recharge). Override? [edit]"
  - **Critical consistency rule:** plan cells render existing catalog entries; user overrides flagged as divergence; "save as new metric" prompt routes to catalog.
- **F7 Sample-member preview** — for any segment, 10 anonymized sample users with explanation "this row matches because X". Cheapest verification surface.
- **F6 Plain-English filter trace** — every result has "filtered by X AND Y, grouped by Z" panel alongside SQL.
- **F8 Sanity-check assistant** — flag when number deviates >Xσ from rolling baseline.

### M3 — Memory + Saved Monitored Segments

- **F9 Persistent chat history per user × game** *(user-originated)* — sessions cross-session, semantic search, recents rail.
- **F10 User glossary memory** — agent learns "whale = top 1%" once, remembers forever. Stored in chat-service DB linked to catalog ids.
- **F13 Save segment as monitored entity** — pin segment, schedule daily refresh, view history. Uses M1-Track-B infra.
- **F11 Recents rail** — last 5 questions + saved segments on chat landing.

### Deferred to Q2

| Feature | Reason |
|---|---|
| F14 Threshold/anomaly alerts | Needs M3 in production first; alerts on shaky foundations are worse than no alerts |
| F15 Drift detection | Needs ≥30d historical data; can't ship Q1 |
| F16 Daily/weekly digest | Built on alerts + memory |
| F12 Team-level glossary | Governance scope; resolve PII/permissions first |
| F17 Publish to CDP audience | Depends on CDP API readiness — external dep |
| F18 Publish to MCP tool | Same as F17 |
| F19 Permalink + comments | Collaboration layer; not core JTBD |
| F20–F22 UX polish (forks, image, voice) | Nice-to-have; cost vs leverage low for Q1 |

---

## Catalog-consistency rule (CRITICAL design constraint)

The editable plan in Studio (M2-F5) is a **thin presentational layer over existing catalog**. Rules:

1. Every interpretation references a catalog entry by id (`business_metrics/<id>`).
2. User edits create a **divergence flag**, not a hidden override — UI shows "your definition differs from catalog default".
3. Three resolution paths offered:
   - **Use catalog default** (revert).
   - **Save as personal override** → stored in chat-service per-user-per-game (memory M3-F10).
   - **Propose catalog update** → opens metric-detail page; analyst can promote.
4. No chat-side metric/segment definitions ever stored independently of catalog.

This rule prevents the parallel-truth disaster and turns chat into a **promoter** of catalog quality rather than a competitor.

---

## Segment-write scope (locked)

- Chat **suggests + deeplinks** to existing Segments build page (current behavior, unchanged).
- No direct write API in Q1.
- Re-evaluate Q2 once verification surface (M2) is mature.

---

## Risks

1. **"All 3 personas" generic UI trap** — mitigate via persona-aware starter library (M1-F1 surfaces different starters per persona).
2. **Monitoring infra slip** — Track B front-loaded, but if it slips, M3-F13 also slips. Mitigation: scope infra to minimum (in-app notif only, defer email/Slack).
3. **Memory governance** — per-user-per-game scope decided; team-level deferred. Document PII handling in M3 design phase.
4. **Catalog-consistency drift** — high-vigilance during M2 build; add e2e test that asserts every chat-emitted segment cites a catalog id.
5. **Cost** — Studio (M2) ~doubles tokens per turn (plan + execute + sample preview). Estimate +$0.05/turn. Budget review pre-M2.

---

## Success metrics

| Phase | Metric | Target |
|---|---|---|
| M1 | Starter-question click-through rate | ≥40% of new sessions start from a starter |
| M1 | Glossary term click rate | ≥1 per session avg |
| M2 | Plan-edit rate | ≥15% of turns edit the plan before run |
| M2 | Sample-preview view rate | ≥60% of segment-emitting turns |
| M2 | "Save as personal override" rate | ≥5% (signal that glossary memory pays off) |
| M3 | Returning-user cross-session resume rate | ≥30% sessions reference history |
| M3 | Saved monitored segments per user | ≥3 within first 4 weeks |

---

## Validation criteria (definition of done)

- [ ] Non-tech user runs all 16 business questions end-to-end via chat without writing SQL.
- [ ] Every emitted segment cites a catalog entry id.
- [ ] User-overridden definitions persist across sessions per user-per-game.
- [ ] Saved segments refresh on schedule with audit trail.
- [ ] Zero parallel-truth segment definitions detected in audit query.

---

## Dependencies

- Catalog must expose stable ids for every metric/dimension/measure (today: yes via `use-catalog-meta`).
- Chat-service DB schema migration for memory tables (M3).
- Scheduler choice (cron vs background queue) — decide M1.

---

## Open questions

1. **Where does scheduler live?** chat-service vs main server. Recommend chat-service for cohesion, but main server already has segments.db cron. Resolve M1.
2. **Notification surface in M3** — in-app toast only, or also email? Recommend in-app only for Q1.
3. **Per-game scoping of memory** — if same user is on 2 games, do their definitions transfer? Recommend NO by default, allow opt-in copy.
4. **Persona detection** — how does starter library know to show PM vs marketer questions? User-selected on first login, or inferred from behavior? Resolve M1 UX design.
5. **CDP team API readiness** — F17 deferred to Q2 assumes their write API will exist. Confirm with CDP owners before committing.

---

## Next step

User confirmed Shape α. Recommend invoking `/ck:plan` to expand M1 into a detailed implementation plan covering both tracks (Discovery UI + Monitoring infra).
