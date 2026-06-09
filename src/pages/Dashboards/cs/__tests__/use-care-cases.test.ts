/**
 * Tests for use-care-cases — by-vip dedup shape + PATCH helper contract.
 *
 * All network calls are intercepted via vi.stubGlobal / fetch mock so no
 * real server is needed. The tests assert:
 *   1. useVipQueue maps the server shape correctly (uid, caseCount, playbooks).
 *   2. A VIP in 2 playbooks produces ONE row with 2 case chips.
 *   3. patchCareCase forwards the correct method/body/path.
 *   4. useCareCases (by-playbook) passes the playbook query param.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useVipQueue, useCareCases, patchCareCase } from '../use-care-cases';
import type { VipCaseRow, CareCase } from '../use-care-cases';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeCase(overrides: Partial<CareCase> = {}): CareCase {
  return {
    id: 'c1',
    game_id: 'cfm_vn',
    playbook_id: 'pb1',
    uid: 'u1',
    source: 'membership',
    opened_at: '2026-06-01T10:00:00Z',
    stats_snapshot_json: '{"ltv_vnd":5000000}',
    status: 'new',
    condition_lapsed: 0,
    assignee: null,
    treated_at: null,
    channel_used: null,
    action_taken: null,
    notes: null,
    kpi_target: null,
    kpi_eval_at: null,
    outcome: null,
    ...overrides,
  };
}

function makeVipRow(overrides: Partial<VipCaseRow> = {}): VipCaseRow {
  return {
    uid: 'u1',
    caseCount: 2,
    playbookIds: ['pb1', 'pb2'],
    cases: [
      makeCase({ id: 'c1', playbook_id: 'pb1' }),
      makeCase({ id: 'c2', playbook_id: 'pb2' }),
    ],
    lastTreatedAt: null,
    topPriority: 1,
    playbooks: [
      { id: 'pb1', name: 'High Roller Drop', priority: 1 },
      { id: 'pb2', name: 'Churn Risk', priority: 3 },
    ],
    ...overrides,
  };
}

// ── fetch mock helpers ────────────────────────────────────────────────────────

function mockFetch(data: unknown, status = 200) {
  const res = {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
  return vi.fn().mockResolvedValue(res);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useVipQueue', () => {
  beforeEach(() => {
    // Stub localStorage to satisfy apiFetch headers (getOwner, readAppToken).
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads and exposes by-vip rows', async () => {
    const vipRow = makeVipRow();
    vi.stubGlobal('fetch', mockFetch({ vips: [vipRow] }));

    const { result } = renderHook(() => useVipQueue('cfm_vn'));

    await waitFor(() => expect(result.current.status).toBe('success'));

    expect(result.current.vips).toHaveLength(1);
    const row = result.current.vips[0];
    expect(row.uid).toBe('u1');
    expect(row.caseCount).toBe(2);
    expect(row.playbooks).toHaveLength(2);
  });

  it('a VIP in 2 playbooks produces ONE row with 2 playbook refs', async () => {
    // Server already deduplicates — we verify the hook forwards the shape unmodified.
    const vipRow = makeVipRow();
    vi.stubGlobal('fetch', mockFetch({ vips: [vipRow] }));

    const { result } = renderHook(() => useVipQueue('cfm_vn'));
    await waitFor(() => expect(result.current.status).toBe('success'));

    // Single VIP row.
    expect(result.current.vips).toHaveLength(1);
    // Both playbook chip refs present.
    const playbookIds = result.current.vips[0].playbooks.map((p) => p.id);
    expect(playbookIds).toContain('pb1');
    expect(playbookIds).toContain('pb2');
    // Both cases inside.
    expect(result.current.vips[0].cases).toHaveLength(2);
  });

  it('surfaces error state on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const { result } = renderHook(() => useVipQueue('cfm_vn'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toMatch(/Network error/);
  });

  it('returns empty list when server returns empty vips array', async () => {
    vi.stubGlobal('fetch', mockFetch({ vips: [] }));

    const { result } = renderHook(() => useVipQueue('cfm_vn'));
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.vips).toHaveLength(0);
  });

  it('does not fetch when gameId is empty', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useVipQueue(''));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('useCareCases (by-playbook)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('passes playbook query param when provided', async () => {
    const fetchMock = mockFetch({ cases: [makeCase()] });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useCareCases('cfm_vn', { playbookId: 'pb1' }));
    await waitFor(() => expect(result.current.status).toBe('success'));

    const calledUrl: string = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('playbook=pb1');
    expect(calledUrl).toContain('game=cfm_vn');
  });

  it('loads cases without playbook filter when playbookId omitted', async () => {
    const fetchMock = mockFetch({ cases: [makeCase()] });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useCareCases('cfm_vn'));
    await waitFor(() => expect(result.current.status).toBe('success'));

    const calledUrl: string = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).not.toContain('playbook=');
    expect(result.current.cases).toHaveLength(1);
  });

  it('joins playbookIds into a comma param (multi-select)', async () => {
    const fetchMock = mockFetch({ cases: [makeCase()] });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useCareCases('cfm_vn', { playbookIds: ['01', '04', '14'] }));
    await waitFor(() => expect(result.current.status).toBe('success'));

    const calledUrl: string = fetchMock.mock.calls[0][0] as string;
    // URLSearchParams encodes commas as %2C.
    expect(decodeURIComponent(calledUrl)).toContain('playbook=01,04,14');
  });

  it('omits playbook param when playbookIds is empty (all playbooks)', async () => {
    const fetchMock = mockFetch({ cases: [makeCase()] });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useCareCases('cfm_vn', { playbookIds: [] }));
    await waitFor(() => expect(result.current.status).toBe('success'));

    const calledUrl: string = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).not.toContain('playbook=');
  });
});

describe('useVipQueue search (q=)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('forwards a trimmed q param when searching', async () => {
    const fetchMock = mockFetch({ vips: [] });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useVipQueue('cfm_vn', { q: '  dragon  ' }));
    await waitFor(() => expect(result.current.status).toBe('success'));

    const calledUrl: string = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('q=dragon');
  });

  it('omits q when the search is blank', async () => {
    const fetchMock = mockFetch({ vips: [] });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useVipQueue('cfm_vn', { q: '   ' }));
    await waitFor(() => expect(result.current.status).toBe('success'));

    const calledUrl: string = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).not.toContain('q=');
  });
});

describe('patchCareCase', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends PATCH to the correct URL with the patch body', async () => {
    const updated = makeCase({ status: 'treated', channel_used: 'zalo' });
    const fetchMock = mockFetch(updated);
    vi.stubGlobal('fetch', fetchMock);

    const result = await patchCareCase('c1', { status: 'treated', channel_used: 'zalo' });

    expect(result.status).toBe('treated');
    expect(result.channel_used).toBe('zalo');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/care/cases/c1');
    expect(init.method).toBe('PATCH');
    const body = JSON.parse(init.body as string);
    expect(body.status).toBe('treated');
    expect(body.channel_used).toBe('zalo');
  });

  it('throws on non-OK response', async () => {
    vi.stubGlobal('fetch', mockFetch({ error: { code: 'FORBIDDEN', message: 'Forbidden' } }, 403));

    await expect(patchCareCase('c1', { status: 'treated' })).rejects.toThrow();
  });
});
