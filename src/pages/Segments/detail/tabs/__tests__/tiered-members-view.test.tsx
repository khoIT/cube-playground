/**
 * Tests for the LTV-tiered Members view: tier view-model semantics, the
 * tiers-vs-fallback branch in SampleUsersTab, tier switching, the stored-LTV
 * column (no live query for LTV), and full-uid-list search.
 *
 * useMemberDimRows is mocked — enrichment is a live-Cube concern covered by
 * its own hook tests; here we only assert what it was asked for.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { MemberTiers, Segment } from '../../../../../types/segment-api';
import { tierOptions, buildLtvByUid, searchPool } from '../tier-view-model';

// ---------------------------------------------------------------------------
// Mocks — enrichment hook + member-360 gate
// ---------------------------------------------------------------------------

const dimRowsSpy = vi.fn();
vi.mock('../use-member-dim-rows', async (importOriginal) => {
  const original = await importOriginal<typeof import('../use-member-dim-rows')>();
  return {
    ...original,
    useMemberDimRows: (...args: unknown[]) => {
      dimRowsSpy(...args);
      return { byUid: new Map(), loading: false, error: null, columns: [] };
    },
  };
});

vi.mock('../../../member360/member360-panels', () => ({
  hasMember360: () => false,
}));

import { SampleUsersTab } from '../sample-users-tab';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTiers(): MemberTiers {
  const members = (prefix: string, n: number, ltvStart: number) =>
    Array.from({ length: n }, (_, i) => ({ uid: `${prefix}${i}`, ltv: ltvStart - i }));
  return {
    computed_at: '2026-06-06T00:00:00.000Z',
    ltv_measure: 'mf_users.ltv_total_vnd',
    tiers: {
      top: members('top', 50, 9_000_000),
      middle: members('mid', 50, 5_000),
      bottom: members('bot', 50, 49),
    },
  };
}

function makeSegment(overrides: Partial<Segment> = {}): Segment {
  return {
    id: 'seg1',
    name: 'Test segment',
    type: 'predicate',
    owner: 'dev',
    status: 'fresh',
    cube: 'mf_users',
    predicate_tree: null,
    cube_query_json: null,
    sql_preview: null,
    uid_count: 631_945,
    uid_list: ['top0', 'mid0', 'bot0', 'other-uid-1', 'other-uid-2'],
    tags: [],
    refresh_cadence_min: null,
    last_refreshed_at: null,
    broken_reason: null,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    game_id: 'ballistar',
    activations: [],
    funnel_json: null,
    visibility: 'personal',
    owner_label: null,
    shared_at: null,
    is_owner: true,
    can_administer: true,
    member_tiers: makeTiers(),
    ...overrides,
  };
}

function renderTab(segment: Segment) {
  return render(
    <MemoryRouter>
      <SampleUsersTab segment={segment} preset={null} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  dimRowsSpy.mockClear();
});

// ---------------------------------------------------------------------------
// View-model
// ---------------------------------------------------------------------------

describe('tier-view-model', () => {
  it('orders tier options top→middle→bottom and drops empty tiers', () => {
    const tiers = makeTiers();
    tiers.tiers.middle = [];
    expect(tierOptions(tiers).map((o) => o.name)).toEqual(['top', 'bottom']);
  });

  it('returns the single all tier for degenerate payloads', () => {
    const tiers: MemberTiers = {
      computed_at: '2026-06-06T00:00:00.000Z',
      ltv_measure: 'm',
      tiers: { all: [{ uid: 'a', ltv: 1 }] },
    };
    expect(tierOptions(tiers)).toEqual([{ name: 'all', count: 1 }]);
  });

  it('searchPool matches across the FULL uid list and annotates known LTV', () => {
    const tiers = makeTiers();
    const pool = searchPool(
      ['top0', 'other-uid-1', 'other-uid-2'],
      buildLtvByUid(tiers),
      'other',
    );
    expect(pool).toEqual([
      { uid: 'other-uid-1', ltv: null },
      { uid: 'other-uid-2', ltv: null },
    ]);
    expect(searchPool(['top0', 'x'], buildLtvByUid(tiers), 'top0')).toEqual([
      { uid: 'top0', ltv: 9_000_000 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

describe('SampleUsersTab tier branch', () => {
  it('renders the tiered view with a tier selector when member_tiers present', () => {
    renderTab(makeSegment());
    expect(screen.getByRole('tab', { name: /Top/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Middle/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Bottom/ })).toBeTruthy();
    // Top tier active by default → its first uid visible; LTV from stored data.
    expect(screen.getByText('top0')).toBeTruthy();
    expect(screen.queryByText('bot0')).toBeNull();
  });

  it('falls back to the legacy random sample when tiers are absent', () => {
    renderTab(makeSegment({ member_tiers: null }));
    expect(screen.queryByRole('tab')).toBeNull();
    // Legacy view keeps its Reshuffle affordance.
    expect(screen.getByText(/Reshuffle|segments.detail.sampleUsers.reshuffle/)).toBeTruthy();
  });

  it('falls back when the tiers payload has no usable tier arrays', () => {
    renderTab(
      makeSegment({
        member_tiers: { computed_at: 'x', ltv_measure: 'm', tiers: {} },
      }),
    );
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('switches rows when another tier is selected', () => {
    renderTab(makeSegment());
    fireEvent.click(screen.getByRole('tab', { name: /Bottom/ }));
    expect(screen.getByText('bot0')).toBeTruthy();
    expect(screen.queryByText('top0')).toBeNull();
  });

  it('search spans the full uid list, beyond the 150-member sample', () => {
    renderTab(makeSegment());
    fireEvent.change(screen.getByPlaceholderText(/Search uid/), {
      target: { value: 'other-uid' },
    });
    expect(screen.getByText('other-uid-1')).toBeTruthy();
    expect(screen.getByText('other-uid-2')).toBeTruthy();
    expect(screen.queryByText('top0')).toBeNull();
  });

  it('asks the enrichment hook only for the visible tier page uids', () => {
    renderTab(makeSegment());
    const lastCall = dimRowsSpy.mock.calls.at(-1)!;
    const uids = lastCall[2] as string[];
    expect(uids).toHaveLength(25); // PAGE_SIZE slice of the 50-member tier
    expect(uids[0]).toBe('top0');
  });

  it('renders the stored tier name without any live dim data', () => {
    // The enrichment hook is mocked to return EMPTY rows/columns — i.e. the
    // live name query is cold/slow/failed. The friendly name must still show
    // from the refresh-time TierMember.name (the regression: it fell back to
    // the bare uid whenever the live query produced nothing).
    const tiers = makeTiers();
    tiers.tiers.top![0] = { uid: 'top0', ltv: 9_000_000, name: 'VươngĐôngQuân' };
    renderTab(makeSegment({ member_tiers: tiers }));
    expect(screen.getByText('VươngĐôngQuân')).toBeTruthy(); // stored name is primary
    expect(screen.getByText('top0')).toBeTruthy(); // uid demoted to secondary line
  });
});
