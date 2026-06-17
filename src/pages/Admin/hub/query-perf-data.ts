/**
 * Data hooks for the Query Performance admin tab.
 *
 * All requests go through apiFetch (auto Bearer JWT) — the routes require
 * admin. Summary + failures poll on a 60s cadence (mirrors usePreaggRuns); the
 * success list is fetched lazily (only when the collapsed section is expanded).
 * Suggestion / scaffold / llm-suggest are on-demand (admin clicks a row).
 */

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../api/api-client';

export type PreaggHit = 'hit' | 'miss' | 'unknown';
export type Matchability = 'matchable' | 'unmatchable' | 'partial';

export interface QueryShape {
  cubes: string[];
  measures: string[];
  dimensions: string[];
}

export interface QueryPerfRowDto {
  id: number;
  ts: number;
  actorEmail: string | null;
  workspace: string | null;
  game: string | null;
  method: string;
  status: number;
  latencyMs: number;
  usedPreaggs: string[];
  preaggHit: PreaggHit;
  matchability: Matchability;
  reason: string;
  shape: QueryShape | null;
  errorExcerpt: string | null;
  /** Verbatim query (incl. values/dateRange) — admin-only. */
  queryFull: unknown | null;
  /** Originating app route, e.g. "/dashboards/123"; null for API callers. */
  source: string | null;
  /** Resolved name for a `segment:<id>` source; null otherwise. */
  segmentName: string | null;
}

export interface QueryPerfSummaryDto {
  total: number;
  failures: number;
  slow: number;
  fallthrough: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  /** Effective slow threshold (ms) from server config — render from this, not a hardcoded 3000. */
  slowMs: number;
}

export interface PlaybookDto {
  id: string;
  title: string;
  rationale: string;
  steps: string[];
  scaffolds: 'rollup' | null;
}

export interface SuggestionDto {
  verdict: { preaggHit: PreaggHit; matchability: Matchability; reason: string };
  playbooks: PlaybookDto[];
  best: PlaybookDto | null;
  needsLlm: boolean;
}

export interface ScaffoldDto {
  yaml: string | null;
  warnings: string[];
}

const POLL_MS = 60_000;

export function useQueryPerfSummary(sinceMs?: number) {
  const [summary, setSummary] = useState<QueryPerfSummaryDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const qs = sinceMs ? `?since=${sinceMs}` : '';
  const refetch = useCallback(() => {
    apiFetch<QueryPerfSummaryDto>(`/api/query-perf/summary${qs}`)
      .then(setSummary)
      .catch((e: Error) => setError(e.message));
  }, [qs]);

  useEffect(() => { refetch(); }, [refetch]);
  useEffect(() => {
    const t = setInterval(refetch, POLL_MS);
    return () => clearInterval(t);
  }, [refetch]);

  return { summary, error, refetch };
}

export function useQueryPerfFailures(sinceMs?: number, limit = 200) {
  const [rows, setRows] = useState<QueryPerfRowDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const qs = `?limit=${limit}${sinceMs ? `&since=${sinceMs}` : ''}`;
  const refetch = useCallback(() => {
    setLoading(true);
    apiFetch<{ rows: QueryPerfRowDto[] }>(`/api/query-perf/failures${qs}`)
      .then((d) => setRows(d.rows ?? []))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [qs]);

  useEffect(() => { refetch(); }, [refetch]);
  useEffect(() => {
    const t = setInterval(refetch, POLL_MS);
    return () => clearInterval(t);
  }, [refetch]);

  return { rows, loading, error, refetch };
}

/** Lazy success list — only fetches when `enabled` flips true (on expand). */
export function useQueryPerfRecent(enabled: boolean, sinceMs?: number, limit = 200) {
  const [rows, setRows] = useState<QueryPerfRowDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const qs = `?limit=${limit}${sinceMs ? `&since=${sinceMs}` : ''}`;
  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    apiFetch<{ rows: QueryPerfRowDto[] }>(`/api/query-perf/recent${qs}`)
      .then((d) => setRows(d.rows ?? []))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [enabled, qs]);

  return { rows, loading, error };
}

/** On-demand suggestion (playbooks + best + needsLlm) for one captured row. */
export function useQueryPerfSuggestion(id: number | null) {
  const [suggestion, setSuggestion] = useState<SuggestionDto | null>(null);
  const [scaffold, setScaffold] = useState<ScaffoldDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id === null) { setSuggestion(null); setScaffold(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setScaffold(null);
    apiFetch<SuggestionDto>(`/api/query-perf/${id}/suggestion`)
      .then((s) => {
        if (cancelled) return;
        setSuggestion(s);
        // Fetch the draft rollup only when the best remedy scaffolds one.
        if (s.best?.scaffolds === 'rollup') {
          return apiFetch<ScaffoldDto>(`/api/query-perf/${id}/scaffold`)
            .then((sc) => { if (!cancelled) setScaffold(sc); })
            .catch(() => { /* draft is best-effort */ });
        }
      })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  return { suggestion, scaffold, loading, error };
}

/** On-demand LLM remedy — only valid when the suggestion has needsLlm. */
export function useLlmSuggest() {
  const [result, setResult] = useState<{ suggestion?: string; lane?: string; error?: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const generate = useCallback((id: number) => {
    setLoading(true);
    setResult(null);
    apiFetch<{ suggestion?: string; lane?: string; error?: string }>(`/api/query-perf/${id}/llm-suggest`, { method: 'POST' })
      .then(setResult)
      .catch((e: Error) => setResult({ error: e.message }))
      .finally(() => setLoading(false));
  }, []);

  const reset = useCallback(() => setResult(null), []);
  return { result, loading, generate, reset };
}
