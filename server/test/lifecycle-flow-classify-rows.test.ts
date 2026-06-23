/**
 * Lifecycle state classification — classifyRows() unit tests.
 *
 * classifyRows is not exported; we test it through fetchLifecycleFlow() with
 * a mocked cube-client so no live Cube is touched. Each test drives a specific
 * lifecycle_stage × is_paying_user combination and asserts the 5-state output.
 *
 * Priority order encoded in classifyRows: New > Reactivated > Core > Lapsing > Churned
 * Non-paying active users are intentionally excluded from all buckets (Sankey
 * represents monetisation lifecycle only).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/cube-client.js', () => ({ load: vi.fn() }));
vi.mock('../src/services/resolve-cube-token.js', () => ({
  resolveCubeTokenForGame: vi.fn(() => 'mock-token'),
}));

import { load } from '../src/services/cube-client.js';
import { fetchLifecycleFlow } from '../src/services/lifecycle-flow.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

type MockRow = {
  'mf_users.lifecycle_stage': string;
  'mf_users.is_paying_user': boolean;
  'mf_users.user_count': number;
};

/**
 * Two-call mock: first call (crossQuery) returns rows; second call (newQuery)
 * returns the new-install count. load() is called with Promise.all so order
 * matches [crossResult, newResult].
 */
function mockCubeLoad(crossRows: MockRow[], newCount: number) {
  vi.mocked(load)
    .mockResolvedValueOnce({ data: crossRows } as Awaited<ReturnType<typeof load>>)
    .mockResolvedValueOnce({
      data: [{ 'mf_users.user_count': newCount }],
    } as Awaited<ReturnType<typeof load>>);
}

beforeEach(() => {
  vi.mocked(load).mockReset();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('lifecycle_flow_new_state_from_new_install_count', () => {
  it('new count comes from the second (newQuery) Cube call, not crossRows', async () => {
    mockCubeLoad([], 500);
    const result = await fetchLifecycleFlow('cfm_vn');
    expect(result.states.new).toBe(500);
  });

  it('new defaults to 0 when newQuery returns no rows', async () => {
    vi.mocked(load)
      .mockResolvedValueOnce({ data: [] } as Awaited<ReturnType<typeof load>>)
      .mockResolvedValueOnce({ data: [] } as Awaited<ReturnType<typeof load>>);
    const result = await fetchLifecycleFlow('cfm_vn');
    expect(result.states.new).toBe(0);
  });
});

describe('lifecycle_flow_core_state', () => {
  it('active_today + paying → core', async () => {
    mockCubeLoad(
      [{ 'mf_users.lifecycle_stage': 'active_today', 'mf_users.is_paying_user': true, 'mf_users.user_count': 300 }],
      0,
    );
    const result = await fetchLifecycleFlow('cfm_vn');
    expect(result.states.core).toBe(300);
  });

  it('active_7d + paying → core', async () => {
    mockCubeLoad(
      [{ 'mf_users.lifecycle_stage': 'active_7d', 'mf_users.is_paying_user': true, 'mf_users.user_count': 150 }],
      0,
    );
    const result = await fetchLifecycleFlow('cfm_vn');
    expect(result.states.core).toBe(150);
  });

  it('accumulates both active_today and active_7d paying rows', async () => {
    mockCubeLoad(
      [
        { 'mf_users.lifecycle_stage': 'active_today', 'mf_users.is_paying_user': true, 'mf_users.user_count': 200 },
        { 'mf_users.lifecycle_stage': 'active_7d',    'mf_users.is_paying_user': true, 'mf_users.user_count': 100 },
      ],
      0,
    );
    const result = await fetchLifecycleFlow('cfm_vn');
    expect(result.states.core).toBe(300);
  });
});

describe('lifecycle_flow_lapsing_state', () => {
  it('active_30d + paying → lapsing', async () => {
    mockCubeLoad(
      [{ 'mf_users.lifecycle_stage': 'active_30d', 'mf_users.is_paying_user': true, 'mf_users.user_count': 80 }],
      0,
    );
    const result = await fetchLifecycleFlow('cfm_vn');
    expect(result.states.lapsing).toBe(80);
  });
});

describe('lifecycle_flow_reactivated_state', () => {
  it('churned + paying → reactivated', async () => {
    mockCubeLoad(
      [{ 'mf_users.lifecycle_stage': 'churned', 'mf_users.is_paying_user': true, 'mf_users.user_count': 45 }],
      0,
    );
    const result = await fetchLifecycleFlow('cfm_vn');
    expect(result.states.reactivated).toBe(45);
  });

  it('dormant + paying → reactivated', async () => {
    mockCubeLoad(
      [{ 'mf_users.lifecycle_stage': 'dormant', 'mf_users.is_paying_user': true, 'mf_users.user_count': 30 }],
      0,
    );
    const result = await fetchLifecycleFlow('cfm_vn');
    expect(result.states.reactivated).toBe(30);
  });

  it('accumulates churned+paying and dormant+paying rows', async () => {
    mockCubeLoad(
      [
        { 'mf_users.lifecycle_stage': 'churned', 'mf_users.is_paying_user': true, 'mf_users.user_count': 20 },
        { 'mf_users.lifecycle_stage': 'dormant', 'mf_users.is_paying_user': true, 'mf_users.user_count': 10 },
      ],
      0,
    );
    const result = await fetchLifecycleFlow('cfm_vn');
    expect(result.states.reactivated).toBe(30);
  });
});

describe('lifecycle_flow_churned_state', () => {
  it('churned + non-paying → churned', async () => {
    mockCubeLoad(
      [{ 'mf_users.lifecycle_stage': 'churned', 'mf_users.is_paying_user': false, 'mf_users.user_count': 500 }],
      0,
    );
    const result = await fetchLifecycleFlow('cfm_vn');
    expect(result.states.churned).toBe(500);
  });

  it('dormant + non-paying → churned', async () => {
    mockCubeLoad(
      [{ 'mf_users.lifecycle_stage': 'dormant', 'mf_users.is_paying_user': false, 'mf_users.user_count': 200 }],
      0,
    );
    const result = await fetchLifecycleFlow('cfm_vn');
    expect(result.states.churned).toBe(200);
  });

  it('registered_inactive + non-paying → churned', async () => {
    mockCubeLoad(
      [{ 'mf_users.lifecycle_stage': 'registered_inactive', 'mf_users.is_paying_user': false, 'mf_users.user_count': 1200 }],
      0,
    );
    const result = await fetchLifecycleFlow('cfm_vn');
    expect(result.states.churned).toBe(1200);
  });
});

describe('lifecycle_flow_non_paying_active_excluded', () => {
  it('active_today + non-paying → not counted in any state bucket', async () => {
    mockCubeLoad(
      [{ 'mf_users.lifecycle_stage': 'active_today', 'mf_users.is_paying_user': false, 'mf_users.user_count': 999 }],
      0,
    );
    const result = await fetchLifecycleFlow('cfm_vn');
    const total = Object.values(result.states).reduce((s, v) => s + v, 0);
    // new=0 and none of the active non-paying rows landed anywhere
    expect(total).toBe(0);
  });

  it('active_7d + non-paying → excluded', async () => {
    mockCubeLoad(
      [{ 'mf_users.lifecycle_stage': 'active_7d', 'mf_users.is_paying_user': false, 'mf_users.user_count': 400 }],
      0,
    );
    const result = await fetchLifecycleFlow('cfm_vn');
    expect(result.states.core).toBe(0);
    expect(result.states.churned).toBe(0);
  });
});

describe('lifecycle_flow_mixed_dataset', () => {
  it('correctly splits a full realistic cross-product', async () => {
    mockCubeLoad(
      [
        { 'mf_users.lifecycle_stage': 'active_today',        'mf_users.is_paying_user': true,  'mf_users.user_count': 300 },
        { 'mf_users.lifecycle_stage': 'active_7d',           'mf_users.is_paying_user': true,  'mf_users.user_count': 150 },
        { 'mf_users.lifecycle_stage': 'active_30d',          'mf_users.is_paying_user': true,  'mf_users.user_count': 80  },
        { 'mf_users.lifecycle_stage': 'churned',             'mf_users.is_paying_user': true,  'mf_users.user_count': 45  },
        { 'mf_users.lifecycle_stage': 'dormant',             'mf_users.is_paying_user': false, 'mf_users.user_count': 200 },
        { 'mf_users.lifecycle_stage': 'registered_inactive', 'mf_users.is_paying_user': false, 'mf_users.user_count': 600 },
        { 'mf_users.lifecycle_stage': 'active_today',        'mf_users.is_paying_user': false, 'mf_users.user_count': 999 },
      ],
      120,
    );
    const result = await fetchLifecycleFlow('cfm_vn');
    expect(result.states.new).toBe(120);
    expect(result.states.core).toBe(450);       // 300+150
    expect(result.states.lapsing).toBe(80);
    expect(result.states.reactivated).toBe(45);
    expect(result.states.churned).toBe(800);    // 200+600
    // 999 non-paying active excluded
  });

  it('transitions is always null (no history in mf_users)', async () => {
    mockCubeLoad([], 0);
    const result = await fetchLifecycleFlow('cfm_vn');
    expect(result.transitions).toBeNull();
    expect(result.transitionsUnavailableReason).toBeTruthy();
  });
});
