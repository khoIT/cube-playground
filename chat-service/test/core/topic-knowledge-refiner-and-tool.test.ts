/**
 * Topic knowledge bank: LLM output parsing/validation (questions wholesale-
 * rejected on invented members, metrics dropped row-by-row) and the
 * get_topic_knowledge tool's seed-backed serving.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseAndValidateLlmSet } from '../../src/core/starter-question-refiner.js';
import {
  buildKnowledgePrompt,
  parseKnowledgeSet,
} from '../../src/core/topic-knowledge-refiner.js';
import type { ToolContext } from '../../src/types.js';

const KNOWN = new Set(['recharge.revenue_vnd', 'recharge.recharge_date', 'mf_users.user_id']);
const MEASURES = new Set(['recharge.revenue_vnd']);

const validate = (raw: string) => parseAndValidateLlmSet(raw, KNOWN);

const q = (over: Record<string, unknown> = {}) => ({
  id: 'rev-trend',
  text: 'How has revenue trended?',
  topicTags: ['monetization'],
  categoryTags: ['explore'],
  targetCatalogIds: ['recharge.revenue_vnd'],
  ...over,
});
const metric = (over: Record<string, unknown> = {}) => ({
  member: 'recharge.revenue_vnd',
  title: 'Revenue (VND)',
  why: 'Tracks daily gross — the topline every publisher decision anchors on.',
  topic: 'monetization',
  ...over,
});

describe('parseKnowledgeSet', () => {
  it('parses a valid object and keeps valid metrics', () => {
    const raw = JSON.stringify({ questions: [q(), q({ id: 'q2' }), q({ id: 'q3' })], metrics: [metric()] });
    const out = parseKnowledgeSet(raw, validate, MEASURES)!;
    expect(out.questions).toHaveLength(3);
    expect(out.metrics).toEqual([
      { member: 'recharge.revenue_vnd', title: 'Revenue (VND)', why: expect.any(String), topic: 'monetization' },
    ]);
    expect(out.droppedMetrics).toBe(0);
  });

  it('drops metric rows with invented members or bad topics, counting them', () => {
    const raw = JSON.stringify({
      questions: [q(), q({ id: 'q2' }), q({ id: 'q3' })],
      metrics: [
        metric(),
        metric({ member: 'recharge.fabricated' }),
        metric({ member: 'recharge.recharge_date' }), // dimension, not a measure
        metric({ topic: 'finance' }),
      ],
    });
    const out = parseKnowledgeSet(raw, validate, MEASURES)!;
    expect(out.metrics).toHaveLength(1);
    expect(out.droppedMetrics).toBe(3);
  });

  it('rejects the whole set when a question invents a member', () => {
    const raw = JSON.stringify({
      questions: [q(), q({ id: 'q2' }), q({ id: 'bad', targetCatalogIds: ['ghost.member'] })],
      metrics: [metric()],
    });
    expect(parseKnowledgeSet(raw, validate, MEASURES)).toBeNull();
  });

  it('rejects non-object / missing arrays / unparseable payloads', () => {
    expect(parseKnowledgeSet('not json', validate, MEASURES)).toBeNull();
    expect(parseKnowledgeSet(JSON.stringify({ questions: [] }), validate, MEASURES)).toBeNull();
  });

  it('prompt embeds shipped questions and per-topic quotas', () => {
    const prompt = buildKnowledgePrompt(
      [{ cube: 'recharge', member: 'recharge.revenue_vnd', kind: 'measure' }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [q() as any],
      { 'recharge.recharge_date': '2026-06-04' },
      '2026-06-06',
    );
    expect(prompt).toContain('How has revenue trended?');
    expect(prompt).toContain('EXACTLY 10 questions PER TOPIC');
    expect(prompt).toContain('Up to 8 metrics PER TOPIC');
    // Same headline-style contract as the starter chips.
    expect(prompt).toContain('Top 5 acquisition channels by 30-day LTV');
    expect(prompt).toContain('at most 100 characters');
  });
});

describe('get_topic_knowledge tool', () => {
  afterEach(() => vi.resetModules());

  it('serves the seed entry for the active game, filtered by topic', async () => {
    vi.doMock('../../src/db/game-topic-knowledge-seed.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/db/game-topic-knowledge-seed.js')>();
      return {
        ...actual,
        getKnowledgeEntry: () => ({
          generatedAt: 1,
          coverage: { 'recharge.recharge_date': '2026-06-04' },
          topics: {
            liveops: { questions: [], metrics: [] },
            user_acquisition: { questions: [], metrics: [] },
            monetization: { questions: [{ id: 'a', text: 'x', targetCatalogIds: [] }], metrics: [metric()] },
          },
        }),
      };
    });
    const { handler } = await import('../../src/tools/get-topic-knowledge.js');
    const out = (await handler({ topic: 'monetization' }, { gameId: 'cfm_vn' } as ToolContext)) as {
      found: boolean; topics: Record<string, unknown>;
    };
    expect(out.found).toBe(true);
    expect(Object.keys(out.topics)).toEqual(['monetization']);
  });

  it('reports not-found honestly when the game has no bank', async () => {
    vi.doMock('../../src/db/game-topic-knowledge-seed.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/db/game-topic-knowledge-seed.js')>();
      return { ...actual, getKnowledgeEntry: () => null };
    });
    const { handler } = await import('../../src/tools/get-topic-knowledge.js');
    const out = (await handler({}, { gameId: 'nope' } as ToolContext)) as { found: boolean };
    expect(out.found).toBe(false);
  });
});
