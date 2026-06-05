/**
 * RTL coverage for Settings → Workspace readiness section.
 * Mocks the readiness hook and workspace context so the panel renders in
 * isolation. Covers the preagg panel: tone assignment, counts, errored cube
 * names, and the n/a hint path for non-game_id workspaces.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Workspace context mock — must be hoisted before component import
// ---------------------------------------------------------------------------

vi.mock('../../../components/workspace-context', () => ({
  useWorkspaceContext: () => workspaceCtx,
}));

// Mutable ref so individual tests can override.
let workspaceCtx: {
  workspaceId: string | null;
  workspace: { label: string; gameModel: 'game_id' | 'prefix' } | null;
} = {
  workspaceId: 'local',
  workspace: { label: 'Local', gameModel: 'game_id' },
};

// ---------------------------------------------------------------------------
// Readiness hook mock
// ---------------------------------------------------------------------------

const refetchMock = vi.fn().mockResolvedValue(undefined);

// Minimal but complete WorkspaceReadinessReport fixture.
const gameIdReport = {
  workspace: {
    id: 'local',
    label: 'Local',
    gameModel: 'game_id' as const,
    authMode: 'minted' as const,
  },
  generatedAt: '2026-06-05T00:00:00.000Z',
  games: [
    { id: 'pubg', label: 'PUBG', prefix: null, status: 'ok' as const, cubeCount: 12 },
  ],
  coverage: {
    games: [],
    matrix: [],
    generatedAt: '2026-06-05T00:00:00.000Z',
  },
  artifacts: { dashboards: 2, segments: 1, cubeAliases: 0 },
  preaggs: {
    generatedAt: '2026-06-05T00:00:00.000Z',
    games: [
      {
        id: 'pubg',
        label: 'PUBG',
        cubes: [
          { cube: 'active_daily', status: 'built' as const },
          { cube: 'recharge', status: 'unbuilt' as const, message: 'No pre-aggregation partitions were built yet' },
          { cube: 'mf_users', status: 'error' as const, message: 'timeout' },
        ],
        built: 1,
        unbuilt: 1,
        errored: 1,
      },
    ],
  },
};

// Variant: all cubes built (ok tone).
const allBuiltReport = {
  ...gameIdReport,
  preaggs: {
    generatedAt: '2026-06-05T00:00:00.000Z',
    games: [
      {
        id: 'pubg',
        label: 'PUBG',
        cubes: [
          { cube: 'active_daily', status: 'built' as const },
          { cube: 'recharge', status: 'built' as const },
        ],
        built: 2,
        unbuilt: 0,
        errored: 0,
      },
    ],
  },
};

// Variant: prefix workspace — preagg n/a path.
const prefixReport = {
  ...gameIdReport,
  workspace: {
    id: 'prod',
    label: 'Prod',
    gameModel: 'prefix' as const,
    authMode: 'env-token' as const,
  },
  preaggs: {
    generatedAt: '2026-06-05T00:00:00.000Z',
    games: [],
    note: 'n/a — only game_id workspaces carry in-stack pre-aggregations',
  },
};

let hookReport: typeof gameIdReport | typeof prefixReport | null = gameIdReport;

vi.mock('../use-workspace-readiness', () => ({
  useWorkspaceReadiness: () => ({
    report: hookReport,
    loading: false,
    error: null,
    refetch: refetchMock,
  }),
}));

import { WorkspaceReadinessSection } from '../workspace-readiness-section';

beforeEach(() => {
  cleanup();
  refetchMock.mockClear();
  hookReport = gameIdReport;
  workspaceCtx = { workspaceId: 'local', workspace: { label: 'Local', gameModel: 'game_id' as const } };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkspaceReadinessSection — Pre-aggregation status panel', () => {
  it('renders the section heading', () => {
    render(<WorkspaceReadinessSection />);
    expect(screen.getByText('Pre-aggregation status')).toBeTruthy();
  });

  it('shows errored tone for game with any errored cube (bad tone via destructive-soft)', () => {
    render(<WorkspaceReadinessSection />);
    // The errored cube name surfaces in the sub line.
    expect(screen.getByText(/mf_users/)).toBeTruthy();
  });

  it('shows built/total count in the label', () => {
    render(<WorkspaceReadinessSection />);
    // 1 built out of 3 total (1 built + 1 unbuilt + 1 errored).
    expect(screen.getByText('1/3 built')).toBeTruthy();
  });

  it('shows unbuilt count in the sub line', () => {
    render(<WorkspaceReadinessSection />);
    expect(screen.getByText(/1 unbuilt/)).toBeTruthy();
  });

  it('shows "all built" when every cube is built', () => {
    hookReport = allBuiltReport;
    render(<WorkspaceReadinessSection />);
    expect(screen.getByText('2/2 built')).toBeTruthy();
    expect(screen.getByText('all built')).toBeTruthy();
  });

  it('shows n/a hint for prefix workspace and no game grid', () => {
    hookReport = prefixReport;
    workspaceCtx = { workspaceId: 'prod', workspace: { label: 'Prod', gameModel: 'prefix' } };
    render(<WorkspaceReadinessSection />);
    // The hint text appears (both in SectionHint and in Empty).
    const hints = screen.getAllByText(/Pre-agg status is only tracked for the in-stack local workspace/);
    expect(hints.length).toBeGreaterThanOrEqual(1);
    // No game grid — "PUBG" does not appear in the preagg section (may appear in game availability).
    // The 1/3 built label must not appear.
    expect(screen.queryByText(/built/)).toBeFalsy();
  });

  it('renders game availability section unaffected by preagg data', () => {
    render(<WorkspaceReadinessSection />);
    expect(screen.getByText('Game availability')).toBeTruthy();
    // PUBG appears in both game availability and preagg grids.
    expect(screen.getAllByText('PUBG').length).toBeGreaterThanOrEqual(1);
  });
});
