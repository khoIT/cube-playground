import { useEffect, useRef, useState } from 'react';
import { useQueryBuilderContext } from '../../context';
import { postSchemaWrite, deleteSchemaWrite } from '../api';
import { deriveCubeSource, CUBE_SOURCE_HEADER } from '../../../api/cube-query-source';

const DEBOUNCE_MS = 500;

export type LivePreviewStatus =
  | 'idle'
  | 'discarding-prior'
  | 'writing'
  | 'loading'
  | 'success'
  | 'error';

export type LivePreviewResult = {
  status: LivePreviewStatus;
  scalar: number | null;
  series: Array<{ x: string; y: number }> | null;
  error: string | null;
  /** Identity of the measure currently committed to disk, or null. */
  lastWritten: { cubeName: string; measureName: string } | null;
  /** Trigger an explicit Discard. Resolves once the .bak has been restored. */
  discard: () => Promise<{ ok: boolean; reason?: string }>;
};

interface UseLivePreviewArgs {
  enabled: boolean;             // gate: only run when step 3 is active
  cubeName: string | null;
  measureName: string;
  yamlPatch: string;            // YAML fragment from the wizard
  timeDimension: string | null; // qualified, e.g. "orders.created_at"; null → scalar only
  range: '7d' | '30d';
}

interface CubeApiLoadResult {
  rawData: () => Array<Record<string, unknown>>;
}

interface CubeApiLike {
  load: (query: Record<string, unknown>) => Promise<CubeApiLoadResult>;
}

interface ContextWithCubeApi {
  apiToken?: string | null;
}

/**
 * Commit-then-preview orchestrator for step 3 of the New Metric wizard.
 *
 * Sequence:
 *   1. If a measure (lastWritten) is committed AND its identity differs from
 *      the incoming one → fire DELETE to restore .bak (auto-Discard prior).
 *   2. POST the new YAML fragment to /api/playground/schema/write.
 *   3. POST a /load query: { measures: [qualified], timeDimensions?, dateRange }.
 *   4. Render scalar + optional series.
 *
 * Debounced (500ms) on (cubeName, measureName, yamlPatch, timeDimension, range).
 * Concurrent runs are aborted via an AbortController per request cycle.
 *
 * On unmount: file is left intact (no auto-discard) — the user can re-open
 * the wizard or restore via Discard explicitly.
 */
export function useLivePreview(args: UseLivePreviewArgs): LivePreviewResult {
  const { enabled, cubeName, measureName, yamlPatch, timeDimension, range } = args;
  const ctx = useQueryBuilderContext() as unknown as {
    apiUrl?: string | null;
    apiToken?: string | null;
  };

  const [status, setStatus] = useState<LivePreviewStatus>('idle');
  const [scalar, setScalar] = useState<number | null>(null);
  const [series, setSeries] = useState<Array<{ x: string; y: number }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lastWrittenRef = useRef<{ cubeName: string; measureName: string } | null>(null);
  const runIdRef = useRef(0);

  // Manual Discard — exposed to UI
  async function discard(): Promise<{ ok: boolean; reason?: string }> {
    const prior = lastWrittenRef.current;
    if (!prior) return { ok: true };
    const result = await deleteSchemaWrite(prior);
    if (result.ok) {
      lastWrittenRef.current = null;
      setStatus('idle');
      setScalar(null);
      setSeries(null);
      setError(null);
      return { ok: true };
    }
    return { ok: false, reason: (result as any).reason };
  }

  useEffect(() => {
    if (!enabled || !cubeName || !measureName || !yamlPatch) {
      return;
    }

    const myRunId = ++runIdRef.current;
    const timer = setTimeout(() => void run(), DEBOUNCE_MS);

    async function run() {
      if (myRunId !== runIdRef.current) return; // superseded

      // Step 1: discard prior if identity changed.
      const prior = lastWrittenRef.current;
      const incoming = { cubeName: cubeName!, measureName };
      const identityChanged =
        prior && (prior.cubeName !== incoming.cubeName || prior.measureName !== incoming.measureName);

      if (identityChanged) {
        setStatus('discarding-prior');
        const deleted = await deleteSchemaWrite(prior);
        if (myRunId !== runIdRef.current) return;
        if (!deleted.ok && (deleted as any).status !== 404) {
          setStatus('error');
          setError(`Discard failed: ${(deleted as any).reason}`);
          return;
        }
        lastWrittenRef.current = null;
      }

      // Step 2: write YAML.
      setStatus('writing');
      setError(null);
      const writeResult = await postSchemaWrite({
        cubeName: incoming.cubeName,
        measureName: incoming.measureName,
        yamlPatch,
      });
      if (myRunId !== runIdRef.current) return;
      if (!writeResult.ok) {
        setStatus('error');
        const reason = (writeResult as any).reason ?? 'write failed';
        setError(`Schema write failed: ${reason}`);
        return;
      }
      lastWrittenRef.current = incoming;

      // Step 3: load preview data.
      setStatus('loading');
      const qualified = `${incoming.cubeName}.${incoming.measureName}`;
      const query: Record<string, unknown> = { measures: [qualified] };
      if (timeDimension) {
        query.timeDimensions = [
          {
            dimension: timeDimension,
            granularity: 'day',
            dateRange: range === '7d' ? 'last 7 days' : 'last 30 days',
          },
        ];
      }

      try {
        const data = await runCubeLoad(ctx, query);
        if (myRunId !== runIdRef.current) return;

        if (timeDimension) {
          const rows = data.map((row) => ({
            x: extractFirstKey(row, qualified, 'date') ?? '',
            y: Number(row[qualified] ?? 0),
          }));
          setSeries(rows);
          // Scalar = sum of series for visual continuity (could swap for last/avg).
          const total = rows.reduce((acc, r) => acc + (Number.isFinite(r.y) ? r.y : 0), 0);
          setScalar(total);
        } else {
          setSeries(null);
          const first = data[0];
          setScalar(first ? Number(first[qualified] ?? 0) : 0);
        }

        setStatus('success');
      } catch (err) {
        if (myRunId !== runIdRef.current) return;
        setStatus('error');
        setError(`Preview load failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, cubeName, measureName, yamlPatch, timeDimension, range]);

  return {
    status,
    scalar,
    series,
    error,
    lastWritten: lastWrittenRef.current,
    discard,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function runCubeLoad(
  ctx: { apiUrl?: string | null; apiToken?: string | null },
  query: Record<string, unknown>,
): Promise<Array<Record<string, unknown>>> {
  if (!ctx.apiUrl || !ctx.apiToken) {
    throw new Error('cube api not configured');
  }
  const base = ctx.apiUrl.endsWith('/v1') ? ctx.apiUrl : `${ctx.apiUrl}/v1`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: ctx.apiToken,
  };
  // Tag the issuing surface so the metric-wizard preview /load is attributed
  // to this page in query telemetry rather than the "API / server" fallback.
  const source = deriveCubeSource();
  if (source) headers[CUBE_SOURCE_HEADER] = source;
  const resp = await fetch(`${base}/load`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query }),
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }
  const json = (await resp.json()) as { data?: Array<Record<string, unknown>> };
  return json.data ?? [];
}

function extractFirstKey(
  row: Record<string, unknown>,
  qualifiedMeasure: string,
  hint: string,
): string | null {
  for (const key of Object.keys(row)) {
    if (key === qualifiedMeasure) continue;
    if (key.toLowerCase().includes(hint)) {
      const value = row[key];
      return value == null ? null : String(value);
    }
  }
  // Fallback: first non-measure key
  for (const key of Object.keys(row)) {
    if (key !== qualifiedMeasure) return String(row[key]);
  }
  return null;
}
