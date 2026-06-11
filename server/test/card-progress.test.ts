/**
 * Live per-card refresh progress registry.
 *
 * Pins the lifecycle a card-runner pass drives: beginRun seeds every card
 * queued, markRunning/markSettled advance phases, getCardProgress tallies
 * ok/error/done in stable spec order, endRun stamps finishedAt without
 * disturbing unsettled cards, and a newer beginRun replaces the prior run.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  beginRun,
  markRunning,
  markSettled,
  endRun,
  getCardProgress,
  __resetCardProgress,
} from '../src/services/card-progress.js';

const SEG = 'seg-1';

beforeEach(() => __resetCardProgress());

describe('card-progress', () => {
  it('returns null for a segment that never ran', () => {
    expect(getCardProgress('unknown')).toBeNull();
  });

  it('seeds every card as queued on beginRun', () => {
    beginRun(SEG, ['kpi:a', 'card:b', 'card:c']);
    const p = getCardProgress(SEG)!;
    expect(p.total).toBe(3);
    expect(p.done).toBe(0);
    expect(p.ok).toBe(0);
    expect(p.error).toBe(0);
    expect(p.finishedAt).toBeNull();
    expect(p.cards.map((c) => c.phase)).toEqual(['queued', 'queued', 'queued']);
  });

  it('preserves spec order regardless of settle order', () => {
    beginRun(SEG, ['kpi:a', 'card:b', 'card:c']);
    markSettled(SEG, 'card:c', 'ok');
    markSettled(SEG, 'kpi:a', 'error');
    const p = getCardProgress(SEG)!;
    expect(p.cards.map((c) => c.cardId)).toEqual(['kpi:a', 'card:b', 'card:c']);
  });

  it('advances running → ok/error and tallies done/ok/error', () => {
    beginRun(SEG, ['kpi:a', 'card:b', 'card:c']);
    markRunning(SEG, 'kpi:a');
    markSettled(SEG, 'kpi:a', 'ok');
    markRunning(SEG, 'card:b');
    markSettled(SEG, 'card:b', 'error');

    const p = getCardProgress(SEG)!;
    expect(p.ok).toBe(1);
    expect(p.error).toBe(1);
    expect(p.done).toBe(2);
    const byId = Object.fromEntries(p.cards.map((c) => [c.cardId, c.phase]));
    expect(byId).toEqual({ 'kpi:a': 'ok', 'card:b': 'error', 'card:c': 'queued' });
  });

  it('endRun stamps finishedAt and leaves unsettled cards in place', () => {
    beginRun(SEG, ['kpi:a', 'card:b']);
    markSettled(SEG, 'kpi:a', 'ok');
    markRunning(SEG, 'card:b'); // never settled (pass threw mid-flight)
    endRun(SEG);

    const p = getCardProgress(SEG)!;
    expect(p.finishedAt).not.toBeNull();
    const byId = Object.fromEntries(p.cards.map((c) => [c.cardId, c.phase]));
    expect(byId).toEqual({ 'kpi:a': 'ok', 'card:b': 'running' });
  });

  it('ignores markRunning/markSettled for unknown card or segment', () => {
    beginRun(SEG, ['kpi:a']);
    markRunning(SEG, 'card:ghost'); // not in plan
    markSettled('other-seg', 'kpi:a', 'ok'); // no run
    const p = getCardProgress(SEG)!;
    expect(p.cards).toEqual([{ cardId: 'kpi:a', phase: 'queued' }]);
  });

  it('replaces the prior run when a newer beginRun arrives', () => {
    beginRun(SEG, ['kpi:a', 'card:b']);
    markSettled(SEG, 'kpi:a', 'ok');
    endRun(SEG);

    beginRun(SEG, ['kpi:x']); // newer pass — only the latest is surfaced
    const p = getCardProgress(SEG)!;
    expect(p.total).toBe(1);
    expect(p.finishedAt).toBeNull();
    expect(p.cards).toEqual([{ cardId: 'kpi:x', phase: 'queued' }]);
  });
});
