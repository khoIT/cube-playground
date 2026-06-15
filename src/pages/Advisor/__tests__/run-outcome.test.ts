/**
 * Pure mappers for the run-history surface: stop-reason → user-facing outcome,
 * relative time, goal/scope labels. Keep these stable — both the history list and
 * the replay header read from them.
 */
import { describe, it, expect } from 'vitest';
import { runOutcome, outcomeColors, relativeTime, goalLabel, scopeLabel } from '../run-outcome';

describe('runOutcome', () => {
  it('maps terminal stop reasons to friendly labels + tone', () => {
    expect(runOutcome('end_turn')).toEqual({ label: 'Completed', tone: 'success' });
    expect(runOutcome('timeout')).toEqual({ label: 'Timed out', tone: 'warning' });
    expect(runOutcome('max_turns')).toEqual({ label: 'Step limit', tone: 'warning' });
    expect(runOutcome('budget')).toEqual({ label: 'Cost cap', tone: 'warning' });
    expect(runOutcome('error')).toEqual({ label: 'Error', tone: 'destructive' });
    expect(runOutcome('aborted')).toEqual({ label: 'Stopped', tone: 'muted' });
  });

  it('falls back to the raw reason (or "In progress") for unknown/null', () => {
    expect(runOutcome(null)).toEqual({ label: 'In progress', tone: 'muted' });
    expect(runOutcome('weird')).toEqual({ label: 'weird', tone: 'muted' });
  });
});

describe('outcomeColors', () => {
  it('returns a soft/ink token pair per tone', () => {
    expect(outcomeColors('success')).toEqual({ bg: 'var(--success-soft)', ink: 'var(--success-ink)' });
    expect(outcomeColors('warning').bg).toContain('warning');
    expect(outcomeColors('destructive').ink).toContain('destructive');
    expect(outcomeColors('muted').bg).toContain('muted');
  });
});

describe('relativeTime', () => {
  const now = 1_700_000_000_000;
  it('buckets into just-now / minutes / hours / days', () => {
    expect(relativeTime(now, now)).toBe('just now');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5m ago');
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2d ago');
  });
});

describe('goalLabel / scopeLabel', () => {
  it('capitalizes the goal', () => {
    expect(goalLabel('revenue')).toBe('Revenue');
    expect(goalLabel('')).toBe('Investigation');
  });

  it('renders segment vs game scope', () => {
    expect(scopeLabel('segment', 'cfm_vn', '1a2b3c4d5e6f')).toBe('segment 1a2b3c4d…');
    expect(scopeLabel('game', 'cfm_vn', null)).toBe('cfm_vn');
    expect(scopeLabel('segment', 'cfm_vn', null)).toBe('cfm_vn'); // segment kind but no id → game
  });
});
