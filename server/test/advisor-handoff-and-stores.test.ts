/**
 * Tests for the Advisor hand-off scaffolder + stub draft/feedback stores.
 *
 * scaffoldDraft is pure (no I/O); the stores use an in-memory SQLite DB with
 * only migration 054 applied, isolating from other schema changes.
 *
 * Core guarantees under test:
 *  - a scaffolded draft is ALWAYS status='draft' (Advisor never launches)
 *  - treatment share is clamped so hold-out stays ≥ 15%
 *  - draftId is deterministic → re-scaffold is idempotent (one row, updated)
 *  - CS-actuated levers route to the in-system queue; others export external
 *  - feedback is append-only and round-trips
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setDb, closeDb } from '../src/db/sqlite.js';
import { scaffoldDraft } from '../src/advisor/handoff-scaffolder.js';
import { saveDraft, getDraft, listDraftsForSegment } from '../src/advisor/command-center-draft-store.js';
import { recordFeedback, listFeedbackForSegment } from '../src/advisor/feedback-store.js';
import { scoreExperiment, resolveScoringGoal } from '../src/advisor/agent/experiment-quality-score.js';
import type { ExperimentCandidate } from '../src/advisor/candidate-types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let db: Database.Database;

beforeAll(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  const sql = readFileSync(
    join(__dirname, '..', 'src', 'db', 'migrations', '054-advisor-handoff-feedback.sql'),
    'utf8',
  );
  db.exec(sql);
  setDb(db);
});

afterAll(() => {
  closeDb();
});

/** A CS-actuated win-back candidate fixture. */
function csCandidate(overrides: Partial<ExperimentCandidate> = {}): ExperimentCandidate {
  return {
    id: 'lifespan::win-back',
    opportunityFactor: 'lifespan',
    lever: { family: 'win-back', actuator: 'cs', description: 'CS-delivered win-back outreach' },
    feasibility: {
      status: 'feasible',
      lever: { family: 'win-back', actuator: 'cs', description: 'CS-delivered win-back outreach' },
    },
    power: { status: 'powered', mde: 4.2, detail: 'N=2400 → ≥4.2 pp' },
    expectedEffect: { value: 0.06, confidence: 'assumption', source: 'game-ops default' },
    money: { incrementalVnd: null, perUnitVnd: null, note: 'TBD', currency: 'VND' },
    score: 144,
    rankReason: 'Win-back (+6pp assumed): N=2400 powered.',
    ...overrides,
  };
}

describe('scaffoldDraft', () => {
  it('always produces a draft (never launches)', () => {
    const draft = scaffoldDraft({
      candidate: csCandidate(),
      segmentId: 'seg-1',
      gameId: 'cfm_vn',
      addressableN: 2400,
      reachablePct: 0.78,
    });
    expect(draft.status).toBe('draft');
  });

  it('clamps treatment share so hold-out stays ≥ 15%', () => {
    const draft = scaffoldDraft({
      candidate: csCandidate(),
      segmentId: 'seg-1',
      gameId: 'cfm_vn',
      addressableN: 2400,
      reachablePct: 0.78,
      treatmentShare: 0.95, // request abusive split
    });
    const treatment = draft.arms.find((a) => a.key === 'treatment')!;
    const holdout = draft.arms.find((a) => a.key === 'holdout')!;
    expect(treatment.share).toBeLessThanOrEqual(0.85);
    expect(holdout.share).toBeGreaterThanOrEqual(0.15);
    expect(holdout.label).toMatch(/measured/i);
  });

  it('has a deterministic idempotent draftId', () => {
    const a = scaffoldDraft({ candidate: csCandidate(), segmentId: 'seg-1', gameId: 'cfm_vn', addressableN: 100, reachablePct: 0.5 });
    const b = scaffoldDraft({ candidate: csCandidate(), segmentId: 'seg-1', gameId: 'cfm_vn', addressableN: 999, reachablePct: 0.9 });
    expect(a.draftId).toBe('seg-1::lifespan::win-back');
    expect(b.draftId).toBe(a.draftId);
  });

  it('routes CS-actuated levers to the in-system queue', () => {
    const draft = scaffoldDraft({ candidate: csCandidate(), segmentId: 'seg-1', gameId: 'cfm_vn', addressableN: 100, reachablePct: 0.5 });
    expect(draft.delivery).toBe('cs-queue');
  });

  it('routes non-CS levers to external/manual delivery', () => {
    const sys = csCandidate({
      lever: { family: 'price-anchor', actuator: 'system', description: 'price-anchored offer' },
    });
    const draft = scaffoldDraft({ candidate: sys, segmentId: 'seg-1', gameId: 'cfm_vn', addressableN: 100, reachablePct: 0.5 });
    expect(draft.delivery).toBe('external');
  });

  it('carries hard safety guardrails', () => {
    const draft = scaffoldDraft({ candidate: csCandidate(), segmentId: 'seg-1', gameId: 'cfm_vn', addressableN: 100, reachablePct: 0.5 });
    expect(draft.safety.holdoutMeasured).toBe(true);
    expect(draft.safety.contactCapPerPlayer).toBeGreaterThanOrEqual(1);
    expect(draft.safety.recentPayerGuardDays).toBeGreaterThan(0);
  });

  it('grounds the trace-back receipt to the real segment', () => {
    const draft = scaffoldDraft({ candidate: csCandidate(), segmentId: 'seg-42', gameId: 'cfm_vn', addressableN: 100, reachablePct: 0.5 });
    expect(draft.provenance?.segment).toEqual({ segmentId: 'seg-42', gameId: 'cfm_vn' });
  });

  it('carries the candidate evidence query + playbook on the receipt when present', () => {
    const c = csCandidate({
      playbookId: 'pb-winback-01',
      evidenceLink: { measures: ['mf_users.avg_total_active_days'], source: 'billing_lifetime / cfm_vn' },
    });
    const draft = scaffoldDraft({ candidate: c, segmentId: 'seg-1', gameId: 'cfm_vn', addressableN: 100, reachablePct: 0.5 });
    expect(draft.provenance?.opportunityEvidence?.measures).toContain('mf_users.avg_total_active_days');
    expect(draft.provenance?.playbookId).toBe('pb-winback-01');
  });

  it('omits evidence/playbook from the receipt when the candidate has none', () => {
    const draft = scaffoldDraft({ candidate: csCandidate(), segmentId: 'seg-1', gameId: 'cfm_vn', addressableN: 100, reachablePct: 0.5 });
    expect(draft.provenance?.opportunityEvidence).toBeUndefined();
    expect(draft.provenance?.playbookId).toBeUndefined();
  });

  it('is self-describing: fills all five blueprint slots from the candidate', () => {
    const draft = scaffoldDraft({ candidate: csCandidate(), segmentId: 'seg-1', gameId: 'cfm_vn', addressableN: 2400, reachablePct: 0.78 });
    expect(draft.opportunityFactor).toBe('lifespan');
    expect(draft.blueprint.opportunity).toContain('lifespan');
    expect(draft.blueprint.target).toMatch(/2,400 addressable.*78% reachable/);
    expect(draft.blueprint.cause).toBe(draft.hypothesis);
    expect(draft.blueprint.lever).toContain('win-back');
    expect(draft.blueprint.proof).toBe(draft.power.detail);
  });

  it('pre-registers a readout rule tied to the power story', () => {
    const draft = scaffoldDraft({ candidate: csCandidate(), segmentId: 'seg-1', gameId: 'cfm_vn', addressableN: 2400, reachablePct: 0.78 });
    expect(draft.readout.primaryMetric).toBe('lifespan');
    expect(draft.readout.mde).toBe(4.2);
    expect(draft.readout.horizonDays).toBe(draft.windowDays);
    // Hold-out arm share (20%) is echoed in the readout rule.
    expect(draft.readout.holdoutPct).toBe(20);
    expect(draft.readout.decisionRule).toMatch(/Ship if.*4\.2pp.*20% hold-out/);
  });
});

describe('quality scorecard over a scaffolded draft (the Decide gate input)', () => {
  it('a powered + feasible draft clears every CRITICAL dimension', () => {
    const draft = scaffoldDraft({ candidate: csCandidate(), segmentId: 'seg-1', gameId: 'cfm_vn', addressableN: 2400, reachablePct: 0.78 });
    const sc = scoreExperiment(draft, 'revenue', { provenanceResolved: true });
    const criticals = sc.dimensions.filter((d) => d.critical);
    expect(criticals.every((d) => d.pass)).toBe(true);
    // money.incrementalVnd is null → materiality is the (non-critical) shortfall.
    expect(sc.dimensions.find((d) => d.dimension === 'materiality')!.pass).toBe(false);
    expect(sc.dimensions.find((d) => d.dimension === 'materiality')!.critical).toBe(false);
  });

  it('an underpowered draft fails the power CRITICAL gate', () => {
    const under = csCandidate({ power: { status: 'underpowered', mde: 12, detail: 'N too small' } });
    const draft = scaffoldDraft({ candidate: under, segmentId: 'seg-1', gameId: 'cfm_vn', addressableN: 80, reachablePct: 0.5 });
    const sc = scoreExperiment(draft, 'revenue', { provenanceResolved: true });
    const power = sc.dimensions.find((d) => d.dimension === 'power')!;
    expect(power.critical).toBe(true);
    expect(power.pass).toBe(false);
    expect(sc.pass).toBe(false);
  });
});

describe('resolveScoringGoal', () => {
  it('passes an explicit goal through unchanged', () => {
    expect(resolveScoringGoal('revenue', 'lifespan::win-back')).toBe('revenue');
    expect(resolveScoringGoal('engagement', 'session_freq::nudge')).toBe('engagement');
  });
  it("resolves 'both' to the tree that contains the candidate's factor", () => {
    expect(resolveScoringGoal('both', 'lifespan::win-back')).toBe('revenue');
    expect(resolveScoringGoal('both', 'session_freq::nudge')).toBe('engagement');
  });
  it("defaults 'both' to revenue for an unknown factor", () => {
    expect(resolveScoringGoal('both', 'mystery::x')).toBe('revenue');
  });
});

describe('command-center draft store (stub)', () => {
  it('saves and reads a draft by id', () => {
    const draft = scaffoldDraft({ candidate: csCandidate(), segmentId: 'seg-store', gameId: 'cfm_vn', addressableN: 2400, reachablePct: 0.78 });
    saveDraft(draft);
    const read = getDraft(draft.draftId);
    expect(read?.candidateId).toBe('lifespan::win-back');
    expect(read?.cohort.addressableN).toBe(2400);
  });

  it('upsert is idempotent — re-saving updates, never duplicates', () => {
    const first = scaffoldDraft({ candidate: csCandidate(), segmentId: 'seg-idem', gameId: 'cfm_vn', addressableN: 100, reachablePct: 0.5 });
    saveDraft(first);
    const second = scaffoldDraft({ candidate: csCandidate(), segmentId: 'seg-idem', gameId: 'cfm_vn', addressableN: 500, reachablePct: 0.9 });
    saveDraft(second);
    const drafts = listDraftsForSegment('seg-idem');
    expect(drafts).toHaveLength(1);
    expect(drafts[0].cohort.addressableN).toBe(500); // updated to latest
  });

  it('returns null for an unknown draft', () => {
    expect(getDraft('nope::nope')).toBeNull();
  });
});

describe('feedback store', () => {
  it('appends and round-trips feedback', () => {
    recordFeedback({ segmentId: 'seg-fb', gameId: 'cfm_vn', factor: 'lifespan', action: 'dismiss', reason: 'structural' });
    recordFeedback({ segmentId: 'seg-fb', gameId: 'cfm_vn', factor: 'arppu', leverFamily: 'tier-advancement', action: 'pin', reason: 'do this next' });
    const all = listFeedbackForSegment('seg-fb');
    expect(all).toHaveLength(2);
    expect(all.map((f) => f.action).sort()).toEqual(['dismiss', 'pin']);
    const pinned = all.find((f) => f.action === 'pin')!;
    expect(pinned.leverFamily).toBe('tier-advancement');
  });
});
