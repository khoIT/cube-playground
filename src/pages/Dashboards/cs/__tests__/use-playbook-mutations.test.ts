/**
 * Tests for use-playbook-mutations — POST / PATCH / DELETE contract shapes.
 *
 * All network calls mocked via vi.stubGlobal('fetch'). Asserts:
 *   1. createPlaybook   sends POST to /api/care/playbooks?game=<id> with correct body
 *   2. createPlaybook   with base_id=null creates a net-new playbook
 *   3. createPlaybook   with base_id=<seedId> creates an override
 *   4. updatePlaybook   sends PATCH to /api/care/playbooks/:id with partial body
 *   5. deletePlaybook   sends DELETE to /api/care/playbooks/:id, handles 204
 *   6. All three throw on non-OK responses
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPlaybook, updatePlaybook, deletePlaybook } from '../use-playbook-mutations';
import type { CreatePlaybookInput } from '../use-playbook-mutations';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<CreatePlaybookInput> = {}): CreatePlaybookInput {
  return {
    base_id: null,
    name: 'Test Playbook',
    group: 'payment',
    priority: 'cao',
    condition: { kind: 'abs', member: 'mf_users.ltv_vnd', op: 'gte', value: 50_000_000 },
    watchedMetric: { member: 'mf_users.ltv_vnd', label: 'LTV (VND)' },
    action: { text: 'Contact VIP', channels: ['in_game', 'call'], slaMinutes: 720 },
    dataRequirements: ['mf_users.ltv_vnd'],
    ...overrides,
  };
}

function makeOverrideResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ov-001',
    gameId: 'cfm_vn',
    baseId: null,
    name: 'Test Playbook',
    group: 'payment',
    priority: 'cao',
    condition: { kind: 'abs', member: 'mf_users.ltv_vnd', op: 'gte', value: 50_000_000 },
    watchedMetric: { member: 'mf_users.ltv_vnd', label: 'LTV (VND)' },
    action: { text: 'Contact VIP', channels: ['in_game', 'call'], slaMinutes: 720 },
    dataRequirements: ['mf_users.ltv_vnd'],
    enabled: true,
    createdAt: '2026-06-08T00:00:00Z',
    updatedAt: '2026-06-08T00:00:00Z',
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

function mockFetch204() {
  const res = {
    ok: true,
    status: 204,
    headers: { get: () => null },
    json: () => Promise.resolve(null),
    text: () => Promise.resolve(''),
  };
  return vi.fn().mockResolvedValue(res);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createPlaybook', () => {
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

  it('POSTs to /api/care/playbooks?game=<id> with correct body', async () => {
    const resp = makeOverrideResponse();
    const fetchMock = mockFetch(resp, 201);
    vi.stubGlobal('fetch', fetchMock);

    const input = makeInput();
    const result = await createPlaybook('cfm_vn', input);

    expect(result.id).toBe('ov-001');
    expect(result.gameId).toBe('cfm_vn');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/care/playbooks');
    expect(url).toContain('game=cfm_vn');
    expect(init.method).toBe('POST');

    const body = JSON.parse(init.body as string);
    expect(body.name).toBe('Test Playbook');
    expect(body.group).toBe('payment');
    expect(body.priority).toBe('cao');
    expect(body.condition.kind).toBe('abs');
  });

  it('sends base_id=null for a net-new custom playbook', async () => {
    const fetchMock = mockFetch(makeOverrideResponse({ baseId: null }), 201);
    vi.stubGlobal('fetch', fetchMock);

    await createPlaybook('cfm_vn', makeInput({ base_id: null }));

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.base_id).toBeNull();
  });

  it('sends base_id=<seedId> when overriding a seed', async () => {
    const fetchMock = mockFetch(makeOverrideResponse({ baseId: '04' }), 201);
    vi.stubGlobal('fetch', fetchMock);

    await createPlaybook('cfm_vn', makeInput({ base_id: '04' }));

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.base_id).toBe('04');
  });

  it('throws on non-OK response', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ error: { code: 'FORBIDDEN', message: 'Forbidden' } }, 403),
    );

    await expect(createPlaybook('cfm_vn', makeInput())).rejects.toThrow();
  });
});

describe('updatePlaybook', () => {
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

  it('PATCHes /api/care/playbooks/:id with partial body', async () => {
    const updated = makeOverrideResponse({ name: 'Renamed', priority: 'thap' });
    const fetchMock = mockFetch(updated);
    vi.stubGlobal('fetch', fetchMock);

    const result = await updatePlaybook('ov-001', { name: 'Renamed', priority: 'thap' });

    expect(result.name).toBe('Renamed');
    expect(result.priority).toBe('thap');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/care/playbooks/ov-001');
    expect(init.method).toBe('PATCH');

    const body = JSON.parse(init.body as string);
    expect(body.name).toBe('Renamed');
    expect(body.priority).toBe('thap');
    // body must NOT include base_id (partial update, base_id is immutable)
    expect(body.base_id).toBeUndefined();
  });

  it('can disable a playbook via PATCH enabled=false', async () => {
    const fetchMock = mockFetch(makeOverrideResponse({ enabled: false }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await updatePlaybook('ov-001', { enabled: false });

    expect(result.enabled).toBe(false);
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.enabled).toBe(false);
  });

  it('throws on non-OK response', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404),
    );

    await expect(updatePlaybook('ov-999', { name: 'x' })).rejects.toThrow();
  });
});

describe('deletePlaybook', () => {
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

  it('sends DELETE to /api/care/playbooks/:id', async () => {
    const fetchMock = mockFetch204();
    vi.stubGlobal('fetch', fetchMock);

    await deletePlaybook('ov-001');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/care/playbooks/ov-001');
    expect(init.method).toBe('DELETE');
  });

  it('does not throw on 204 No Content', async () => {
    vi.stubGlobal('fetch', mockFetch204());

    await expect(deletePlaybook('ov-001')).resolves.not.toThrow();
  });

  it('throws on non-OK response', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ error: { code: 'FORBIDDEN', message: 'Seeds cannot be deleted' } }, 403),
    );

    await expect(deletePlaybook('seed-01')).rejects.toThrow();
  });
});
