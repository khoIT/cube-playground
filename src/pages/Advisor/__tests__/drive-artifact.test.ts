/**
 * fetchDriveArtifact wraps the most-recent segment draft as the Drive→Decide
 * hand-off artifact, narrows the agent goal to a Decide GoalKey, and returns
 * null when the agent hasn't scaffolded a draft yet.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExperimentDraft } from '../../../api/advisor';

vi.mock('../../../api/advisor', () => ({
  listDrafts: vi.fn(),
}));

import { listDrafts } from '../../../api/advisor';
import { fetchDriveArtifact } from '../drive-artifact';

function draft(id: string): ExperimentDraft {
  return {
    draftId: id,
    segmentId: 'seg-1',
    gameId: 'cfm_vn',
    candidateId: 'lifespan::win-back',
    status: 'draft',
    hypothesis: 'they drift after week 2',
    cohort: { segmentId: 'seg-1', addressableN: 2400, reachablePct: 0.78 },
    arms: [
      { key: 'treatment', label: 'Treatment', share: 0.8 },
      { key: 'holdout', label: 'Hold-out (measured)', share: 0.2 },
    ],
    windowDays: 14,
    power: { status: 'powered', mde: 4.2, detail: 'N=2400 → ≥4.2pp' },
    expectedEffect: { value: 0.06, confidence: 'assumption', source: 'game-ops default' },
    money: { incrementalVnd: null, perUnitVnd: null, note: 'TBD' },
    feasibility: { status: 'feasible', lever: { family: 'win-back', actuator: 'cs', description: 'CS win-back' } },
    delivery: 'cs-queue',
    safety: { contactCapPerPlayer: 1, recentPayerGuardDays: 7, holdoutMeasured: true },
    opportunityFactor: 'lifespan',
    blueprint: { opportunity: 'lifespan', target: '2,400 addressable', cause: 'drift', lever: 'win-back', proof: 'powered' },
    readout: { primaryMetric: 'lifespan', mde: 4.2, horizonDays: 14, holdoutPct: 20, decisionRule: 'Ship if ≥4.2pp' },
  };
}

describe('fetchDriveArtifact', () => {
  beforeEach(() => vi.mocked(listDrafts).mockReset());

  it('wraps the newest segment draft and narrows the goal', async () => {
    vi.mocked(listDrafts).mockResolvedValue({ drafts: [draft('seg-1::a'), draft('seg-1::b')] });
    const artifact = await fetchDriveArtifact({ segmentId: 'seg-1', gameId: 'cfm_vn', goal: 'both', sessionId: 'sess-9' });
    expect(artifact).not.toBeNull();
    expect(artifact!.source).toBe('drive');
    expect(artifact!.draft.draftId).toBe('seg-1::a'); // store orders newest-first
    expect(artifact!.goal).toBe('revenue'); // 'both' → revenue
    expect(artifact!.sessionId).toBe('sess-9');
  });

  it('maps engagement goal through unchanged', async () => {
    vi.mocked(listDrafts).mockResolvedValue({ drafts: [draft('seg-1::a')] });
    const artifact = await fetchDriveArtifact({ segmentId: 'seg-1', gameId: 'cfm_vn', goal: 'engagement', sessionId: null });
    expect(artifact!.goal).toBe('engagement');
  });

  it('returns null when no draft has been scaffolded yet', async () => {
    vi.mocked(listDrafts).mockResolvedValue({ drafts: [] });
    const artifact = await fetchDriveArtifact({ segmentId: 'seg-1', gameId: 'cfm_vn', goal: 'revenue', sessionId: null });
    expect(artifact).toBeNull();
  });
});
