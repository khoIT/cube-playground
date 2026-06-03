/**
 * Tests for PerUserPanel pure mapping logic.
 *
 * Pure functions (groupFeatures, switchability) are extracted to be testable
 * without full render. Component tests cover rendering of derived state.
 *
 * NOTE: user-event is NOT installed; uses fireEvent from @testing-library/react.
 */

import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  groupFeatures,
  switchability,
  type FeatureGroup,
  type SwitchabilityResult,
} from '../per-user-panel';
import { PerUserPanel } from '../per-user-panel';
import type { AdminUser, AdminRegistry } from '../../access/use-admin-access';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock apiFetch from api-client — the authenticated fetch wrapper used by
// ActivitySnapshot. The activity route sits behind requireRole('admin') so
// bare fetch would 401 in real-auth (prod) mode; apiFetch attaches the JWT.
const mockApiFetch = vi.fn();
vi.mock('../../../../api/api-client', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

vi.mock('../../access/use-admin-access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../access/use-admin-access')>();
  return {
    ...actual,
  };
});

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const REGISTRY: AdminRegistry = {
  workspaces: [
    { id: 'ws-local', label: 'cube-dev · local' },
    { id: 'ws-prod', label: 'cube-dev · prod' },
  ],
  games: [
    { id: 'muaw', name: 'MU: Awakening' },
    { id: 'huashu', name: 'Hua Shu' },
    { id: 'gunny', name: 'Gunny Origin' },
  ],
  featureKeys: [
    'dashboards', 'liveops', 'segments', 'metrics-catalog',
    'data-model', 'playground', 'chats', 'admin',
  ],
};

function makeUser(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    email: 'test@example.com',
    role: 'editor',
    status: 'active',
    kcSub: 'kc-sub-test',
    workspaces: [],
    games: [],
    features: {},
    lastLogin: '2026-06-01T10:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Pure function: switchability()
// ---------------------------------------------------------------------------

describe('switchability', () => {
  it('returns canSwitch=true when >1 workspace granted', () => {
    const result: SwitchabilityResult = switchability(['ws-local', 'ws-prod']);
    expect(result.canSwitch).toBe(true);
    expect(result.label).toContain('can switch');
  });

  it('returns canSwitch=false with single-workspace note when ==1', () => {
    const result: SwitchabilityResult = switchability(['ws-local']);
    expect(result.canSwitch).toBe(false);
    expect(result.label).toContain('single');
  });

  it('returns canSwitch=false with none-granted note when 0', () => {
    const result: SwitchabilityResult = switchability([]);
    expect(result.canSwitch).toBe(false);
    expect(result.label).toContain('none granted');
  });
});

// ---------------------------------------------------------------------------
// Pure function: groupFeatures()
// ---------------------------------------------------------------------------

describe('groupFeatures', () => {
  it('groups admin key under Admin/governance group', () => {
    const groups: FeatureGroup[] = groupFeatures(REGISTRY, makeUser());
    const govGroup = groups.find((g) => g.defaultOn === false);
    expect(govGroup).toBeDefined();
    const adminEntry = govGroup!.entries.find((e) => e.key === 'admin');
    expect(adminEntry).toBeDefined();
  });

  it('non-admin keys land in Analyst surfaces group (defaultOn=true)', () => {
    const groups: FeatureGroup[] = groupFeatures(REGISTRY, makeUser());
    const analystGroup = groups.find((g) => g.defaultOn === true);
    expect(analystGroup).toBeDefined();
    const keys = analystGroup!.entries.map((e) => e.key);
    expect(keys).toContain('dashboards');
    expect(keys).toContain('chats');
    expect(keys).not.toContain('admin');
  });

  it('explicit features[admin]=true renders override=true for admin entry', () => {
    const user = makeUser({ features: { admin: true } });
    const groups = groupFeatures(REGISTRY, user);
    const govGroup = groups.find((g) => g.defaultOn === false)!;
    const adminEntry = govGroup.entries.find((e) => e.key === 'admin')!;
    expect(adminEntry.override).toBe(true);
    expect(adminEntry.active).toBe(true);
  });

  it('absent feature falls back to group default for active user (analyst surfaces on)', () => {
    const user = makeUser({ status: 'active', features: {} });
    const groups = groupFeatures(REGISTRY, user);
    const analystGroup = groups.find((g) => g.defaultOn === true)!;
    const dashEntry = analystGroup.entries.find((e) => e.key === 'dashboards')!;
    expect(dashEntry.active).toBe(true);
    expect(dashEntry.override).toBe(false);
  });

  it('absent feature in admin/governance group defaults to off for active user', () => {
    const user = makeUser({ status: 'active', features: {} });
    const groups = groupFeatures(REGISTRY, user);
    const govGroup = groups.find((g) => g.defaultOn === false)!;
    const adminEntry = govGroup.entries.find((e) => e.key === 'admin')!;
    expect(adminEntry.active).toBe(false);
    expect(adminEntry.override).toBe(false);
  });

  it('explicit features[admin]=false also marks override=true (explicit off overrides default)', () => {
    const user = makeUser({ status: 'active', features: { admin: false } });
    const groups = groupFeatures(REGISTRY, user);
    const govGroup = groups.find((g) => g.defaultOn === false)!;
    const adminEntry = govGroup.entries.find((e) => e.key === 'admin')!;
    // explicit false overrides the group default (which is also false, but it's still explicit)
    expect(adminEntry.override).toBe(true);
    expect(adminEntry.active).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Component rendering tests
// ---------------------------------------------------------------------------

function setupActivityFetch(payload: Record<string, unknown>) {
  // apiFetch resolves directly to the parsed body — no .json() call needed.
  mockApiFetch.mockResolvedValueOnce(payload);
}

function setupActivityFetchFail() {
  mockApiFetch.mockRejectedValueOnce(new Error('network error'));
}

describe('PerUserPanel rendering', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
  });

  it('shows "can switch" affordance when user has >1 workspace', async () => {
    setupActivityFetch({
      email: 'test@example.com', segmentCount: 3,
      recentFeatures: [], recentQueryShapes: [], chatStats: { turns: 10 }, inactive: false,
    });
    const user = makeUser({ workspaces: ['ws-local', 'ws-prod'] });
    render(<PerUserPanel user={user} registry={REGISTRY} onSaved={vi.fn()} />);
    // Text appears in both the Stat note and the workspace-grants callout — both are correct.
    const matches = await screen.findAllByText(/can switch/i);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('shows "single" note when user has exactly 1 workspace', async () => {
    setupActivityFetch({
      email: 'test@example.com', segmentCount: 0,
      recentFeatures: [], recentQueryShapes: [], chatStats: null, inactive: false,
    });
    const user = makeUser({ workspaces: ['ws-local'] });
    render(<PerUserPanel user={user} registry={REGISTRY} onSaved={vi.fn()} />);
    const matches = await screen.findAllByText(/single/i);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('shows "none granted" note when user has 0 workspaces', async () => {
    setupActivityFetch({
      email: 'test@example.com', segmentCount: 0,
      recentFeatures: [], recentQueryShapes: [], chatStats: null, inactive: false,
    });
    const user = makeUser({ workspaces: [] });
    render(<PerUserPanel user={user} registry={REGISTRY} onSaved={vi.fn()} />);
    const matches = await screen.findAllByText(/none granted/i);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('renders games count as "N of M"', async () => {
    setupActivityFetch({
      email: 'test@example.com', segmentCount: 2,
      recentFeatures: [], recentQueryShapes: [], chatStats: { turns: 5 }, inactive: false,
    });
    const user = makeUser({ games: ['muaw', 'huashu'] });
    render(<PerUserPanel user={user} registry={REGISTRY} onSaved={vi.fn()} />);
    // "2 of 3" appears in Games stat note and optionally in the grant matrix counter
    const matches = await screen.findAllByText(/2 of 3/i);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('shows "chat-service unreachable" when chatStats is null in activity', async () => {
    setupActivityFetch({
      email: 'test@example.com', segmentCount: 0,
      recentFeatures: [], recentQueryShapes: [], chatStats: null, inactive: false,
    });
    const user = makeUser();
    render(<PerUserPanel user={user} registry={REGISTRY} onSaved={vi.fn()} />);
    expect(await screen.findByText(/chat-service unreachable/i)).toBeDefined();
  });

  it('renders recentFeatures chips when present', async () => {
    setupActivityFetch({
      email: 'test@example.com', segmentCount: 5,
      recentFeatures: ['dashboards', 'liveops'],
      recentQueryShapes: [], chatStats: { turns: 20 }, inactive: false,
    });
    const user = makeUser();
    render(<PerUserPanel user={user} registry={REGISTRY} onSaved={vi.fn()} />);
    // Feature labels mapped from keys
    expect(await screen.findByText(/Dashboards/i)).toBeDefined();
  });

  it('renders query shape summary string correctly', async () => {
    setupActivityFetch({
      email: 'test@example.com', segmentCount: 0,
      recentFeatures: [],
      recentQueryShapes: [
        { cubes: ['mf_users'], measures: ['mf_users.wau'], dimensions: ['mf_users.game_id'] },
      ],
      chatStats: { turns: 1 }, inactive: false,
    });
    const user = makeUser();
    render(<PerUserPanel user={user} registry={REGISTRY} onSaved={vi.fn()} />);
    // format: "cubes · N measure(s) · M dim(s)"
    expect(await screen.findByText(/mf_users · 1 measure\(s\) · 1 dim\(s\)/i)).toBeDefined();
  });

  it('renders override pill when feature has explicit value', async () => {
    setupActivityFetch({
      email: 'test@example.com', segmentCount: 0,
      recentFeatures: [], recentQueryShapes: [], chatStats: null, inactive: false,
    });
    const user = makeUser({ features: { admin: true }, status: 'active' });
    render(<PerUserPanel user={user} registry={REGISTRY} onSaved={vi.fn()} />);
    expect(await screen.findByText(/override/i)).toBeDefined();
  });

  it('degrades gracefully when activity fetch fails — no crash', async () => {
    setupActivityFetchFail();
    const user = makeUser({ workspaces: ['ws-local'] });
    // Wrap in act so the rejected promise's state update is flushed before assert.
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <PerUserPanel user={user} registry={REGISTRY} onSaved={vi.fn()} />,
      ));
      // Drain microtask queue so the fetch rejection settles inside act.
      await Promise.resolve();
    });
    // Panel content is present even after fetch failure
    expect(container).toBeDefined();
  });
});
