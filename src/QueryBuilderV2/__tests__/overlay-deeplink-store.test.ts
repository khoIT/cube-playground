/**
 * Tests for the durable overlay deeplink store: a saved overlay round-trips and
 * SURVIVES re-reads (the refresh case — never consumed), unknown ids return
 * null, and the FIFO index caps retention so the store can't grow unbounded.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { saveOverlayPayload, loadOverlayPayload } from '../overlay-deeplink-store';

beforeEach(() => localStorage.clear());

describe('overlay-deeplink-store', () => {
  it('round-trips a saved overlay and re-reads it (refresh keeps it)', () => {
    saveOverlayPayload('A1', { measures: ['b.n'] });
    expect(loadOverlayPayload('A1')).toEqual({ measures: ['b.n'] });
    // A second read (simulating a refresh) still resolves — not one-shot.
    expect(loadOverlayPayload('A1')).toEqual({ measures: ['b.n'] });
  });

  it('returns null for an unknown id', () => {
    expect(loadOverlayPayload('nope')).toBeNull();
  });

  it('caps retention to 20 — the oldest overlay is evicted', () => {
    for (let i = 0; i < 22; i++) saveOverlayPayload(`id${i}`, { measures: [`m${i}`] });
    // First two were evicted by the FIFO cap; the most recent survive.
    expect(loadOverlayPayload('id0')).toBeNull();
    expect(loadOverlayPayload('id1')).toBeNull();
    expect(loadOverlayPayload('id21')).toEqual({ measures: ['m21'] });
    expect(loadOverlayPayload('id2')).toEqual({ measures: ['m2'] });
  });

  it('re-saving an id refreshes its recency (not evicted as oldest)', () => {
    saveOverlayPayload('keep', { measures: ['x'] });
    for (let i = 0; i < 19; i++) saveOverlayPayload(`f${i}`, { measures: [`f${i}`] });
    saveOverlayPayload('keep', { measures: ['x2'] }); // bump recency
    saveOverlayPayload('extra', { measures: ['e'] }); // pushes count past cap
    expect(loadOverlayPayload('keep')).toEqual({ measures: ['x2'] });
  });
});
