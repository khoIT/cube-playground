import { describe, it, expect } from 'vitest';
import { synthesizeAutoPreset } from '../auto-preset';

// Minimal Cube-meta fixture covering the shapes the synthesizer relies on.
const meta = {
  cubes: [
    {
      name: 'recharge',
      measures: [
        { name: 'recharge.transactions', type: 'number', title: 'Transactions' },
        { name: 'recharge.revenue_vnd',  type: 'number', title: 'Revenue Vnd' },
        { name: 'recharge.paying_users', type: 'number', title: 'Paying Users' },
        { name: 'recharge.arppu_vnd',    type: 'number', title: 'Arppu Vnd' },
      ],
      dimensions: [
        { name: 'recharge.user_id',         type: 'string' },
        { name: 'recharge.payment_channel', type: 'string' },
        { name: 'recharge.country_code',    type: 'string' },
        { name: 'recharge.os_platform',     type: 'string' },
        { name: 'recharge.recharge_date',   type: 'time'   },
      ],
    },
    {
      name: 'no_identity',
      measures: [{ name: 'no_identity.count', type: 'number' }],
      dimensions: [
        { name: 'no_identity.region', type: 'string' },
      ],
    },
    {
      name: 'empty_cube',
      measures: [],
      dimensions: [],
    },
  ],
};

describe('synthesizeAutoPreset', () => {
  it('picks identity dim, headline KPIs, and a composition-heavy overview tab', () => {
    const preset = synthesizeAutoPreset(meta, 'recharge');
    expect(preset).not.toBeNull();
    expect(preset!.identityDim).toBe('recharge.user_id');
    expect(preset!.hubCube).toBe('recharge');
    expect(preset!.id).toBe('auto-recharge');
    expect(preset!.auto).toBe(true);

    // At most 4 KPIs. Recharge has no `count`-pattern measure, so revenue
    // wins the first slot, then paying_users from the active pattern, then
    // the remaining numeric measures fill out the rest.
    expect(preset!.headlineKpis.length).toBeGreaterThan(0);
    expect(preset!.headlineKpis.length).toBeLessThanOrEqual(4);
    const kpiMeasures = preset!.headlineKpis.map((k) => k.measure);
    expect(kpiMeasures).toContain('recharge.revenue_vnd');
    expect(kpiMeasures).toContain('recharge.paying_users');

    // Overview tab with composition cards over non-id categorical dims.
    expect(preset!.tabs).toHaveLength(1);
    const overview = preset!.tabs[0];
    expect(overview.id).toBe('overview');
    const compositions = overview.cards.filter((c) => c.kind === 'composition');
    expect(compositions.length).toBeGreaterThanOrEqual(3);
    // user_id must NOT show up as a composition groupBy.
    expect(compositions.find((c) => c.kind === 'composition' && c.groupBy === 'recharge.user_id')).toBeUndefined();

    // Should include a line card because there's a time dim.
    const lines = overview.cards.filter((c) => c.kind === 'line');
    expect(lines.length).toBe(1);
  });

  it('returns a preset with empty identityDim when no identity-like dim exists', () => {
    const preset = synthesizeAutoPreset(meta, 'no_identity');
    expect(preset).not.toBeNull();
    expect(preset!.identityDim).toBe('');
    expect(preset!.headlineKpis.length).toBeGreaterThan(0);
  });

  it('returns null for a cube with no dims and no measures', () => {
    expect(synthesizeAutoPreset(meta, 'empty_cube')).toBeNull();
  });

  it('returns null for unknown cube name', () => {
    expect(synthesizeAutoPreset(meta, 'nope')).toBeNull();
  });
});
