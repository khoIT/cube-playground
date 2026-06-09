/**
 * Tests for cs-case-actions — thin wrappers over patchCareCase that lock the
 * exact PATCH payload shapes for claim, unclaim, and dismiss operations.
 *
 * The reason encoding contract is also tested in both directions so the
 * timeline-decode path and the dismiss-submit path can never silently diverge.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  claimCase,
  unclaimCase,
  dismissCase,
  closeCaseWithOutcome,
  parseDismissReason,
  DISMISS_REASONS,
} from '../cs-case-actions';
import type { CareCase } from '../use-care-cases';

// ── fetch mock ────────────────────────────────────────────────────────────────

function makeCase(overrides: Partial<CareCase> = {}): CareCase {
  return {
    id: 'c1',
    game_id: 'cfm_vn',
    playbook_id: 'pb1',
    uid: 'u1',
    source: 'membership',
    opened_at: '2026-06-01T10:00:00Z',
    stats_snapshot_json: null,
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

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── claimCase ─────────────────────────────────────────────────────────────────

describe('claimCase', () => {
  it('PATCHes {assignee: me} to the correct case URL', async () => {
    const updated = makeCase({ assignee: 'agent1' });
    const fetchMock = mockFetch(updated);
    vi.stubGlobal('fetch', fetchMock);

    const result = await claimCase('c1', 'agent1');

    expect(result.assignee).toBe('agent1');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/care/cases/c1');
    expect(init.method).toBe('PATCH');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ assignee: 'agent1' });
  });

  it('does NOT set status or any other field', async () => {
    const fetchMock = mockFetch(makeCase({ assignee: 'agent2' }));
    vi.stubGlobal('fetch', fetchMock);

    await claimCase('c1', 'agent2');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    // Only assignee; no status, no notes, no other fields.
    expect(Object.keys(body)).toEqual(['assignee']);
  });
});

// ── unclaimCase ───────────────────────────────────────────────────────────────

describe('unclaimCase', () => {
  it('PATCHes {assignee: null} — nullable field clears the owner', async () => {
    const fetchMock = mockFetch(makeCase({ assignee: null }));
    vi.stubGlobal('fetch', fetchMock);

    await unclaimCase('c1');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/care/cases/c1');
    const body = JSON.parse(init.body as string);
    // assignee must be explicitly null so the server clears the field.
    expect(body).toHaveProperty('assignee', null);
  });
});

// ── dismissCase ───────────────────────────────────────────────────────────────

describe('dismissCase', () => {
  it('PATCHes {status:"dismissed", notes:"reason:false_positive"} for false_positive', async () => {
    const fetchMock = mockFetch(makeCase({ status: 'dismissed', notes: 'reason:false_positive' }));
    vi.stubGlobal('fetch', fetchMock);

    await dismissCase('c1', 'false_positive');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/care/cases/c1');
    const body = JSON.parse(init.body as string);
    expect(body.status).toBe('dismissed');
    expect(body.notes).toBe('reason:false_positive');
  });

  it('encodes "not_now" reason correctly', async () => {
    const fetchMock = mockFetch(makeCase({ status: 'dismissed', notes: 'reason:not_now' }));
    vi.stubGlobal('fetch', fetchMock);

    await dismissCase('c1', 'not_now');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.notes).toBe('reason:not_now');
  });

  it('encodes "already_handled" reason correctly', async () => {
    const fetchMock = mockFetch(makeCase({ status: 'dismissed', notes: 'reason:already_handled' }));
    vi.stubGlobal('fetch', fetchMock);

    await dismissCase('c1', 'already_handled');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.notes).toBe('reason:already_handled');
  });

  it('encodes "ineligible" reason correctly', async () => {
    const fetchMock = mockFetch(makeCase({ status: 'dismissed', notes: 'reason:ineligible' }));
    vi.stubGlobal('fetch', fetchMock);

    await dismissCase('c1', 'ineligible');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.notes).toBe('reason:ineligible');
  });

  it('sets status to "dismissed" for all reason codes', async () => {
    for (const code of Object.keys(DISMISS_REASONS) as (keyof typeof DISMISS_REASONS)[]) {
      const fetchMock = mockFetch(makeCase({ status: 'dismissed' }));
      vi.stubGlobal('fetch', fetchMock);

      await dismissCase('c1', code);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.status).toBe('dismissed');
      vi.unstubAllGlobals();
      vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
    }
  });
});

// ── parseDismissReason ────────────────────────────────────────────────────────

describe('parseDismissReason', () => {
  it('decodes "reason:false_positive" → "false_positive"', () => {
    expect(parseDismissReason('reason:false_positive')).toBe('false_positive');
  });

  it('decodes "reason:not_now" → "not_now"', () => {
    expect(parseDismissReason('reason:not_now')).toBe('not_now');
  });

  it('decodes "reason:already_handled" → "already_handled"', () => {
    expect(parseDismissReason('reason:already_handled')).toBe('already_handled');
  });

  it('decodes "reason:ineligible" → "ineligible"', () => {
    expect(parseDismissReason('reason:ineligible')).toBe('ineligible');
  });

  it('returns null for notes without the reason: prefix', () => {
    expect(parseDismissReason('some free text')).toBeNull();
  });

  it('returns null for null or undefined notes', () => {
    expect(parseDismissReason(null)).toBeNull();
    expect(parseDismissReason(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseDismissReason('')).toBeNull();
  });

  it('round-trips: all DISMISS_REASONS keys encode and decode back to themselves', () => {
    for (const code of Object.keys(DISMISS_REASONS) as (keyof typeof DISMISS_REASONS)[]) {
      const encoded = `reason:${code}`;
      expect(parseDismissReason(encoded)).toBe(code);
    }
  });
});

// ── closeCaseWithOutcome ──────────────────────────────────────────────────────

describe('closeCaseWithOutcome', () => {
  it('PATCHes {status:"resolved", outcome:"kpi_met"} for kpi_met', async () => {
    const updated = makeCase({ status: 'resolved', outcome: 'kpi_met' });
    const fetchMock = mockFetch(updated);
    vi.stubGlobal('fetch', fetchMock);

    await closeCaseWithOutcome('c1', 'kpi_met');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/care/cases/c1');
    expect(init.method).toBe('PATCH');
    const body = JSON.parse(init.body as string);
    expect(body.status).toBe('resolved');
    expect(body.outcome).toBe('kpi_met');
  });

  it('PATCHes {status:"resolved", outcome:"kpi_missed"} for kpi_missed', async () => {
    const updated = makeCase({ status: 'resolved', outcome: 'kpi_missed' });
    const fetchMock = mockFetch(updated);
    vi.stubGlobal('fetch', fetchMock);

    await closeCaseWithOutcome('c1', 'kpi_missed');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.status).toBe('resolved');
    expect(body.outcome).toBe('kpi_missed');
  });

  it('sends only status and outcome — no other fields', async () => {
    const fetchMock = mockFetch(makeCase({ status: 'resolved', outcome: 'kpi_met' }));
    vi.stubGlobal('fetch', fetchMock);

    await closeCaseWithOutcome('c1', 'kpi_met');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    // Guard: only status + outcome; no notes, assignee, or other fields.
    expect(Object.keys(body).sort()).toEqual(['outcome', 'status']);
  });
});

// ── DISMISS_REASONS labels ────────────────────────────────────────────────────

describe('DISMISS_REASONS labels', () => {
  it('has labels for all four reason codes', () => {
    const keys = Object.keys(DISMISS_REASONS);
    expect(keys).toContain('false_positive');
    expect(keys).toContain('not_now');
    expect(keys).toContain('already_handled');
    expect(keys).toContain('ineligible');
    expect(keys).toHaveLength(4);
  });

  it('all labels are non-empty strings', () => {
    for (const label of Object.values(DISMISS_REASONS)) {
      expect(typeof label).toBe('string');
      expect((label as string).length).toBeGreaterThan(0);
    }
  });
});
