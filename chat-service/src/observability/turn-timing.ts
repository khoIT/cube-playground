/**
 * Lightweight per-turn stage timer for the /agent/turn pipeline.
 *
 * Records monotonic durations between named stage boundaries and emits one
 * structured log line at the turn's exit, so a live turn yields real per-stage
 * numbers (acquire → compose → meta-hash → cache-lookup → first-token →
 * llm-done → persist). Used to verify where turn latency actually goes before
 * committing to a refactor.
 *
 * `performance.now()` is sub-microsecond, so marking is effectively free; the
 * log line is gated behind CHAT_TURN_PROFILING so production stays quiet.
 */

import { config } from '../config.js';

export interface StageMark {
  label: string;
  /** ms since the timer started, at the moment this mark was recorded. */
  at: number;
  /** ms since the previous mark (or start, for the first mark). */
  delta: number;
}

export interface TurnTimer {
  /** Record a stage boundary. No-op cost beyond a performance.now() read. */
  mark(label: string): void;
  /**
   * Emit the collected marks as a single structured log line and return the
   * summary. Safe to call once per exit path (cache-hit / finish / error).
   */
  flush(logger: { info: (obj: unknown, msg?: string) => void }, outcome: string): TurnTimingSummary;
}

export interface TurnTimingSummary {
  turnId: string;
  outcome: string;
  totalMs: number;
  stages: StageMark[];
}

/**
 * Create a stage timer bound to a turnId. `enabled` defaults to the
 * CHAT_TURN_PROFILING config flag but is injectable for tests.
 */
export function createTurnTimer(
  turnId: string,
  enabled: boolean = config.chatTurnProfilingEnabled,
): TurnTimer {
  const start = performance.now();
  let last = start;
  const stages: StageMark[] = [];

  return {
    mark(label: string): void {
      if (!enabled) return;
      const now = performance.now();
      stages.push({
        label,
        at: round(now - start),
        delta: round(now - last),
      });
      last = now;
    },
    flush(logger, outcome): TurnTimingSummary {
      const summary: TurnTimingSummary = {
        turnId,
        outcome,
        totalMs: round(performance.now() - start),
        stages,
      };
      if (enabled) {
        logger.info({ turnTiming: summary }, '[turn] timing');
      }
      return summary;
    },
  };
}

function round(ms: number): number {
  return Math.round(ms * 100) / 100;
}
