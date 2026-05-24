import { describe, it, expect } from 'vitest';
import { suggestFollowups } from '../services/followup-suggester';

describe('suggestFollowups', () => {
  it('returns exactly 3 chips even on empty context (fallback)', () => {
    const out = suggestFollowups({ cubes: [], tools: [] });
    expect(out).toHaveLength(3);
    expect(out.every((c) => c.derivedFrom === 'fallback')).toBe(true);
  });

  it('fires the revenue rule on orders cube touches', () => {
    const out = suggestFollowups({ cubes: ['orders'], tools: [] });
    expect(out.some((c) => c.derivedFrom === 'revenue-drilldown')).toBe(true);
  });

  it('fires the player rule on players cube touches', () => {
    const out = suggestFollowups({ cubes: ['players'], tools: [] });
    expect(out.some((c) => c.derivedFrom === 'players-explore')).toBe(true);
  });

  it('fires the metric-explain rule on get_business_metric tool', () => {
    const out = suggestFollowups({ cubes: [], tools: ['get_business_metric'] });
    expect(out.some((c) => c.derivedFrom === 'metric-explain')).toBe(true);
  });

  it('suppress de-duplicates already-shown chip texts', () => {
    const first = suggestFollowups({ cubes: ['orders'], tools: [] });
    const repeat = suggestFollowups({
      cubes: ['orders'],
      tools: [],
      suppress: first.map((c) => c.text),
    });
    const overlap = repeat.filter((c) => first.some((f) => f.text === c.text));
    expect(overlap).toHaveLength(0);
  });

  it('chips diversity — players + orders + metric_explain → distinct rule ids', () => {
    const out = suggestFollowups({
      cubes: ['players', 'orders'],
      tools: ['get_business_metric'],
    });
    const rules = new Set(out.map((c) => c.derivedFrom));
    expect(rules.size).toBeGreaterThanOrEqual(2);
  });
});
