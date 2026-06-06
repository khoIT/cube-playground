/**
 * inferOutputHint — answer-shape prediction for starter cards. Exercises the
 * priority order of the text rules (funnel > breakdown > comparison > trend >
 * ranking) and the category fallback, using real seed-question phrasings.
 */
import { describe, it, expect } from 'vitest';
import { inferOutputHint } from '../library/starter-output-hint';

const q = (text: string, categoryTags: Array<'explore' | 'metric_explain' | 'compare' | 'diagnose'> = ['explore']) =>
  ({ text, categoryTags });

describe('inferOutputHint', () => {
  it('detects rankings', () => {
    expect(inferOutputHint(q('Rank every gacha banner (lottery box) by total diamond spend'))).toBe('ranking');
    expect(inferOutputHint(q('Which role classes log the most daily online time?'))).toBe('ranking');
  });

  it('detects trends', () => {
    expect(inferOutputHint(q('How has the D7 payer conversion rate trended across monthly install cohorts?'))).toBe('trend');
    expect(inferOutputHint(q('How is DAU trending over the last 30 days?'))).toBe('trend');
  });

  it('detects comparisons', () => {
    expect(inferOutputHint(q('Compare iOS vs Android ARPU and revenue this month'))).toBe('comparison');
    expect(inferOutputHint(q('How do returning players compare to first-time players in matches played?'))).toBe('comparison');
  });

  it('detects funnels', () => {
    expect(inferOutputHint(q('At which tutorial step does the new-player completion rate fall furthest?'))).toBe('funnel');
    expect(inferOutputHint(q('What share of new users convert to payers within 7 days?'))).toBe('funnel');
  });

  it('breakdown wording wins over the ranking rule ("share of ranked matches")', () => {
    expect(inferOutputHint(q('What share of ranked matches have avg ping above 300 ms?'))).toBe('breakdown');
    expect(inferOutputHint(q('Show a Pareto breakdown of revenue and payer count by VIP level'))).toBe('breakdown');
  });

  it('falls back to the intent category when no text rule fires', () => {
    expect(inferOutputHint(q('Players by lifecycle stage', ['compare']))).toBe('comparison');
    expect(inferOutputHint(q('Players by lifecycle stage', ['metric_explain']))).toBe('trend');
    expect(inferOutputHint(q('Players by lifecycle stage', ['diagnose']))).toBe('breakdown');
  });
});
