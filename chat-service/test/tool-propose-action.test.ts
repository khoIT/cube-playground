/**
 * propose_action — the confirm-gated proposer.
 *
 * Load-bearing invariant: it emits an `action_proposal` SSE event and NEVER
 * writes. Guards reject a non-actionable factor, a kind inconsistent with the
 * lever's write default, and a care case with no playbook. Sweep/experiment
 * carry two confirm steps; a single care case carries one.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ToolContext } from '../src/types.js';
import { handler } from '../src/tools/propose-action.js';

let emitter: EventEmitter;
let emitted: Array<{ event: string; data: unknown }>;

function makeCtx(): ToolContext {
  return {
    ownerId: 'owner1',
    gameId: 'cfm_vn',
    cubeToken: 'Bearer tok',
    workspace: 'local',
    sessionId: 'sess-1',
    turnId: 'sess-1:1',
    sseEmitter: emitter,
  };
}

const citation = (defaultWrite: 'case' | 'sweep' | 'experiment' | 'none') => ({
  sourceEngine: 'advisor/recommend',
  triggeringSignal: 'payer conversion below norm',
  benchmark: { internal: null, external: { value: 3, unit: '%', source: 'S', citation: 'C' } },
  defaultWrite,
});

beforeEach(() => {
  emitter = new EventEmitter();
  emitted = [];
  emitter.on('action_proposal', (data) => emitted.push({ event: 'action_proposal', data }));
});

describe('propose_action — emit-only proposer', () => {
  it('emits an action_proposal for a valid care case (one confirm) and never writes', async () => {
    const res = await handler(
      {
        game_id: 'cfm_vn',
        kind: 'care_case',
        lever_family: 'monetization-funnel',
        playbook_id: '01',
        title: 'Open first-deposit care case',
        summary: 'payer conversion below norm — welcome offer',
        recommendation: { citation: citation('case') },
      },
      makeCtx(),
    );
    expect(res).toMatchObject({ ok: true, proposal_emitted: true, kind: 'care_case' });
    expect(emitted).toHaveLength(1);
    const data = emitted[0].data as { confirmSteps: number; citation: { triggeringSignal: string } };
    expect(data.confirmSteps).toBe(1);
    expect(data.citation.triggeringSignal).toBe('payer conversion below norm');
  });

  it('marks sweep and experiment as two-step confirms', async () => {
    await handler(
      { game_id: 'cfm_vn', kind: 'sweep', lever_family: 'whale-care', title: 't', summary: 's', recommendation: { citation: citation('sweep') } },
      makeCtx(),
    );
    await handler(
      { game_id: 'cfm_vn', kind: 'experiment', lever_family: 'progression-tuning', title: 't', summary: 's', recommendation: { citation: citation('experiment') } },
      makeCtx(),
    );
    expect((emitted[0].data as { confirmSteps: number }).confirmSteps).toBe(2);
    expect((emitted[1].data as { confirmSteps: number }).confirmSteps).toBe(2);
  });

  it('refuses a non-actionable (defaultWrite="none") factor — no emit', async () => {
    const res = await handler(
      { game_id: 'cfm_vn', kind: 'care_case', lever_family: 'competitive-integrity', playbook_id: '01', title: 't', summary: 's', recommendation: { citation: citation('none') } },
      makeCtx(),
    );
    expect(res).toMatchObject({ ok: false, reason: 'not-actionable' });
    expect(emitted).toHaveLength(0);
  });

  it('rejects a kind inconsistent with the write default — no emit', async () => {
    const res = await handler(
      { game_id: 'cfm_vn', kind: 'experiment', lever_family: 'monetization-funnel', title: 't', summary: 's', recommendation: { citation: citation('case') } },
      makeCtx(),
    );
    expect(res).toMatchObject({ ok: false, reason: 'kind-mismatch' });
    expect(emitted).toHaveLength(0);
  });

  it('requires a playbook id for a care case', async () => {
    const res = await handler(
      { game_id: 'cfm_vn', kind: 'care_case', lever_family: 'monetization-funnel', title: 't', summary: 's', recommendation: { citation: citation('case') } },
      makeCtx(),
    );
    expect(res).toMatchObject({ ok: false, reason: 'missing-playbook' });
    expect(emitted).toHaveLength(0);
  });
});
