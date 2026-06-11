/**
 * Pure worker-log parser for pre-aggregation sweep history.
 *
 * Splits JSON log lines on "Refresh Scheduler Interval" sweep-start markers,
 * then extracts ParsedFailure records from known error messages within each
 * sweep window.
 *
 * Key invariants:
 *   - Successful seals are TRACE-only (never at info) — we NEVER infer success
 *     from logs. Success = probe=built + absence of a log failure.
 *   - Non-JSON lines are silently skipped (Docker may emit non-JSON startup
 *     lines, health-check noise, etc.).
 *   - preAggregationId format: "<cubeName>.<rollupName>" — the cube name is
 *     everything before the first dot.
 */

import type { ParsedBuild, ParsedFailure, ParsedSweep } from '../types/preagg-run.js';

// ---------------------------------------------------------------------------
// Error signature classifier
// ---------------------------------------------------------------------------

/**
 * Normalize a raw error message into a short stable signature used for
 * grouping identical failure causes across sweeps.
 *
 * The mapping is ordered by specificity — more specific patterns first.
 * Returns 'unknown' for anything that doesn't match.
 */
export function classifyError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes('downloading external pre-aggregation')) return 'download-external';
  if (m.includes('table is not found after it was successfully created')) return 'table-not-found';
  if (m.includes('etimedout') || m.includes('connect etimedout')) return 'etimedout';
  if (m.includes('econnrefused')) return 'econnrefused';
  if (m.includes('error while querying') || m.includes('error querying db')) return 'query-error';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Known failure message patterns at info level
// ---------------------------------------------------------------------------

const FAILURE_MESSAGES = [
  'Error while querying',
  'Downloading external pre-aggregation error',
  'Error querying db',
];

/** Exported for the live build-progress aggregator, which classifies the same
 *  failure shapes over the same log stream. */
export function isFailureLine(message: string): boolean {
  return FAILURE_MESSAGES.some((pat) => message.includes(pat));
}

// ---------------------------------------------------------------------------
// JSON line parser
// ---------------------------------------------------------------------------

interface LogLine {
  /** ISO timestamp — may come from 'time', 'timestamp', '@timestamp', or 't' */
  ts: string;
  /** log message */
  message: string;
  /** Present on failure lines */
  preAggregationId?: string;
  /** Present on some failure lines (new table name being written) */
  newVersionEntry?: { table_name?: string };
  /** Alt field name seen in some Cube versions */
  targetTableName?: string;
  /** Raw error string */
  error?: string;
  /** Query duration in ms (string in the log JSON) — on completed lines. */
  duration?: number;
  /** Stringified query key — partition builds start with `[['CREATE TABLE …`. */
  queryKey?: string;
  /** Orchestrator queue — `…_CACHE_…` lines are metadata fetches, not builds. */
  queuePrefix?: string;
}

/**
 * Split an optional leading Docker RFC3339 timestamp from a log line.
 * The log reader requests `timestamps=1`, so payloads arrive as
 * `2026-06-11T06:17:35.236526456Z {json}` — the JSON body never starts the
 * line. Cube's own info-level JSON carries NO time field, so this prefix is
 * the only reliable per-line timestamp. Lines without the prefix (tests,
 * future reader changes) pass through unchanged.
 */
export function splitDockerTimestamp(line: string): { ts: string | null; body: string } {
  const m = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\s+(.*)$/.exec(line);
  if (m) return { ts: m[1], body: m[2] };
  return { ts: null, body: line };
}

export function parseJsonLine(line: string): LogLine | null {
  const { ts: dockerTs, body } = splitDockerTimestamp(line.trim());
  const trimmed = body.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const ts =
      (parsed['time'] as string) ??
      (parsed['timestamp'] as string) ??
      (parsed['@timestamp'] as string) ??
      (parsed['t'] as string) ??
      dockerTs ??
      new Date().toISOString();
    const message =
      (parsed['message'] as string) ??
      (parsed['msg'] as string) ??
      '';
    const rawDuration = parsed['duration'];
    return {
      ts,
      message,
      preAggregationId: parsed['preAggregationId'] as string | undefined,
      newVersionEntry: parsed['newVersionEntry'] as { table_name?: string } | undefined,
      targetTableName: parsed['targetTableName'] as string | undefined,
      error: parsed['error'] as string | undefined,
      duration: rawDuration != null ? Number(rawDuration) : undefined,
      queryKey: typeof parsed['queryKey'] === 'string' ? (parsed['queryKey'] as string) : undefined,
      queuePrefix: parsed['queuePrefix'] as string | undefined,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Parse an array of raw log lines (one line per element, as returned by the
 * Docker log reader) into structured ParsedSweep objects.
 *
 * Each sweep is delimited by a "Refresh Scheduler Interval" message.
 * Lines before the first such marker are ignored (server startup noise).
 */
/**
 * Extract a completed PARTITION BUILD from a log line, or null.
 * A build-completed line is 'Performing query completed' whose queryKey is a
 * `CREATE TABLE preagg_<game>.…` — the same message also fires for orchestrator
 * cache fetches ('Fetch tables for …', `…_CACHE_…` queue), which must not
 * count as partitions or inflate durations.
 */
function parseBuildLine(line: LogLine): ParsedBuild | null {
  if (!line.message.includes('Performing query completed')) return null;
  if (!line.preAggregationId) return null;
  if (line.queuePrefix?.includes('_CACHE_')) return null;
  const table = line.newVersionEntry?.table_name ?? line.queryKey ?? '';
  const schema = /(?:^|\s|\[\[')CREATE TABLE preagg_([a-z0-9]+)\./.exec(table)
    ?? /^preagg_([a-z0-9]+)\./.exec(table);
  if (!schema) return null;
  const dot = line.preAggregationId.indexOf('.');
  return {
    schemaGame: schema[1],
    cube: dot > 0 ? line.preAggregationId.slice(0, dot) : line.preAggregationId,
    rollup: dot > 0 ? line.preAggregationId.slice(dot + 1) : '',
    durationMs: Number.isFinite(line.duration) ? (line.duration as number) : 0,
    ts: line.ts,
  };
}

export function parseWorkerLog(lines: string[]): ParsedSweep[] {
  const sweeps: ParsedSweep[] = [];

  let currentStart: string | null = null;
  let currentLastTs: string = new Date().toISOString();
  let currentFailures: ParsedFailure[] = [];
  let currentBuilds: ParsedBuild[] = [];

  function flush(): void {
    if (currentStart === null) return;
    sweeps.push({
      startedAt: currentStart,
      endedAt: currentLastTs,
      failures: currentFailures,
      builds: currentBuilds,
    });
    currentStart = null;
    currentFailures = [];
    currentBuilds = [];
  }

  for (const raw of lines) {
    const parsed = parseJsonLine(raw);
    if (!parsed) continue;

    currentLastTs = parsed.ts;

    // Sweep-start marker — close previous sweep, open new one
    if (parsed.message.includes('Refresh Scheduler Interval')) {
      flush();
      currentStart = parsed.ts;
      continue;
    }

    // Collect completed partition builds within the active sweep window
    if (currentStart !== null) {
      const build = parseBuildLine(parsed);
      if (build) {
        currentBuilds.push(build);
        continue;
      }
    }

    // Collect failures within the active sweep window
    if (currentStart !== null && isFailureLine(parsed.message)) {
      const preAggId = parsed.preAggregationId ?? '';
      const rawError = parsed.error ?? parsed.message;
      const tableName =
        parsed.newVersionEntry?.table_name ?? parsed.targetTableName ?? undefined;

      currentFailures.push({
        preAggregationId: preAggId,
        tableName,
        errorSig: classifyError(rawError),
        errorMessage: rawError,
        ts: parsed.ts,
      });
    }
  }

  // Flush the last open sweep (still in progress or collector caught it mid-run)
  flush();

  return sweeps;
}
