/**
 * disambiguate_query under a /meta outage (gateway or Cube upstream down).
 *
 * Regression for session 4929a3e9: with /meta unreachable the starter
 * pass-through and member gate silently skipped, and an unresolvable message
 * got an off-topic canned metric menu. The handler must now:
 *   - always surface the outage in `warnings` + `metaUnavailable: true`;
 *   - replace the canned options with an honest "temporarily unavailable,
 *     retry" clarification when the metric also failed to resolve;
 *   - NOT emit off-topic disambig_options chips in that state;
 *   - still auto-route (degraded, ungated) when the glossary resolves alone.
 */

import { EventEmitter } from 'node:events';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

const { GLOSSARY } = vi.hoisted(() => ({
  GLOSSARY: [
    {
      id: 'revenue',
      label: 'Revenue',
      labelVi: 'Doanh thu',
      description: '',
      primaryCatalogId: 'recharge.revenue_vnd',
      aliases: ['revenue', 'total revenue'],
      aliasesVi: ['doanh thu'],
      category: 'monetisation',
      measureRef: 'recharge.revenue_vnd',
      refKind: 'measure',
    },
  ],
}));

vi.mock('../../src/core/cube-meta-cache.js', () => ({
  getMeta: vi.fn(async () => {
    throw new Error('Failed to fetch /meta for workspace=local game=cfm_vn: 502 Bad Gateway');
  }),
  extractMemberNames: vi.fn(() => new Set<string>()),
}));

vi.mock('../../src/nl-to-query/glossary-client.js', () => ({
  fetchOfficialGlossary: vi.fn(async () => GLOSSARY),
  __resetGlossaryCache: vi.fn(),
}));

vi.mock('../../src/config.js', () => ({
  config: {
    disambigAutoThreshold: 0.75,
    chatGlossaryLegacy: false,
    chatGlossaryAutorouteThreshold: 0.8,
  },
  isLangfuseEnabled: () => false,
}));

import { handler as disambiguateHandler } from '../../src/tools/disambiguate-query.js';
import { migrate } from '../../src/db/migrate.js';
import type { ToolContext } from '../../src/types.js';

function makeCtx(): ToolContext {
  const db = new Database(':memory:');
  migrate(db);
  return {
    ownerId: 'o1',
    gameId: 'cfm_vn',
    cubeToken: 'tok',
    workspace: 'local',
    sessionId: 's1',
    turnId: 't1',
    db,
    disambiguationMode: 'targeted',
    sseEmitter: new EventEmitter(),
  } as ToolContext;
}

describe('disambiguate_query — /meta unavailable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('unresolvable message → honest retry clarification, no canned metric menu', async () => {
    const out = await disambiguateHandler(
      {
        message:
          'Show a login-volume heatmap by hour of day vs day of week — when are CFM VN players most and least active throughout the week?',
      },
      makeCtx(),
    );

    expect(out.action).toBe('clarify');
    expect(out.metaUnavailable).toBe(true);
    expect(out.warnings.some((w) => w.startsWith('cube meta unavailable'))).toBe(true);
    // One clarification: the outage notice — not the glossary metric menu.
    expect(out.clarifications).toHaveLength(1);
    expect(out.clarifications[0].question_en).toMatch(/temporarily unavailable/i);
    expect(out.clarifications[0].options).toBeUndefined();
  });

  it('does not emit off-topic disambig_options chips during the outage', async () => {
    const ctx = makeCtx();
    const emitted: string[] = [];
    (ctx.sseEmitter as EventEmitter).on('disambig_options', () => emitted.push('disambig_options'));

    await disambiguateHandler({ message: 'Show a login-volume heatmap by hour of day' }, ctx);

    expect(emitted).toHaveLength(0);
  });

  it('glossary-resolvable message still auto-routes (degraded, member gate skipped)', async () => {
    const out = await disambiguateHandler(
      { message: 'revenue last 7 days' },
      makeCtx(),
    );

    expect(out.action).toBe('auto');
    expect(out.slots.metric.value).toBe('recharge.revenue_vnd');
    expect(out.metaUnavailable).toBe(true);
    expect(out.warnings.some((w) => w.startsWith('cube meta unavailable'))).toBe(true);
    // Resolved fine — the outage must not inject a retry clarification.
    expect(out.clarifications).toHaveLength(0);
  });
});
