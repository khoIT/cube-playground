# Advisor — discovery-complete: Drive → Decide with a clear, evidenced O→T→C→L→P artifact

## Goal
One UI that takes a manager end-to-end through **experiment discovery**: drive an AI investigation, land in **Decide** looking at a clear, evidenced experiment — **Opportunity → Target → Cause → Lever → Proof** — ready to set up. Both postures (manual Explore + Drive) converge at Decide → Command Center (shared destination).

```
Goal ─┬─ Explore → Board ───┐
      └─ Drive  → DrivePanel ┤
                             ▼
                          DECIDE   ← shared convergence: clear evidenced O/T/C/L/P + "what to look for"
                             ▼  "Review & set up →"
                       COMMAND CENTER  ← shared destination (gated; never auto-launches)
```

## The output artifact — a SELF-DESCRIBING draft
The `ExperimentDraft` becomes the canonical artifact, enriched so it needs no candidate re-fetch:
```ts
interface ExperimentDraft {
  /* …existing: draftId, segmentId, gameId, candidateId, status, hypothesis,
     cohort{segmentId, addressableN, reachablePct}, arms, windowDays,
     power, expectedEffect, money, feasibility, playbookId, delivery, safety … */

  opportunityFactor: string;          // NEW — the gap the experiment attacks (from candidate)
  blueprint: {                        // NEW — the 5 causal slots, each self-contained
    opportunity: string;              //   quantified gap headline
    target: string;                   //   segment + addressable N + reachable %
    cause: string;                    //   hypothesis
    lever: string;                    //   concrete intervention (lever.description + family + playbook)
    proof: string;                    //   power.detail (N, reach, window → MDE)
  };
  readout: {                          // NEW — "what to look for" (pre-registered)
    primaryMetric: string;            //   the factor to move
    mde: number;                      //   min detectable effect (pp) from power
    horizonDays: number;              //   = windowDays
    holdoutPct: number;               //   from the hold-out arm
    decisionRule: string;             //   "Ship if lift ≥ {mde}pp vs hold-out at {horizon}d, else iterate"
  };
}
```
- **Manual** path unchanged in behavior — it just produces this richer draft at "Review & set up".
- **Drive** path: agent scaffolds the draft (persisted); Decide renders `draft.blueprint` + `draft.readout`; "Review & set up →" routes the existing draft to Command Center.

## Stage-clarity upgrades (make each stage concrete & evidenced)
| Stage | Today | Upgrade |
|---|---|---|
| Opportunity | lens diagnose (LIVE) | carry the quantified factor into `draft.opportunityFactor` + `blueprint.opportunity` |
| Target | N hardcoded 2400 / reach 0.75 | `addressableN` falls back to the segment's `uid_count`; `reachablePct` from Care-cache coverage % when present (else honest default) |
| Cause | free-text hypothesis | `blueprint.cause` = hypothesis; surfaced with its provenance (the opportunity factor it traces to) |
| Lever | lever-map (LIVE) | `blueprint.lever` = concrete `lever.description` + family + playbook |
| Proof | power verdict only | add the pre-registered `readout` rule — the "what to look for" the manager named |

## Mechanism (KISS — persist + fetch)
SSE can't carry structured output, so: `scaffold_draft` tool calls `saveDraft(draft)` (segment scope; store orders `updated_at DESC`); on Drive completion the client fetches `listDrafts(segmentId).drafts[0]`.

## DrivePanel completion CTA (`done`, no error)
- *segment + scaffold_draft ok* → **"Continue to Decide →"** → fetch draft → `inv.setScreen('decide')` with the artifact.
- *segment + no draft yet* → **"Draft an experiment from this"** → steer turn that scaffolds → CTA upgrades.
- *game scope* → **"Pick a segment…"** → picker (reuse `listSegments`) → navigate `/advisor/:segmentId` Drive, carry goal/last-message → re-run scoped.
- Always: **"✓ Saved to your investigations"** → run history (runs already auto-persist).

## Scope
**IN:** self-describing draft (blueprint + readout + opportunityFactor); real target N/reach; persist Drive draft; client artifact + getDraft; Decide accepts artifact (evidenced O/T/C/L/P + readout card); DrivePanel CTA + steer fallback + game-scope picker; saved-run surfacing; tests + docs.
**OUT (explicit):** the execution rail — Run/Deliver (CS-queue actuation, freeze/launch state machine), Measure/Readout (lift vs hold-out compute, scorecard), Learn (priors from outcomes). That is the pending `plans/260614-0018-experiment-command-center/` (~11d) — a separate follow-on. Also OUT: `/advisor?query=` deeplink auto-drive; any auto-launch.

## Phases
| # | Phase | Status |
|---|-------|--------|
| 01 | Server: enrich `ExperimentDraft` into a self-describing artifact (blueprint + readout + opportunityFactor) + client mirror | ✅ done |
| 02 | Server: real Target (addressableN← uid_count, reachablePct← Care coverage) + persist Drive draft in `scaffold_draft` | ✅ done |
| 03 | Client: `DriveArtifact` type + fetch-latest-on-complete | ✅ done |
| 04 | Client: Drive-aware Decide view — evidenced O/T/C/L/P + "what to look for" readout card | ✅ done |
| 05 | Client: DrivePanel CTA → Decide + steer fallback + game-scope segment picker + index wiring + saved-run line | ✅ done |
| 06 | Tests + docs | ✅ done |

## Post-review fixes (code-reviewer pass)
- **H1** — `withSplit()` now re-stamps `readout.holdoutPct`/`decisionRule` so a slider change can't desync the pre-registered rule from the arms.
- **M2** — `listDraftsForSegment` ordered `updated_at DESC, draft_id DESC` (deterministic same-second tiebreak).
- **L1** — dropped the unused `getDraft()` client fn (YAGNI; `listDrafts[0]` is the fetch path).

## Accepted / deferred (surfaced, not silently dropped)
- **M1** — a draft with provenance violations still shows the "ready → Continue to Decide" CTA. This matches the existing trust model: Decide *shows* the draft; the **Command Center launch gate** is the real gate ("never auto-launches"). That gate is the deferred execution rail (`plans/260614-0018-experiment-command-center/`), so M1 closes with it — not in this discovery-scope task.

## Dependencies
01 → 02 → 03 → 04 → 05 → 06. (04 needs 03's artifact; 05 reuses 04's artifact-aware Decide.)
