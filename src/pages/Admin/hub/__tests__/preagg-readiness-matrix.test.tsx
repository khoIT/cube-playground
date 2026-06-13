/**
 * PreaggReadinessMatrix — the hardened 4-state readiness view. Verifies the
 * from-source state renders distinctly (not green), the legend carries it, and
 * the Build action counts a from-source cube as a build candidate (not "all
 * built") so passthrough doesn't masquerade as a healthy rollup.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { PreaggReadinessMatrix } from '../preagg-readiness-matrix';
import type { GameReadinessSummary } from '../preagg-runs-data';

const game = (over: Partial<GameReadinessSummary>): GameReadinessSummary => ({
  id: 'cfm_vn',
  label: 'CrossFire Mobile VN',
  cubes: [],
  built: 0,
  fromSource: 0,
  unbuilt: 0,
  errored: 0,
  ...over,
});

describe('PreaggReadinessMatrix — from-source state', () => {
  it('renders the from-source legend and a from-source chip', () => {
    render(
      <PreaggReadinessMatrix
        games={[game({
          cubes: [
            { cube: 'active_daily', status: 'built' },
            { cube: 'recharge', status: 'from-source' },
          ],
          built: 1,
          fromSource: 1,
        })]}
        generatedAt="2026-06-13T07:00:00.000Z"
        triggerEnabled={false}
        buildingGame={null}
        onBuild={() => {}}
      />,
    );

    expect(screen.getByText('from source')).toBeTruthy(); // legend
    expect(screen.getByText('recharge')).toBeTruthy();     // the passthrough chip
    expect(screen.getByText('1/2 built')).toBeTruthy();    // not counted as built
  });

  it('treats a from-source cube as a build candidate, not "all built"', () => {
    const onBuild = vi.fn();
    render(
      <PreaggReadinessMatrix
        games={[game({
          cubes: [{ cube: 'recharge', status: 'from-source' }],
          built: 0,
          fromSource: 1,
        })]}
        generatedAt="2026-06-13T07:00:00.000Z"
        triggerEnabled
        buildingGame={null}
        onBuild={onBuild}
      />,
    );

    // 1 cube, 0 built → one build candidate. Must offer "Build 1", never "all built".
    expect(screen.getByText('Build 1')).toBeTruthy();
    expect(screen.queryByText('all built')).toBeNull();
  });
});
