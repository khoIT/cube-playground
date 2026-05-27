# Architecture Analysis — Cube-Playground × Apollo (June 30 Demo)

**Date:** 2026-05-26 (5 weeks to demo)
**Author:** Claude analysis for khoitn@vng.com.vn
**Inputs:** Whiteboard photo (DA/GD ↔ Apollo); Apollo Confluence (BRD, OKR Q2, 12 May sync-up, LU Web Discovery Report); cube-playground codebase recon; CFL Liveops Playbook v5; `docs/lessons-learned.md`.

---

## TL;DR

Hawkins's flow — cube-playground (CP) owns the *data → metric → segment* path; Apollo owns *segment → campaign → channel → performance* — is the right division and rides a real opening: **Apollo's own segment builder is blocked on CDP, and OKR PKR2 explicitly asks for "flexible segment configuration after data standardization"**. CP fills that gap.

But there is **no write-side contract from CP to Apollo today**. Apollo's external API is read-only (list / get-file-URL / check-membership). The June 30 demo's load-bearing piece is a brand-new **segment-handoff contract** (schema + transport + auth + identity) that has to be co-designed and built in 5 weeks. Internal-leadership scope is achievable; cross-team Apollo-side seam needs commitment from Apollo this week.

The two pain points you named map cleanly: **PP#1 (log-inventory automation) is correctly deferred** — the playbook v5 evidence (22/29 logs without schemas after 6 months on CFM) shows it's a 2-quarter problem, not a 5-week one. **PP#2 (hypothesis → internal validation → segment-for-Apollo) IS the demo's narrative spine** — it's the only differentiated story we have over Apollo's existing rule-based segment UI.

---

## 1. The Proposed Architecture

```
┌───────────────────────── cube-playground ──────────────────────────┐    ┌──────────────── Apollo ───────────────┐
│                                                                    │    │                                       │
│  Raw log inventory   ─►  Metric Catalog  ─►  Segmentation          │    │  Segment Set ─► Conditions ─► Playbook │
│  (G-deferred)            (live)              Engine + Playground   │    │                                       │
│                                              ▲                     │    │  Promo Engine  Journey  Combos        │
│  Real Time Engine  ◄────  Feature Store     Chat (NL → segment)    │    │  Channels: Push / IAM / SDK /         │
│                                                                    │    │            Pay / PlayerHub / Web      │
│                              Segment UID  ──────────────────────►  │ ─► │                                       │
│                              + UID list / refresh contract         │    │  Performance Dashboard                │
└────────────────────────────────────────────────────────────────────┘    └───────────────────────────────────────┘
                                                                            Trigger ─► Action ─► Channel ─► User
```

CP becomes the **exploration & authoring surface**: the studio team enters with a hypothesis, validates against internal data (chat + KPIs + query builder + catalog), and lands a segment. Apollo becomes the **activation surface**: the segment is consumed there for campaigns, journeys, channels, performance.

---

## 2. Why It's the Right Call (Pros)

1. **Stops both teams from rebuilding the other's stack.** Apollo doesn't have to build a Cube-grade segment exploration UI; CP doesn't have to build messaging delivery, channel inventory, or campaign orchestration (Push / IAM / SDK / Pay / PlayerHub / Web Pop-up — all already shipped or in flight in Apollo per OKR PKR3).
2. **Unblocks Apollo's PKR2.** Apollo's 26Q2 OKR includes "Prepare a solution that allows Game Studios to flexibly configure segments on Apollo after data standardization is completed". CP *is* that solution. Their segment builder is also currently blocked on CDP API revision — CP is the unblock.
3. **Plays to CP's unique strength: chat → segment.** No other tool in VNGGames offers "ask in NL, validate against your own data, save & activate". This is the *one* differentiated story for the demo. Apollo's UI (image 3) is rule-builder dropdowns — competent but generic.
4. **Reuses existing CP foundations.** Segments are a mature primitive — predicate tree, live refresh, game-scoped, identity-field mapped, owner-scoped, mock CDP-activation already wired. About 70% of the seam is built; only the real write-side push to Apollo is missing.
5. **Single source of truth for segment definitions.** Today: definitions live partly in CDP, partly in spreadsheets, partly in Apollo. Moving authoring into CP eliminates a copy-paste failure mode that the May Apollo sync-up flagged ("Past Behavior filter must be flexible across games").
6. **Aligns with Apollo's 30 June Promo Engine launch.** APO-5326 ships Promo Engine for PTG on 30 June. PTG is also live in CP (`cube.js` GAME_ALIASES + cube YAMLs). Identical demo window, identical pilot game — the seam can be a literal joint demo.
7. **Compounding identity foundation.** `cube_identity_map` already exists; extending it from "per-cube identity dimension" to "per-game canonical Nexus/VGA ID" is a one-table, one-resolver patch — not a system.

---

## 3. Why It's Hard (Cons / Risks)

1. **🚨 No write-side contract exists. Net-new.** Apollo's external API per Discovery Report (LU Web, 2026-05-18) is *read-side only*: `list segments by product_code`, `get segment file URL`, `check user membership`. A POST endpoint to ingest an external segment (metadata + UID source) **does not exist** and is the load-bearing dependency for the demo.
2. **Apollo's three segment types ≠ CP's two.** Apollo distinguishes **RFM Cohort / Past Segment / Live Segment**. CP's predicate segment most naturally produces a **Past Segment** (one-shot SQL → UID file). **Live Segment** requires Apollo's own engine to read game events and re-evaluate trigger conditions — that logic doesn't currently live in a form Apollo can ingest from CP (it's Kafka stream rules, not Cube SQL). **For 30 June scope, recommend "CP produces Past Segments only"**; Live/Trigger left to Apollo's native engine.
3. **Identity-join authority is undefined.** Cube returns whatever identity dim the YAML declares (e.g. `Users.id`, raw `sdkuserid`, `vopenid`, `playeropenid` — see playbook v5 gotchas G1/G6). Apollo wants a canonical user identifier (VGA ID per Discovery Report). **Decision needed (this week): does CP do the join and ship Nexus UUIDs, or ship game-native IDs + a join-instruction so Apollo joins on its side?** Probably the former — Apollo's onboarding pain is partly the manual per-game identity stitching.
4. **Pain Point #2 crosses a UX seam (CP ↔ Apollo).** Once the user lands a segment in CP, they must context-switch to a different product to build the campaign. Without SSO + a deep-link ("Open in Apollo →"), this is a credibility-eroding break in the narrative. Both teams need to agree on the handoff UI (link or embed).
5. **Pain Point #1 (log inventory automation) is a 2-quarter problem.** Playbook v5 evidence: 29 logs catalogued for CFM, 7 with confirmed schemas (24%), the rest waiting on GDS. The playbook is descriptive, not prescriptive — there is no studio-side authoring workflow, owner field, version, or deprecation lifecycle defined. Building a UI that lets studios author logs means CP must *invent* the schema/ownership/lifecycle layer that GDS owns offline. **Correctly out of scope for 30 June.** It should be acknowledged in the demo as the *next* milestone, not silently skipped.
6. **Refresh-cadence gap.** CP segments refresh on cron (`refresh_cadence_min`). Apollo Live Segments evaluate ~30s. For Past Segments this is irrelevant (frozen); for any future Live/Trigger work, the architecture splits — CP would publish *rules*, Apollo would *evaluate* them.
7. **Dashboard ambiguity.** Apollo OKR KR4 ("Build Campaign Performance Dashboard for Game Studios — collaborate with DA and Apollo to build dashboards directly on Apollo") overlaps with CP's existing dashboards / KPI hero / anomaly inbox. **Where does the dashboard live?** If both surfaces have one, GS users get confused. Suggest: pre-launch analytics in CP (segment count, predicted cohort behavior); post-launch performance in Apollo (campaign reach, click, conversion). State this seam explicitly.
8. **Multi-game segments are not modeled in CP.** Apollo's UI offers a "Churn Segment" spanning multiple games. CP segments are `game_id`-scoped (single game only, backfilled to 'ptg'). For 30 June: defer multi-game; demo single-game segment only. Flag for Q3.
9. **Tool-adoption risk.** Apollo has momentum with top-5 games (PTG + NTH live, 3 in onboarding). CP user base is narrower (analytics/DA-leaning, internal). Studios who today open Apollo to make a campaign may not know to start in CP. Solve via Apollo deep-link "Create from cube-playground →" once a segment exists.
10. **Empty-cache / broken-segment failure modes are subtle and known.** `docs/lessons-learned.md` documents two relevant failure shapes: (a) empty rows cached as `200 OK` (caused chat-side missing-chart bug), (b) cube schema drift breaking presets. A segment that 0-rows transiently and gets pushed to Apollo is a *campaign sent to nobody* — much more visible than a missing tile. Push contract must include a non-empty guard server-side (mirror the `rows.length > 0` lesson before activation).

---

## 4. Major Workstreams — cube-playground Team

### Demo-critical (must land by 30 June)

| # | Workstream | Acceptance | Notes |
|---|------------|------------|-------|
| CP-1 | **Real Apollo push API client** | Replace mock at `server/src/routes/segments.ts` `:id/activations` + `src/api/cdp-metrics-client.ts` with a real call against Apollo's new ingest endpoint | Blocked on Apollo-side workstream A-1 |
| CP-2 | **"Push to Apollo" UX** | On Segments page push-modal + chat-emitted segment artifact, add "Push to Apollo" action; success state shows Apollo deep-link | Reuse existing "Activate to CDP" modal shell |
| CP-3 | **Canonical identity resolver** | Extend `cube_identity_map` to map (game, identity_field) → canonical user-id strategy (VGA / Nexus UUID). Resolver runs at refresh time, materializes canonical UIDs | Discovery Report Q2 calls VGA ID the canonical primitive |
| CP-4 | **Full UID materialization for Past Segments** | Drop 100k sample cap when destination = `apollo`; produce signed URL or stream | Current cap is for UI responsiveness, not a storage constraint |
| CP-5 | **Empty-segment guard before push** | Refuse to push a segment with `uid_count === 0`; show explicit FE error | Direct application of `lessons-learned.md` empty-cache rule |
| CP-6 | **Hypothesis-driven flow polish** | Chat onboarding prompt nudges the "validate then save segment" loop; chat artifact has a "Save as segment" button | Pain Point #2 — this is the *demo narrative* |
| CP-7 | **Demo data + game choice** | PTG segments seeded with realistic predicates that produce non-trivial cohorts; baseline `ensurePlaceholder` + cache states verified | PTG is the only game live on both CP and Apollo Promo Engine — natural pilot |

### Deferred (acknowledge, don't ship)

- **CP-D1: Multi-game segments** (`game_ids_json` array column) — defer to Q3.
- **CP-D2: Live/Trigger segments** (rules published to Apollo for stream eval) — Apollo's native engine already does this; not CP's seat for now.
- **CP-D3: Raw log inventory UI** (Pain Point #1) — 2-quarter problem per playbook v5 evidence. Acknowledge as the milestone *after* segment handoff.

---

## 5. Major Workstreams — Apollo Team

### Demo-critical

| # | Workstream | Acceptance | Notes |
|---|------------|------------|-------|
| A-1 | **Ingest-external-segment API** (NEW endpoint) | `POST /segments` accepting `{ name, description, product_code, type=past, owner, source=cube-playground, uid_source: signed_url OR inline_uids, refresh_cadence }` returning `segment_id` | This is the load-bearing dependency for the demo |
| A-2 | **Auth / credential mechanism for CP service account** | Decide: service account JWT vs OAuth client-credentials. Issue creds to CP backend | Same Critical blocker the LU Web Discovery Report hit; resolve once for all consumers |
| A-3 | **Apollo UI: surface CP-sourced segments** | "Source: cube-playground" badge on Apollo's segment list; segment usable in Singular Campaign / Promo Engine on PTG | UI work, but small |
| A-4 | **product_code mapping for PTG** | Confirm PTG product_code so CP knows what to send | Discovery Report Critical blocker #2 |
| A-5 | **Deep-link contract** | Apollo accepts a `?source_segment_id=<cp_id>` query for cross-tool linking | Optional but improves Pain Point #2 narrative |

### Out of scope for the demo seam (but already in Apollo's Q2)

- Real-time event triggers per game (PTG / NTH live; CFM / Cookie Run / Total Football in onboarding) — independent track.
- Promo Engine for PTG (APO-5326, 30 June) — *use as the activation target in the demo*.
- KR4 dashboard (APO-5323, 0% done) — risk of overlap with CP, not blocking for the demo.

---

## 6. Joint Workstreams (Both Teams)

### Contract design — biggest unknown, do this first

| # | Workstream | Owner | Deadline (suggested) |
|---|------------|-------|----------------------|
| J-1 | **Segment-handoff schema v0.1** | CP-PM + Apollo-PM | Week 1 (by 2026-06-02) |
| J-2 | **Identity decision: who joins to canonical ID?** | CP-PM + Apollo-PM + GDS rep | Week 1 |
| J-3 | **Auth / credential issuance** | Apollo-Sec + CP backend | Week 1 |
| J-4 | **UID transport: signed URL vs inline list vs streamed** | CP backend + Apollo backend | Week 1 |
| J-5 | **Failure semantics: fail-open / fail-closed on stale segment** | Both | Week 2 |
| J-6 | **Demo script + run-through** | CP-PM + Apollo-PM | Week 4 |
| J-7 | **Joint demo dry-run on PTG with real data** | Both | Week 5 (3 days before 30 June) |

### Recommended segment-handoff schema (strawman to react to)

```json
POST /apollo/v1/segments
{
  "external_id": "cp:seg_abc123",
  "name": "tutorial-completed-no-purchase-w1",
  "description": "Users completed tutorial in week 1 but no in-app purchase",
  "product_code": "ptg",
  "type": "past",                    // past | live (future)
  "owner": "khoitn@vng.com.vn",
  "source": "cube-playground",
  "source_url": "https://cube-playground.../segments/abc123",
  "predicate_summary": "users.completed_tutorial = true AND billing.purchase_count = 0 ...",
  "uid_count": 12453,
  "uid_source": {
    "type": "signed_url",
    "url": "https://.../seg_abc123.csv?token=...",
    "expires_at": "2026-07-01T00:00:00Z",
    "format": "csv",                 // one canonical_user_id per line
    "identity": "vga_id"
  },
  "refresh_cadence_min": 60,         // CP repushes on this cadence; null = one-shot
  "created_at": "2026-05-26T16:56:00Z"
}
```

---

## 7. Pain Point Mapping

| Pain Point | Treatment for 30 June | Long-term |
|------------|----------------------|-----------|
| **PP#1 — Raw log inventory automation** | Out of scope. Acknowledge in demo: "Today, log onboarding is GDS-owned + manual; once a game is onboarded, here's what CP unlocks." | 2-quarter program: log catalog UI + schema editor + identity stitching rules + gotchas-as-validation + SQL generator. Pre-req: GDS exposes machine-readable logdesc (open question). |
| **PP#2 — Hypothesis → internal validation → segment for Apollo** | **This is the demo's narrative.** CP-2, CP-3, CP-6 directly serve it. End-to-end happy path: chat question → validated cohort → saved segment → pushed to Apollo → campaign live in Apollo Promo Engine. | Steady polish: more chat templates ("find me churn risks", "find me whales who paused"), better deep-link UX, in-CP preview of campaign reach. |

---

## 8. Recommended Demo Scope (5-week plan, internal-leadership + cross-team audience)

**Persona:** Studio PM at PlayTogether (Hawkins's typical persona).
**Hypothesis:** "Are players who hit our tutorial completion but didn't spend in week 1 worth a re-engagement push?"

**Demo flow (single scripted path):**

1. Open CP `/chat` → ask the hypothesis in NL. Chat returns cohort count + sparkline (Apollo KR4 territory, but CP-native today).
2. Drill into the cohort: KPI panel shows DAU / Revenue / Paying-rate of this cohort vs the global baseline (Catalog + Liveops surfaces — already shipped).
3. "Save as segment" — segment created with the chat-resolved predicate.
4. "Push to Apollo" — calls Apollo `POST /segments`; toast: "Segment live in Apollo. Open Apollo →".
5. Click deep-link → land in Apollo on the segment detail; "Use in Promo Engine" → configure Singular Campaign (Push notif) → schedule.
6. Show Promo Engine's campaign view with the segment-targeting count. Soft-launch state.
7. (Optional) Mention: "Performance metrics will flow back via Apollo's KR4 dashboard. Next milestone is closing the analysis loop in CP for *pre-launch* what-if, leaving post-launch perf in Apollo."

**What is NOT demo'd:**
- Live/Trigger segments (stay in Apollo's native flow).
- Multi-game segments.
- Log inventory authoring.
- Real-time campaign performance (Apollo KR4 is 0% done).

**Risk register for the demo itself:**
- Apollo ingest API slips → demo's Step 4 fails. **Mitigation:** stub it on Apollo's side as a flat-file accept against a known PTG-test product_code by Week 3.
- Identity mismatch produces empty Apollo segment → mitigate with **CP-5 empty-segment guard** + a Week-5 dry-run with real data.
- Chat regressions (the lessons-learned doc warns about per-mount latches & empty caches). **Mitigation:** the chat → segment artifact path needs a second-cycle test pre-demo.

---

## 9. Considerations You Should Also Weigh

1. **Joint demo or solo?** Hawkins's flow makes most sense if Apollo's Promo Engine launch is a *joint* demo, not two separate ones the same week. Worth coordinating with Apollo PM (Lưu Ý Nhi authored BRD; Toan Khanh Nguyen authored 12 May sync-up — both reachable).
2. **Who owns the "GS user explanation"?** If a studio PM opens Apollo today, do they know to go to CP first? Until the deep-link reverse-direction exists ("Need richer segments? Open CP →" inside Apollo's segment builder), CP adoption depends on word-of-mouth. Worth asking Apollo for a small UX nudge.
3. **PII / data residency.** Discovery Report flagged Important blocker #6: segment data includes VGA ID, device ID, phone number. CP currently has none of those — it has cube-native dimensions only. If Apollo's ingest expects VGA ID, CP's identity resolver (CP-3) must traverse to a system that can produce VGA IDs without leaking phone/device into CP. Probably a one-way function (CP sends `vga_id_hash` or asks an Apollo-side resolver to translate). **Open question for Security review.**
4. **Long-tail: how many studios?** PTG is the obvious pilot. NTH (also Apollo-live) is the second-most-natural. CFM / Cookie Run / Total Football are mid-onboarding on Apollo; CP would need to extend `cube.js` GAME_ALIASES + identity_map per game (CP already has `cfm_vn`, `jus_vn`, `ballistar_vn`). State this scaling shape explicitly in the demo "what's next" slide.
5. **Cost of Apollo ingest API being slow.** If Apollo says "this is a 2-month workstream on our side", the demo's Step 4 has to become a video, a mock, or a CP-side simulated push. Not great. Worth pre-committing with Apollo before announcing the demo.
6. **Where do RFM Cohort segments live?** Apollo defines an RFM segment type. CP doesn't. Decision: does CP support emitting RFM segments to Apollo (richer), or does Apollo's RFM stay native and CP only emits Past Segments? **Recommend the latter for 30 June.** Revisit Q3.

---

## Unresolved Questions

1. Who from the Apollo team owns the new ingest endpoint, and what is their sign-off cadence this week?
2. Is VGA ID actually the canonical user identifier across all top-5 games, or does it vary per game? (Playbook v5 gotchas G1/G6 hint at variation.)
3. Does GDS expose a machine-readable logdesc that CP can ingest in the future, or is it Confluence/spreadsheet today? (Drives feasibility of PP#1 in Q3.)
4. What's Apollo's product_code for PTG, and is it stable for the demo window?
5. Is the Apollo `POST /segments` endpoint billed against Apollo's existing Q2 roadmap (PKR2's "Prepare a solution for GS to flexibly configure segments"), or does it need a new ticket?
6. Does the demo audience expect performance metrics shown? If yes, Apollo KR4 dashboard slip (0% done) becomes a risk we share.
7. SSO between CP and Apollo — exists today or needs a placeholder login for the demo?
8. Do we have a name for this seam? "Segment Federation"? "Open Segments"? Worth deciding before the demo deck.
