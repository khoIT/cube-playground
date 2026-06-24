import { describe, it, expect } from 'vitest';
import { buildMockEvents, isMockEvent } from '../mock-events';

const FROM = '2026-06-01';
const TO = '2026-06-30';

describe('buildMockEvents', () => {
  it('maps every event inside the real [from, to] window', () => {
    const events = buildMockEvents(FROM, TO, 'cfm_vn');
    expect(events.length).toBeGreaterThan(0);
    for (const { annotation } of events) {
      expect(annotation.starts_at >= FROM).toBe(true);
      // ranged events end on/before window end
      const end = annotation.ends_at ?? annotation.starts_at;
      expect(end <= TO).toBe(true);
    }
  });

  it('uses negative ids so mocks never collide with real rows', () => {
    const events = buildMockEvents(FROM, TO, 'cfm_vn');
    for (const { annotation } of events) {
      expect(annotation.id).toBeLessThan(0);
      expect(isMockEvent(annotation)).toBe(true);
      expect(annotation.game).toBe('cfm_vn');
      expect(annotation.created_by).toBe('mock');
    }
  });

  it('attaches at least one impact stat per event', () => {
    for (const { stats } of buildMockEvents(FROM, TO, 'cfm_vn')) {
      expect(stats.length).toBeGreaterThan(0);
      for (const [label, value] of stats) {
        expect(typeof label).toBe('string');
        expect(typeof value).toBe('string');
      }
    }
  });

  it('produces at least one ranged (multi-day) event', () => {
    const ranged = buildMockEvents(FROM, TO, 'cfm_vn').filter((e) => e.annotation.ends_at != null);
    expect(ranged.length).toBeGreaterThan(0);
  });

  it('returns nothing for a degenerate / inverted range', () => {
    expect(buildMockEvents(TO, FROM, 'cfm_vn')).toHaveLength(0);
    expect(buildMockEvents('', '', 'cfm_vn')).toHaveLength(0);
  });

  it('a real (positive-id) annotation is not flagged as mock', () => {
    expect(isMockEvent({ id: 42, game: 'cfm_vn', type: 'patch', title: 't', starts_at: FROM, ends_at: null, url: null, created_by: 'x', created_at: 0 })).toBe(false);
  });
});
