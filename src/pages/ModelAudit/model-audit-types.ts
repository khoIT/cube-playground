/**
 * Shared types for the Model Audit console — mirror the server's
 * /api/cube-parity/* response shapes (cube-parity routes + cube-model-diff).
 */

export interface ParityRun {
  id: number;
  startedAt: number;
  finishedAt: number | null;
  status: string;
  devGitSha: string | null;
  prodCloneSha: string | null;
  prodUpstreamSha: string | null;
  games: string[];
  countCorrectness: number;
  countParity: number;
  countCosmetic: number;
  parseErrorCount: number;
  errorMessage: string | null;
}

export type Severity = 'correctness' | 'parity' | 'cosmetic';

export interface ParityFinding {
  id: number;
  game: string;
  cube: string;
  dimension: string;
  severity: string;
  devValue: string | null;
  oracleValue: string | null;
  detail: string | null;
  file: string | null;
  line: number | null;
  verdict: string | null;
  rootCauseKey: string;
}

export interface RunCube {
  game: string;
  cube: string;
  hasProd: boolean;
}

export interface RunDetail {
  run: ParityRun;
  cubes: RunCube[];
}

export interface FieldChange {
  field: string;
  kind: 'added' | 'removed' | 'changed';
  name?: string;
  before: string | null;
  after: string | null;
}

export interface StructuredDiff {
  devPresent: boolean;
  prodPresent: boolean;
  changes: FieldChange[];
}

export interface UnifiedDiffLine {
  kind: 'ctx' | 'add' | 'del';
  text: string;
}

export interface TextDiff {
  lines: UnifiedDiffLine[];
  added: number;
  removed: number;
}

export interface DevVsProdDiff {
  game: string;
  cube: string;
  runId: number;
  devPath: string | null;
  prodPath: string | null;
  noCounterpart: boolean;
  structured: StructuredDiff;
  text: TextDiff;
}

export interface VersionDiff {
  game: string;
  cube: string;
  fromRunId: number;
  toRunId: number;
  structured: StructuredDiff;
  text: TextDiff;
}

export interface CubeVersion {
  runId: number;
  startedAt: number;
  contentHash: string;
  byteLength: number;
  changed: boolean;
}

export interface ProdCloneStatus {
  root: string;
  available: boolean;
  localSha: string | null;
  upstreamSha: string | null;
  behind: number | null;
  ahead: number | null;
  lastFetchAt: number | null;
  branch: string | null;
  error: string | null;
}

export interface RefreshResult {
  ok: boolean;
  localSha: string | null;
  changedFiles: string[];
  message: string;
}

export interface RunAuditResult {
  runId: number;
  counts: { correctness: number; parity: number; cosmetic: number };
  findingCount: number;
  newBlobs: number;
}

/** Worst-severity ranking for heatmap cell coloring (higher = worse). */
export const SEVERITY_RANK: Record<string, number> = {
  correctness: 3,
  parity: 2,
  cosmetic: 1,
};
