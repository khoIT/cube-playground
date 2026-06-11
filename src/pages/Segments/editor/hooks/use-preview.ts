/**
 * Debounced /api/preview hook for the segment editor.
 * Drops in-flight requests via AbortController when the tree changes.
 */

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../../../api/api-client';
import type { PredicateNode } from '../../../../types/segment-api';

interface PreviewResponse {
  estimated_count: number | null;
  cube_query: unknown;
  sql_preview: string | null;
  took_ms: number;
  cached: boolean;
}

interface UsePreviewArgs {
  tree: PredicateNode;
  primaryCube: string | null;
  /** Cube-level segments scoping the cohort (e.g. mf_users.whales) — without
   *  them the live count previews the unsegmented population. */
  cubeSegments?: string[];
  enabled: boolean;
  debounceMs?: number;
}

interface UsePreviewState {
  count: number | null;
  sql: string | null;
  loading: boolean;
  error: string | null;
  ringBuffer: number[];
}

const RING_SIZE = 14;

export function usePreview({
  tree,
  primaryCube,
  cubeSegments,
  enabled,
  debounceMs = 500,
}: UsePreviewArgs): UsePreviewState {
  const [state, setState] = useState<UsePreviewState>({
    count: null,
    sql: null,
    loading: false,
    error: null,
    ringBuffer: [],
  });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled || !primaryCube) return;

    const handle = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState((s) => ({ ...s, loading: true, error: null }));

      apiFetch<PreviewResponse>('/api/preview', {
        method: 'POST',
        body: {
          predicate_tree: tree,
          primary_cube: primaryCube,
          ...(cubeSegments && cubeSegments.length > 0 ? { cube_segments: cubeSegments } : {}),
        },
        signal: controller.signal,
      })
        .then((res) => {
          setState((s) => ({
            count: res.estimated_count,
            sql: res.sql_preview,
            loading: false,
            error: null,
            ringBuffer: res.estimated_count != null
              ? [...s.ringBuffer, res.estimated_count].slice(-RING_SIZE)
              : s.ringBuffer,
          }));
        })
        .catch((err: Error & { name?: string }) => {
          if (err.name === 'AbortError') return;
          setState((s) => ({ ...s, loading: false, error: err.message }));
        });
    }, debounceMs);

    return () => {
      clearTimeout(handle);
    };
  }, [JSON.stringify(tree), primaryCube, (cubeSegments ?? []).join(','), enabled, debounceMs]);

  return state;
}
