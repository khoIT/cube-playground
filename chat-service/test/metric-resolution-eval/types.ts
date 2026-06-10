/**
 * Shared types for the cfm_vn metric-resolution eval harness.
 * Corpus, baseline snapshot, and scorer result shapes.
 */

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------

export interface EvalCase {
  id: string;
  question: string;
  /** Expected business-metric id (null = direct cube ref, no metric lookup). */
  expectedMetricId: string | null;
  /** Expected primary Cube member ref, e.g. "recharge.revenue_vnd". */
  expectedRef: string | null;
  /** Expected cube name prefix, e.g. "recharge". */
  expectedCube: string | null;
  /** For ratio metrics: the two members the query must contain. */
  expectedRatioRef?: { numerator: string; denominator: string };
  /** Broad shape class for the emitted query. */
  queryShapeClass: 'trend' | 'aggregate' | 'ratio' | 'compare' | 'leaderboard' | 'explain' | null;
  /** Thematic group for regression tracking. */
  curationGroup: string;
  note?: string;
}

export interface EvalCorpus {
  _comment: string;
  capturedAt: string;
  gameId: string;
  cases: EvalCase[];
}

// ---------------------------------------------------------------------------
// Baseline snapshot (live run output)
// ---------------------------------------------------------------------------

export type ResultStatus =
  | 'ok'            // artifact emitted, done received
  | 'no-artifact'   // turn completed without emitting a query_artifact
  | 'turn-error'    // SSE error event or stream closed without done
  | 'http-error'    // non-200 HTTP response
  | 'infra-error';  // environmental failure (gateway 403/429, ECONNREFUSED)

export interface BaselineResult {
  caseId: string;
  question: string;
  status: ResultStatus;
  httpStatus: number;
  errorDetail?: string;
  toolCalls: string[];
  artifactCount: number;
  /** Extracted from query_artifact.sourceRef.id when source='business-metric'. */
  resolvedMetricId: string | null;
  /** Cube prefix inferred from the first measure of the first emitted query. */
  resolvedCube: string | null;
  /** All query objects from query_artifact events (one per artifact). */
  emittedQueries: unknown[];
  sessionId: string | null;
  capturedAt: string;
}

export interface BaselineSnapshot {
  capturedAt: string;
  gameId: string;
  workspace: string;
  chatBase: string;
  /** corpus.capturedAt from the source corpus file. */
  corpusVersion: string;
  results: BaselineResult[];
}

// ---------------------------------------------------------------------------
// Scorer output
// ---------------------------------------------------------------------------

export type MatchVerdict =
  | 'match'         // resolved metric + cube both match expected
  | 'mismatch'      // at least one field differs
  | 'query-shape-changed' // metric/cube match but emitted query shape differs from baseline
  | 'no-artifact'   // turn produced no artifact (was working in baseline)
  | 'newly-working' // no artifact in baseline, now produces one
  | 'both-failing'  // no artifact in both baseline and rerun
  | 'baseline-missing'; // no baseline entry for this case id

export interface ScoredCase {
  caseId: string;
  question: string;
  curationGroup: string;
  verdict: MatchVerdict;
  baseline: Pick<BaselineResult, 'resolvedMetricId' | 'resolvedCube' | 'status'> | null;
  rerun: Pick<BaselineResult, 'resolvedMetricId' | 'resolvedCube' | 'status'> | null;
  /** Set when verdict = 'query-shape-changed' — diff summary. */
  queryShapeDiff?: string;
  note?: string;
}

export interface ScoreReport {
  scoredAt: string;
  baselineFile: string;
  rerunFile: string;
  totalCases: number;
  match: number;
  mismatch: number;
  queryShapeChanged: number;
  noArtifact: number;
  newlyWorking: number;
  bothFailing: number;
  cases: ScoredCase[];
}
