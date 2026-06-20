/**
 * Reload rehydration for COMBINED dual-axis artifacts: the persisted-replay
 * reconstruction must carry `overlay` + `combined` through to the rendered
 * artifact. "Open in Playground" reads exactly those two fields to write the
 * sibling overlay sessionStorage key; if the reconstruction drops them, a
 * reloaded thread opens the artifact with the primary metric only — the
 * overlay (right-axis line, e.g. revenue) silently vanishes in the builder.
 *
 * Live streaming passes the artifact object through whole, so the bug only
 * surfaced after a thread reload — hence this guard exercises the mapper.
 */
import { describe, it, expect } from 'vitest';
import { sessionTurnsToMessages } from '../chat-thread-page';

type Turn = Parameters<typeof sessionTurnsToMessages>[0][number];

const primaryQuery = {
  measures: ['active_daily.paying_dau'],
  timeDimensions: [{ dimension: 'active_daily.log_date', granularity: 'day', dateRange: ['2026-06-11', '2026-06-18'] }],
};
const overlayQuery = {
  measures: ['user_recharge_daily.revenue_vnd_total'],
  timeDimensions: [{ dimension: 'user_recharge_daily.log_date', granularity: 'day', dateRange: ['2026-06-11', '2026-06-18'] }],
};

const combinedTurn: Turn = {
  id: 'a1',
  role: 'assistant',
  text: 'Paying DAU vs revenue',
  createdAt: '2026-06-20T05:02:13Z',
  artifacts: [
    {
      id: '96c1372d-dda0-435c-b10e-fe91363e50e7',
      title: 'Paying DAU vs Revenue',
      summary: 'Overlaid on one date axis.',
      deeplinkUrl: '#/build?from-chat-artifact=96c1372d-dda0-435c-b10e-fe91363e50e7&combined=1',
      deeplinkVia: 'session-storage',
      source: 'business-metric',
      payload: primaryQuery,
      query: primaryQuery,
      overlay: overlayQuery,
      combined: true,
      game: 'cfm_vn',
    },
  ],
};

describe('sessionTurnsToMessages — combined artifact rehydrate', () => {
  it('preserves overlay + combined so Open-in-Playground can write the sibling key', () => {
    const [msg] = sessionTurnsToMessages([combinedTurn]);
    if (msg.role !== 'assistant') throw new Error('expected assistant');
    const section = msg.sections.find((s) => s.type === 'query_artifact');
    if (!section || section.type !== 'query_artifact') throw new Error('expected query_artifact section');
    expect(section.artifact.combined).toBe(true);
    expect(section.artifact.overlay).toEqual(overlayQuery);
    // Game must survive replay so the deeplink can pin it (else the overlay
    // /load goes out game-less and the multi-tenant cube rejects it).
    expect(section.artifact.game).toBe('cfm_vn');
    // Primary stays a runnable single CubeQuery for graceful degrade.
    expect(section.artifact.query).toEqual(primaryQuery);
  });

  it('leaves overlay/combined undefined for a plain single-metric artifact', () => {
    const plain: Turn = {
      ...combinedTurn,
      artifacts: [{ ...combinedTurn.artifacts![0], overlay: undefined, combined: undefined }],
    };
    const [msg] = sessionTurnsToMessages([plain]);
    if (msg.role !== 'assistant') throw new Error('expected assistant');
    const section = msg.sections.find((s) => s.type === 'query_artifact');
    if (!section || section.type !== 'query_artifact') throw new Error('expected query_artifact section');
    expect(section.artifact.combined).toBeUndefined();
    expect(section.artifact.overlay).toBeUndefined();
  });
});
