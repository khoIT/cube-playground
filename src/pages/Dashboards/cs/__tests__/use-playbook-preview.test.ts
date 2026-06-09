/**
 * Tests for use-playbook-preview — the count + per-segment sweep request shapes.
 *
 * All network mocked via vi.stubGlobal('fetch'). Asserts:
 *   1. previewCount POSTs the candidate condition to the per-id preview-count URL
 *      with ?game=, and round-trips { matched, elapsedMs }.
 *   2. previewCount forwards a supplemental predicate when present.
 *   3. sweepSegment POSTs the sweep URL scoped with ?game=&playbook=.
 *   4. both throw on a non-OK response.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { previewCount, sweepSegment } from '../use-playbook-preview';
import type { ThresholdRule } from '../../../../types/threshold-rule';

function mockFetch(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

const ABS_RULE: ThresholdRule = { kind: 'abs', member: 'mf_users.ltv_total_vnd', op: 'gte', value: 50_000_000 };

describe('use-playbook-preview', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('previewCount POSTs the condition to /preview-count with ?game= and returns the count', async () => {
    const fetchMock = mockFetch({ matched: 1240, elapsedMs: 4200, gated: true });
    vi.stubGlobal('fetch', fetchMock);

    const r = await previewCount('cfm_vn', '02', { condition: ABS_RULE });
    expect(r.matched).toBe(1240);
    expect(r.elapsedMs).toBe(4200);
    expect(r.gated).toBe(true);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/care/playbooks/02/preview-count');
    expect(url).toContain('game=cfm_vn');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.condition.kind).toBe('abs');
    expect(body.condition.member).toBe('mf_users.ltv_total_vnd');
  });

  it('previewCount forwards a supplemental predicate when given', async () => {
    const fetchMock = mockFetch({ matched: 12, gated: true });
    vi.stubGlobal('fetch', fetchMock);

    const supplemental = {
      kind: 'group' as const,
      id: 'g1',
      op: 'AND' as const,
      children: [{ kind: 'leaf' as const, id: 'l1', member: 'mf_users.days_since_last_active', type: 'number' as const, op: 'gte' as const, values: [7] }],
    };
    await previewCount('cfm_vn', 'new', { condition: ABS_RULE, supplementalPredicate: supplemental });

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.supplementalPredicate.kind).toBe('group');
    expect(body.supplementalPredicate.children[0].member).toBe('mf_users.days_since_last_active');
  });

  it('sweepSegment POSTs the sweep URL scoped to one playbook', async () => {
    const fetchMock = mockFetch({ game: 'cfm_vn', opened: 3, lapsed: 1, profilesRefreshed: 4, summaries: [] });
    vi.stubGlobal('fetch', fetchMock);

    const r = await sweepSegment('cfm_vn', '02');
    expect(r.opened).toBe(3);
    expect(r.lapsed).toBe(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/care/cases/sweep');
    expect(url).toContain('game=cfm_vn');
    expect(url).toContain('playbook=02');
    expect(init.method).toBe('POST');
  });

  it('previewCount throws on a non-OK response (e.g. 409 unavailable)', async () => {
    vi.stubGlobal('fetch', mockFetch({ error: { code: 'PLAYBOOK_UNAVAILABLE', message: 'no' } }, 409));
    await expect(previewCount('cfm_vn', '06', { condition: ABS_RULE })).rejects.toThrow();
  });

  it('sweepSegment throws on a non-OK response (e.g. 409 busy)', async () => {
    vi.stubGlobal('fetch', mockFetch({ error: { code: 'SWEEP_BUSY', message: 'busy' } }, 409));
    await expect(sweepSegment('cfm_vn', '02')).rejects.toThrow();
  });
});
