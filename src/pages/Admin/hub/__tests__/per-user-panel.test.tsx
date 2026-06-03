/**
 * Tests for PerUserPanel — the Users & Access (govern) panel.
 *
 * Pure mapping helpers (groupFeatures, switchability) are re-exported from
 * per-user-panel and tested without render. Rendering tests cover the access
 * controls + identity strip. The panel no longer fetches the heavy activity
 * rollup — observe-only rendering is covered by activity-profile.test.tsx.
 *
 * NOTE: user-event is NOT installed; uses fireEvent from @testing-library/react.
 */

import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  groupFeatures,
  switchability,
  type FeatureGroup,
  type SwitchabilityResult,
} from '../per-user-panel';
import { PerUserPanel } from '../per-user-panel';
import type { AdminUser, AdminRegistry } from '../../access/use-admin-access';

// Mock apiFetch — the identity strip makes one light /sessions call on mount.
const mockApiFetch = vi.fn();
vi.mock('../../../../api/api-client', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

vi.mock('../../access/use-admin-access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../access/use-admin-access')>();
  return { ...actual };
});

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

function renderPanel(user: AdminUser) {
  return render(
    <MemoryRouter>
      <PerUserPanel user={user} registry={REGISTRY} onSaved={vi.fn()} />
    </MemoryRouter>,
  );
}

// ── Pure: switchability ───────────────────────────────────────────────────────

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

// ── Pure: groupFeatures ─────────────────────────────────────────────────────────

describe('groupFeatures', () => {
  it('groups admin key under Admin/governance group', () => {
    const groups: FeatureGroup[] = groupFeatures(REGISTRY, makeUser());
    const govGroup = groups.find((g) => g.defaultOn === false);
    expect(govGroup).toBeDefined();
    expect(govGroup!.entries.find((e) => e.key === 'admin')).toBeDefined();
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
    const groups = groupFeatures(REGISTRY, makeUser({ features: { admin: true } }));
    const adminEntry = groups.find((g) => g.defaultOn === false)!.entries.find((e) => e.key === 'admin')!;
    expect(adminEntry.override).toBe(true);
    expect(adminEntry.active).toBe(true);
  });

  it('absent feature falls back to group default for active user (analyst surfaces on)', () => {
    const groups = groupFeatures(REGISTRY, makeUser({ status: 'active', features: {} }));
    const dashEntry = groups.find((g) => g.defaultOn === true)!.entries.find((e) => e.key === 'dashboards')!;
    expect(dashEntry.active).toBe(true);
    expect(dashEntry.override).toBe(false);
  });

  it('absent feature in admin/governance group defaults to off for active user', () => {
    const groups = groupFeatures(REGISTRY, makeUser({ status: 'active', features: {} }));
    const adminEntry = groups.find((g) => g.defaultOn === false)!.entries.find((e) => e.key === 'admin')!;
    expect(adminEntry.active).toBe(false);
    expect(adminEntry.override).toBe(false);
  });

  it('explicit features[admin]=false also marks override=true (explicit off overrides default)', () => {
    const groups = groupFeatures(REGISTRY, makeUser({ status: 'active', features: { admin: false } }));
    const adminEntry = groups.find((g) => g.defaultOn === false)!.entries.find((e) => e.key === 'admin')!;
    expect(adminEntry.override).toBe(true);
    expect(adminEntry.active).toBe(false);
  });
});

// ── Rendering: identity strip + access controls ─────────────────────────────────

describe('PerUserPanel rendering', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    // Identity strip's light /sessions call resolves to a count by default.
    mockApiFetch.mockResolvedValue({ sessions30: 0 });
  });

  it('shows "can switch" affordance when user has >1 workspace', async () => {
    renderPanel(makeUser({ workspaces: ['ws-local', 'ws-prod'] }));
    const matches = await screen.findAllByText(/can switch/i);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('shows "single" note when user has exactly 1 workspace', async () => {
    renderPanel(makeUser({ workspaces: ['ws-local'] }));
    const matches = await screen.findAllByText(/single/i);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('shows "none granted" note when user has 0 workspaces', async () => {
    renderPanel(makeUser({ workspaces: [] }));
    const matches = await screen.findAllByText(/none granted/i);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('renders games count as "N of M" on the grant matrix', async () => {
    renderPanel(makeUser({ games: ['muaw', 'huashu'] }));
    const matches = await screen.findAllByText(/2 of 3/i);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('renders override pill when feature has explicit value', async () => {
    renderPanel(makeUser({ features: { admin: true }, status: 'active' }));
    expect(await screen.findByText(/override/i)).toBeDefined();
  });

  it('renders Select all / Clear bulk controls on the game grants matrix', async () => {
    renderPanel(makeUser({ games: ['muaw'] }));
    expect(await screen.findByText(/select all/i)).toBeDefined();
    expect(await screen.findByText(/^clear$/i)).toBeDefined();
  });

  it('renders a "View full activity" deep-link to the observability drill-in', async () => {
    renderPanel(makeUser());
    const link = await screen.findByText(/view full activity/i);
    expect(link.closest('a')?.getAttribute('href')).toContain('/admin/observability/');
  });

  it('degrades gracefully when the sessions strip fetch fails — no crash', async () => {
    mockApiFetch.mockReset();
    mockApiFetch.mockRejectedValue(new Error('network error'));
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = renderPanel(makeUser({ workspaces: ['ws-local'] })));
      await Promise.resolve();
    });
    expect(container).toBeDefined();
  });
});
