/**
 * Workability gates for pregenerated starter questions: tier-1 cheapVerify
 * (pass-through query + preview rows) and the pure SSE summariser the tier-2
 * chat-turn gate folds the stream through.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StarterQuestion } from '../../src/db/starter-questions-store.js';
import type { ToolContext } from '../../src/types.js';

const previewHolder: { result: unknown; error: Error | null } = { result: null, error: null };

vi.mock('../../src/tools/preview-cube-query.js', () => ({
  handler: vi.fn(async () => {
    if (previewHolder.error) throw previewHolder.error;
    return previewHolder.result;
  }),
}));

import {
  cheapVerify,
  summariseSseText,
} from '../../src/scripts/verify-starter-question-workability.js';

const META = {
  cubes: [
    {
      name: 'active_daily',
      measures: [{ name: 'active_daily.dau', type: 'number' }],
      dimensions: [{ name: 'active_daily.log_date', type: 'time' }],
    },
  ],
};
const KNOWN = new Set(['active_daily.dau', 'active_daily.log_date']);
const CTX = { gameId: 'cfm_vn', workspace: 'local' } as ToolContext;

const QUESTION: StarterQuestion = {
  id: 'dau-q',
  text: 'How is DAU trending?',
  topicTags: ['liveops'],
  categoryTags: ['explore'],
  targetCatalogIds: ['active_daily.dau'],
};

describe('cheapVerify', () => {
  beforeEach(() => {
    previewHolder.result = { rows: [{ 'active_daily.dau': 123 }], rowCount: 1 };
    previewHolder.error = null;
  });

  it('passes when the pass-through query returns rows', async () => {
    const res = await cheapVerify(QUESTION, META, KNOWN, {}, CTX);
    expect(res).toEqual({ ok: true, rowCount: 1 });
  });

  it('fails not-composable when a target member is missing from meta', async () => {
    const q = { ...QUESTION, targetCatalogIds: ['ghost_cube.nope'] };
    const res = await cheapVerify(q, META, KNOWN, {}, CTX);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('not-composable');
  });

  it('fails empty-result on zero rows', async () => {
    previewHolder.result = { rows: [], rowCount: 0 };
    const res = await cheapVerify(QUESTION, META, KNOWN, {}, CTX);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('empty-result');
  });

  it('fails empty-result on the single all-zero aggregate row Cube returns for empty ranges', async () => {
    previewHolder.result = { rows: [{ 'active_daily.dau': 0 }], rowCount: 1 };
    const res = await cheapVerify(QUESTION, META, KNOWN, {}, CTX);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('empty-result');
  });

  it('fails query-error when the preview returns Cube error text', async () => {
    previewHolder.result = 'Cube /load failed: 500 — spans 90 days; max 31.';
    const res = await cheapVerify(QUESTION, META, KNOWN, {}, CTX);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('query-error');
  });

  it('fails query-error when the preview handler throws', async () => {
    previewHolder.error = new Error('ECONNREFUSED');
    const res = await cheapVerify(QUESTION, META, KNOWN, {}, CTX);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('query-error');
  });
});

describe('summariseSseText', () => {
  const frame = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

  it('extracts session, artifacts, tool calls, and the done marker', () => {
    const raw =
      frame('session_created', { id: 'sess-1' }) +
      frame('tool_call', { name: 'disambiguate_query' }) +
      frame('query_artifact', { query: { measures: ['a.b'] } }) +
      frame('query_artifact', { query: { measures: ['a.c'] } }) +
      frame('done', {});
    const s = summariseSseText(raw);
    expect(s.sessionId).toBe('sess-1');
    expect(s.artifactCount).toBe(2);
    expect(s.toolCalls).toEqual(['disambiguate_query']);
    expect(s.sawDone).toBe(true);
    expect(s.errorMessage).toBeNull();
  });

  it('captures error events and survives non-JSON data lines', () => {
    const raw =
      frame('session_created', { id: 'sess-2' }) +
      'event: token\ndata: not-json\n\n' +
      frame('error', { message: 'turn timed out' });
    const s = summariseSseText(raw);
    expect(s.errorMessage).toBe('turn timed out');
    expect(s.sawDone).toBe(false);
  });

  it('returns an empty summary for an empty stream (connection died early)', () => {
    const s = summariseSseText('');
    expect(s).toEqual({
      sessionId: null, artifactCount: 0, toolCalls: [], sawDone: false, errorMessage: null,
    });
  });
});
