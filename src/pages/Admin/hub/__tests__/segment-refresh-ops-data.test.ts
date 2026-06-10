/**
 * segment-refresh-ops-data pure helpers — locks the state→presentation mapping
 * the tab + nav badge rely on (chip tones, alert-state set) and the age/cadence
 * formatters.
 */

import { describe, it, expect } from 'vitest';
import { stateMeta, isAlertState, fmtAge, fmtCadence } from '../segment-refresh-ops-data';
import type { DerivedRefreshState } from '../../../../types/segment-refresh-ops';

describe('stateMeta', () => {
  it('maps every derived state to a label + tone', () => {
    const states: DerivedRefreshState[] = ['healthy', 'due', 'in_flight', 'wedged', 'serving_stale', 'broken', 'degraded'];
    for (const s of states) {
      const m = stateMeta(s);
      expect(m.label.length).toBeGreaterThan(0);
      expect(['positive', 'info', 'warning', 'destructive', 'muted']).toContain(m.tone);
    }
  });

  it('flags wedged/broken destructive and degraded/serving_stale warning', () => {
    expect(stateMeta('wedged').tone).toBe('destructive');
    expect(stateMeta('broken').tone).toBe('destructive');
    expect(stateMeta('degraded').tone).toBe('warning');
    expect(stateMeta('serving_stale').tone).toBe('warning');
    expect(stateMeta('healthy').tone).toBe('positive');
  });
});

describe('isAlertState', () => {
  it('is true only for wedged, degraded, broken', () => {
    expect(isAlertState('wedged')).toBe(true);
    expect(isAlertState('degraded')).toBe(true);
    expect(isAlertState('broken')).toBe(true);
    expect(isAlertState('healthy')).toBe(false);
    expect(isAlertState('due')).toBe(false);
    expect(isAlertState('in_flight')).toBe(false);
    expect(isAlertState('serving_stale')).toBe(false);
  });
});

describe('fmtAge', () => {
  it('renders never / seconds / minutes / hours / days', () => {
    expect(fmtAge(null)).toBe('never');
    expect(fmtAge(5_000)).toBe('5s ago');
    expect(fmtAge(120_000)).toBe('2m ago');
    expect(fmtAge(3 * 3_600_000 + 4 * 60_000)).toBe('3h 4m ago');
    expect(fmtAge(2 * 86_400_000 + 3 * 3_600_000)).toBe('2d 3h ago');
  });
});

describe('fmtCadence', () => {
  it('renders minutes, exact hours, and mixed', () => {
    expect(fmtCadence(null)).toBe('—');
    expect(fmtCadence(45)).toBe('45m');
    expect(fmtCadence(60)).toBe('1h');
    expect(fmtCadence(1440)).toBe('24h');
    expect(fmtCadence(90)).toBe('1h 30m');
  });
});
