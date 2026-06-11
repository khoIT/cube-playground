/**
 * In-memory, per-segment live progress for a card-runner pass.
 *
 * The segment-refresh job recomputes ~30 KPI/card Cube queries per cohort, but
 * the result only lands in SQLite once the whole pass finishes (one batched
 * upsert). Between "Refreshing" and "done" there was no way to see which card is
 * in flight, which sealed, which failed — the monitor just showed the prior
 * pass until the new one completed.
 *
 * This module holds a tiny live picture of the CURRENT (or most recent) pass per
 * segment so an operator expanding a Refreshing row can watch the cards fill in.
 * It is process-local and ephemeral by design (mirrors preagg-trigger): lost on
 * restart, reflects only the gateway that ran the job. Both the cron and the
 * manual Refresh button drive refreshSegment(), so both populate this.
 *
 * Only the latest run per segment is retained — beginRun overwrites it — so the
 * map is bounded by the number of segments that have ever refreshed this boot.
 */

export type CardPhase = 'queued' | 'running' | 'ok' | 'error';

export interface CardProgressEntry {
  cardId: string;
  phase: CardPhase;
}

export interface SegmentCardProgress {
  segmentId: string;
  startedAt: string;
  /** ISO when the pass ended; null while still running. */
  finishedAt: string | null;
  total: number;
  /** ok + error (settled cards). */
  done: number;
  ok: number;
  error: number;
  /** Per-card phase, in the card-runner's spec order (stable — no reshuffling). */
  cards: CardProgressEntry[];
}

interface RunState {
  startedAt: string;
  finishedAt: string | null;
  /** Spec order, so the rendered checklist never reshuffles between polls. */
  order: string[];
  phases: Map<string, CardPhase>;
}

const runs = new Map<string, RunState>();

/** Seed a fresh run: every card queued, clock started. Replaces any prior run
 *  for this segment (we only ever surface the latest pass). */
export function beginRun(segmentId: string, cardIds: string[]): void {
  const phases = new Map<string, CardPhase>();
  for (const id of cardIds) phases.set(id, 'queued');
  runs.set(segmentId, {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    order: [...cardIds],
    phases,
  });
}

/** A card's Cube load just started. No-op if the run/card is unknown (e.g. the
 *  reporter fired before beginRun, or after a newer run replaced this one). */
export function markRunning(segmentId: string, cardId: string): void {
  const run = runs.get(segmentId);
  if (!run || !run.phases.has(cardId)) return;
  run.phases.set(cardId, 'running');
}

/** A card settled — ok or error. */
export function markSettled(segmentId: string, cardId: string, status: 'ok' | 'error'): void {
  const run = runs.get(segmentId);
  if (!run || !run.phases.has(cardId)) return;
  run.phases.set(cardId, status);
}

/** Close the run — stamps finishedAt. Any cards still 'queued'/'running' (e.g.
 *  the pass threw before they settled) stay as-is so the final state is honest. */
export function endRun(segmentId: string): void {
  const run = runs.get(segmentId);
  if (!run) return;
  run.finishedAt = new Date().toISOString();
}

/** Materialize the live view for a segment, or null if no run was ever seen. */
export function getCardProgress(segmentId: string): SegmentCardProgress | null {
  const run = runs.get(segmentId);
  if (!run) return null;

  let ok = 0;
  let error = 0;
  const cards: CardProgressEntry[] = run.order.map((cardId) => {
    const phase = run.phases.get(cardId) ?? 'queued';
    if (phase === 'ok') ok += 1;
    else if (phase === 'error') error += 1;
    return { cardId, phase };
  });

  return {
    segmentId,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    total: cards.length,
    done: ok + error,
    ok,
    error,
    cards,
  };
}

/** Test-only: drop all tracked runs. */
export function __resetCardProgress(): void {
  runs.clear();
}
