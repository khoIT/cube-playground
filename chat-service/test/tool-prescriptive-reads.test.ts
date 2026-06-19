/**
 * recommend_actions + care_queue + the shared citation builder.
 *
 * Load-bearing behaviors: every recommended action carries a complete citation
 * (engine-sourced as fallback, library-enriched on a confident join), the
 * whole-game scope refuses to invent a cohort size, withheld levers + blind
 * spots are surfaced, care playbooks are annotated by their mapped lever, and
 * every error path returns a machine reason instead of throwing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ToolContext } from '../src/types.js';

vi.mock('../src/services/server-client.js', () => ({
  getJson: vi.fn(),
  postJson: vi.fn(),
  ServerClientError: class ServerClientError extends Error {
    status: number;
    body: unknown;
    constructor(status: number, body: unknown) {
      super(`HTTP ${status}`);
      this.status = status;
      this.body = body;
    }
  },
}));

import * as serverClient from '../src/services/server-client.js';
import { buildCitation, type LibraryResolution } from '../src/tools/recommendation-citation.js';
import { handler as recommend } from '../src/tools/recommend-actions.js';
import { handler as careQueue } from '../src/tools/care-queue.js';

function makeCtx(): ToolContext {
  return {
    ownerId: 'owner1',
    gameId: 'cfm_vn',
    cubeToken: 'Bearer tok',
    workspace: 'local',
    sessionId: 'sess-1',
    turnId: 'sess-1:1',
    sseEmitter: new EventEmitter(),
  };
}

const LIBRARY: LibraryResolution = {
  game: 'cfm_vn',
  genre: 'competitive-fps',
  levers: [
    {
      id: 'fps-first-purchase-conversion',
      lever: 'First-purchase conversion',
      signal: 'payer conversion below norm',
      action: { text: 'welcome offer', mapsToPlaybookIds: ['01'], leverFamily: 'monetization-funnel' },
      defaultWrite: 'case',
      benchmark: { metricKey: 'payer_conversion_rate', external: { value: 3, unit: '%', source: 'S', citation: 'C' }, internal: null },
    },
    {
      id: 'fps-whale-cause-typed-care',
      lever: 'Whale care',
      signal: 'whale revenue concentration shifting',
      action: { text: 'VIP outreach', leverFamily: 'whale-care' },
      defaultWrite: 'case',
      benchmark: { metricKey: 'whale_revenue_share', external: null, internal: { band: 'p50', value: 0.4, computedAt: '2026-06-18' } },
    },
  ],
  withheld: [{ id: 'mmorpg-guild-social-retention', lever: 'Guild retention', missingCubes: ['guild_membership.guild_id'] }],
  blindSpots: [
    {
      id: 'fps-competitive-integrity-cheating',
      lever: 'Cheating integrity',
      signal: 'cheating erodes fair-play retention',
      action: { text: '—', leverFamily: 'competitive-integrity' },
      defaultWrite: 'none',
      blindSpot: true,
      benchmark: { metricKey: 'cheating_incidence', external: null, internal: null },
    },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe('buildCitation', () => {
  it('matches a library lever by mapped playbook id (library-sourced benchmark)', () => {
    const c = buildCitation(
      { opportunityFactor: 'payers', lever: { family: 'first-deposit-followup', actuator: 'cs', description: 'd' }, playbookId: '01' },
      LIBRARY,
    );
    expect(c.libraryMatched).toBe(true);
    expect(c.triggeringSignal).toBe('payer conversion below norm');
    expect(c.benchmark?.external?.source).toBe('S');
    expect(c.defaultWrite).toBe('case');
  });

  it('matches by exact lever family when no playbook id', () => {
    const c = buildCitation(
      { opportunityFactor: 'arppu', lever: { family: 'whale-care', actuator: 'cs', description: 'd' } },
      LIBRARY,
    );
    expect(c.libraryMatched).toBe(true);
    expect(c.benchmark?.internal?.value).toBe(0.4);
  });

  it('falls back to an engine-sourced citation when nothing matches (never uncited)', () => {
    const c = buildCitation(
      { opportunityFactor: 'lifespan', lever: { family: 'session-recovery', actuator: 'system', description: 'rebuild habit' }, rankReason: 'score=120' },
      LIBRARY,
    );
    expect(c.libraryMatched).toBe(false);
    expect(c.benchmark).toBeNull();
    expect(c.triggeringSignal).toBe('score=120');
    // system actuator → experiment write default
    expect(c.defaultWrite).toBe('experiment');
  });

  it('still cites when the library is unavailable (null)', () => {
    const c = buildCitation(
      { opportunityFactor: 'payers', lever: { family: 'win-back', actuator: 'cs', description: 'd' } },
      null,
    );
    expect(c.libraryMatched).toBe(false);
    expect(c.defaultWrite).toBe('case');
  });
});

describe('recommend_actions handler', () => {
  const REC = {
    diagnosis: { opportunities: [] },
    candidates: [
      { id: 'payers::first-deposit-followup', opportunityFactor: 'payers', lever: { family: 'first-deposit-followup', actuator: 'cs', description: 'd' }, playbookId: '01', score: 144, rankReason: 'r', evidenceLink: { source: 'recharge / cfm_vn' } },
    ],
  };

  it('requires addressableN for a whole-game scope (no server call)', async () => {
    const res = await recommend({ game_id: 'cfm_vn', scope_kind: 'game' }, makeCtx());
    expect(res).toMatchObject({ ok: false, reason: 'addressable-n-required' });
    expect(serverClient.postJson).not.toHaveBeenCalled();
  });

  it('cites each candidate and surfaces withheld + blind spots', async () => {
    vi.mocked(serverClient.postJson).mockResolvedValue(REC);
    vi.mocked(serverClient.getJson).mockResolvedValue(LIBRARY);
    const res = await recommend({ game_id: 'cfm_vn', scope_kind: 'game', params: { addressableN: 2400 } }, makeCtx());
    if (!res.ok) throw new Error('expected ok');
    expect(res.candidates[0].citation.libraryMatched).toBe(true);
    expect(res.candidates[0].citation.cubeProvenance).toBe('recharge / cfm_vn');
    expect(res.withheld[0].missingCubes).toContain('guild_membership.guild_id');
    expect(res.blindSpots.map((b) => b.id)).toContain('fps-competitive-integrity-cheating');
  });

  it('still returns cited candidates when the library fetch fails', async () => {
    const { ServerClientError } = await import('../src/services/server-client.js');
    vi.mocked(serverClient.postJson).mockResolvedValue(REC);
    vi.mocked(serverClient.getJson).mockRejectedValue(new ServerClientError(500, {}));
    const res = await recommend({ game_id: 'cfm_vn', scope_kind: 'segment', segment_id: 's1' }, makeCtx());
    if (!res.ok) throw new Error('expected ok');
    expect(res.candidates[0].citation.libraryMatched).toBe(false);
    expect(res.withheld).toEqual([]);
  });

  it('maps 403 → advisor-disabled', async () => {
    const { ServerClientError } = await import('../src/services/server-client.js');
    vi.mocked(serverClient.postJson).mockRejectedValue(new ServerClientError(403, {}));
    const res = await recommend({ game_id: 'cfm_vn', scope_kind: 'segment', segment_id: 's1' }, makeCtx());
    expect(res).toMatchObject({ ok: false, reason: 'advisor-disabled' });
  });
});

describe('care_queue handler', () => {
  const PLAYBOOKS = {
    playbooks: [
      { id: '01', name: 'First deposit', priority: 'tb', availability: 'available', watchedMetric: { kpiTarget: 'second deposit in 7d' }, action: { slaMinutes: 1440 } },
      { id: '05', name: 'Lapsed whale', priority: 'cao', availability: 'unavailable' },
    ],
  };

  it('annotates playbooks with their mapped lever and passes availability through', async () => {
    vi.mocked(serverClient.getJson).mockImplementation(async (path: string) => {
      if (path.startsWith('/api/care/playbooks')) return PLAYBOOKS;
      if (path.startsWith('/api/knowledge/levers')) return LIBRARY;
      throw new Error(`unexpected ${path}`);
    });
    const res = await careQueue({ game_id: 'cfm_vn' }, makeCtx());
    if (!res.ok) throw new Error('expected ok');
    const pb01 = res.playbooks.find((p) => p.id === '01');
    expect(pb01?.lever?.id).toBe('fps-first-purchase-conversion');
    expect(pb01?.kpi).toBe('second deposit in 7d');
    expect(res.playbooks.find((p) => p.id === '05')?.availability).toBe('unavailable');
    expect(res.cases).toBeUndefined();
  });

  it('fetches cases when a status filter is given', async () => {
    vi.mocked(serverClient.getJson).mockImplementation(async (path: string) => {
      if (path.startsWith('/api/care/playbooks')) return PLAYBOOKS;
      if (path.startsWith('/api/knowledge/levers')) return LIBRARY;
      if (path.startsWith('/api/care/cases')) return { cases: [{ id: 'c1', uid: 'u1', playbook_id: '01', status: 'new' }], total: 1 };
      throw new Error(`unexpected ${path}`);
    });
    const res = await careQueue({ game_id: 'cfm_vn', status: 'new' }, makeCtx());
    if (!res.ok) throw new Error('expected ok');
    expect(res.caseTotal).toBe(1);
    expect(res.cases?.[0]).toMatchObject({ id: 'c1', playbookId: '01', status: 'new' });
  });

  it('maps 403 on playbooks → care-forbidden', async () => {
    const { ServerClientError } = await import('../src/services/server-client.js');
    vi.mocked(serverClient.getJson).mockRejectedValue(new ServerClientError(403, {}));
    const res = await careQueue({ game_id: 'cfm_vn' }, makeCtx());
    expect(res).toMatchObject({ ok: false, reason: 'care-forbidden' });
  });
});
