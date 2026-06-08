/**
 * Tests for Member 360 coverage classifier pure helpers.
 *
 * - requiredMembers: deduped distinct members across columns + kpis + timeDimension
 * - probeMember: prefers non-time column; regression guard for monthly time dimension
 * - rollupGameStatus: 'na'→empty, 'error'→any error, 'ready'→all ready, 'blocked'→all blocked, else 'partial'
 */

import { describe, it, expect } from 'vitest';
import {
  requiredMembers,
  probeMember,
  rollupGameStatus,
  type Member360Panel,
  type PanelCoverage,
} from '../src/services/member360-coverage.js';

// Helper to construct fixture panels inline
function panel(
  id: string,
  opts: {
    columns?: Array<{ member: string; label: string; kind?: 'dimension' | 'measure' }>;
    kpis?: Array<{ member: string; label: string }>;
    timeDimension?: string;
  } = {},
): Member360Panel {
  return {
    id,
    title: `Panel ${id}`,
    view: 'test_view',
    identityKey: 'user_id',
    panelType: 'profile',
    section: 'core',
    columns: opts.columns ?? [],
    kpis: opts.kpis,
    timeDimension: opts.timeDimension,
  };
}

// Helper to construct coverage results for rollup tests
function coverage(
  id: string,
  status: 'ready' | 'partial' | 'empty' | 'blocked' | 'error',
): PanelCoverage {
  return {
    id,
    title: `Panel ${id}`,
    view: 'test_view',
    status,
    modeledMembers: 0,
    totalMembers: 0,
    missingMembers: [],
    hasRows: null,
  };
}

describe('requiredMembers', () => {
  it('returns distinct members from columns only', () => {
    const p = panel('p1', {
      columns: [
        { member: 'view.field_a', label: 'A' },
        { member: 'view.field_b', label: 'B' },
      ],
    });
    const members = requiredMembers(p);
    expect(members).toHaveLength(2);
    expect(members).toContain('view.field_a');
    expect(members).toContain('view.field_b');
  });

  it('includes kpi members alongside columns', () => {
    const p = panel('p1', {
      columns: [{ member: 'view.field_a', label: 'A' }],
      kpis: [
        { member: 'view.kpi_x', label: 'KPI X' },
        { member: 'view.kpi_y', label: 'KPI Y' },
      ],
    });
    const members = requiredMembers(p);
    expect(members).toHaveLength(3);
    expect(members).toContain('view.field_a');
    expect(members).toContain('view.kpi_x');
    expect(members).toContain('view.kpi_y');
  });

  it('includes timeDimension when present', () => {
    const p = panel('p1', {
      columns: [{ member: 'view.field_a', label: 'A' }],
      timeDimension: 'view.log_month',
    });
    const members = requiredMembers(p);
    expect(members).toHaveLength(2);
    expect(members).toContain('view.field_a');
    expect(members).toContain('view.log_month');
  });

  it('deduplicates when timeDimension matches a column', () => {
    const p = panel('p1', {
      columns: [
        { member: 'view.field_a', label: 'A' },
        { member: 'view.log_month', label: 'Month' },
      ],
      timeDimension: 'view.log_month',
    });
    const members = requiredMembers(p);
    expect(members).toHaveLength(2);
    expect(members.filter((m) => m === 'view.log_month')).toHaveLength(1);
  });

  it('deduplicates across columns and kpis', () => {
    const p = panel('p1', {
      columns: [
        { member: 'view.field_a', label: 'A' },
        { member: 'view.field_a', label: 'A (again)' },
      ],
      kpis: [{ member: 'view.field_a', label: 'KPI A' }],
    });
    const members = requiredMembers(p);
    expect(members).toHaveLength(1);
    expect(members[0]).toBe('view.field_a');
  });

  it('returns empty array when panel has no columns, kpis, or timeDimension', () => {
    const p = panel('p1', {});
    const members = requiredMembers(p);
    expect(members).toEqual([]);
  });
});

describe('probeMember', () => {
  it('prefers a non-time column when both column and timeDimension exist', () => {
    const p = panel('p1', {
      columns: [
        { member: 'view.field_a', label: 'A' },
        { member: 'view.field_b', label: 'B' },
      ],
      timeDimension: 'view.log_month',
    });
    const probe = probeMember(p);
    expect(probe?.member).toBe('view.field_a');
    expect(probe?.member).not.toBe('view.log_month');
  });

  it('returns first non-time column when multiple exist', () => {
    const p = panel('p1', {
      columns: [
        { member: 'view.field_a', label: 'A' },
        { member: 'view.field_b', label: 'B' },
        { member: 'view.field_c', label: 'C' },
      ],
      timeDimension: 'view.log_month',
    });
    const probe = probeMember(p);
    expect(probe?.member).toBe('view.field_a');
  });

  it('skips time column and returns first non-time in middle position', () => {
    const p = panel('p1', {
      columns: [
        { member: 'view.log_month', label: 'Month' },
        { member: 'view.field_a', label: 'A' },
        { member: 'view.field_b', label: 'B' },
      ],
      timeDimension: 'view.log_month',
    });
    const probe = probeMember(p);
    expect(probe?.member).toBe('view.field_a');
  });

  it('returns columns[0] when it is NOT the timeDimension', () => {
    const p = panel('p1', {
      columns: [{ member: 'view.field_a', label: 'A' }],
      timeDimension: 'view.log_date',
    });
    const probe = probeMember(p);
    expect(probe?.member).toBe('view.field_a');
  });

  it('falls back to columns[0] when all columns are timeDimension', () => {
    const p = panel('p1', {
      columns: [{ member: 'view.log_month', label: 'Month' }],
      timeDimension: 'view.log_month',
    });
    const probe = probeMember(p);
    expect(probe?.member).toBe('view.log_month');
  });

  it('falls back to timeDimension when no columns exist', () => {
    const p = panel('p1', {
      timeDimension: 'view.log_month',
    });
    const probe = probeMember(p);
    expect(probe?.member).toBe('view.log_month');
  });

  it('returns null when panel is completely empty', () => {
    const p = panel('p1', {});
    const probe = probeMember(p);
    expect(probe).toBeNull();
  });

  it('regression: does NOT return timeDimension when a non-time column exists', () => {
    // Motivating case: selecting a monthly time dimension as a bare dimension
    // makes Trino reject the cast — must prefer a non-time column.
    const p = panel('daily_timeline', {
      columns: [
        { member: 'user_activity_daily.user_id', label: 'User' },
        { member: 'user_activity_daily.revenue', label: 'Revenue' },
      ],
      timeDimension: 'user_activity_daily.log_month',
    });
    const probe = probeMember(p);
    expect(probe?.member).not.toBe('user_activity_daily.log_month');
    expect(probe?.member).toBe('user_activity_daily.user_id');
  });

  it('prefers a dimension over a leading measure (probes as a dimension)', () => {
    const p = panel('p1', {
      columns: [
        { member: 'view.count', label: 'Count', kind: 'measure' },
        { member: 'view.label', label: 'Label', kind: 'dimension' },
      ],
    });
    expect(probeMember(p)).toEqual({ member: 'view.label', kind: 'dimension' });
  });

  it('falls back to a measure when a panel exposes only measures', () => {
    // Device/IP rollups select count_distinct measures only — the probe must
    // query them as measures, not bare dimensions.
    const p = panel('devices', {
      columns: [
        { member: 'user_devices_panel.distinct_devices', label: 'Distinct devices', kind: 'measure' },
        { member: 'user_devices_panel.rows', label: 'Records', kind: 'measure' },
      ],
    });
    expect(probeMember(p)).toEqual({ member: 'user_devices_panel.distinct_devices', kind: 'measure' });
  });
});

describe('rollupGameStatus', () => {
  it('returns "na" for empty panels', () => {
    const status = rollupGameStatus([]);
    expect(status).toBe('na');
  });

  it('returns "error" when any panel has error status', () => {
    const panels: PanelCoverage[] = [
      coverage('p1', 'ready'),
      coverage('p2', 'error'),
      coverage('p3', 'ready'),
    ];
    const status = rollupGameStatus(panels);
    expect(status).toBe('error');
  });

  it('returns "error" when only panel is error', () => {
    const panels: PanelCoverage[] = [coverage('p1', 'error')];
    const status = rollupGameStatus(panels);
    expect(status).toBe('error');
  });

  it('returns "ready" when all panels are ready', () => {
    const panels: PanelCoverage[] = [
      coverage('p1', 'ready'),
      coverage('p2', 'ready'),
      coverage('p3', 'ready'),
    ];
    const status = rollupGameStatus(panels);
    expect(status).toBe('ready');
  });

  it('returns "ready" when single panel is ready', () => {
    const panels: PanelCoverage[] = [coverage('p1', 'ready')];
    const status = rollupGameStatus(panels);
    expect(status).toBe('ready');
  });

  it('returns "blocked" when all panels are blocked', () => {
    const panels: PanelCoverage[] = [
      coverage('p1', 'blocked'),
      coverage('p2', 'blocked'),
    ];
    const status = rollupGameStatus(panels);
    expect(status).toBe('blocked');
  });

  it('returns "blocked" when single panel is blocked', () => {
    const panels: PanelCoverage[] = [coverage('p1', 'blocked')];
    const status = rollupGameStatus(panels);
    expect(status).toBe('blocked');
  });

  it('returns "partial" when mix of ready and blocked', () => {
    const panels: PanelCoverage[] = [
      coverage('p1', 'ready'),
      coverage('p2', 'blocked'),
    ];
    const status = rollupGameStatus(panels);
    expect(status).toBe('partial');
  });

  it('returns "partial" when panels include empty', () => {
    const panels: PanelCoverage[] = [
      coverage('p1', 'ready'),
      coverage('p2', 'empty'),
    ];
    const status = rollupGameStatus(panels);
    expect(status).toBe('partial');
  });

  it('returns "partial" when panels include partial', () => {
    const panels: PanelCoverage[] = [
      coverage('p1', 'ready'),
      coverage('p2', 'partial'),
    ];
    const status = rollupGameStatus(panels);
    expect(status).toBe('partial');
  });

  it('returns "partial" for mixed ready/empty/partial (no error, not all same)', () => {
    const panels: PanelCoverage[] = [
      coverage('p1', 'ready'),
      coverage('p2', 'empty'),
      coverage('p3', 'partial'),
      coverage('p4', 'blocked'),
    ];
    const status = rollupGameStatus(panels);
    expect(status).toBe('partial');
  });

  it('error takes precedence over all other statuses', () => {
    const panels: PanelCoverage[] = [
      coverage('p1', 'ready'),
      coverage('p2', 'ready'),
      coverage('p3', 'error'),
      coverage('p4', 'blocked'),
    ];
    const status = rollupGameStatus(panels);
    expect(status).toBe('error');
  });

  it('blocked only wins when ALL are blocked', () => {
    const panels: PanelCoverage[] = [
      coverage('p1', 'blocked'),
      coverage('p2', 'blocked'),
      coverage('p3', 'empty'), // One non-blocked breaks the tie
    ];
    const status = rollupGameStatus(panels);
    expect(status).toBe('partial');
  });

  it('ready only wins when ALL are ready', () => {
    const panels: PanelCoverage[] = [
      coverage('p1', 'ready'),
      coverage('p2', 'ready'),
      coverage('p3', 'empty'), // One non-ready breaks the tie
    ];
    const status = rollupGameStatus(panels);
    expect(status).toBe('partial');
  });
});
