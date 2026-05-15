import { useEffect, useRef, useState } from 'react';
import { CubeApi, Filter, Query, ResultSet } from '@cubejs-client/core';

export interface FunnelStepResult {
  step: number;
  label: string;
  count: number;
  conversionPct: number;
  dropOffPct: number;
}

export interface FunnelQueryState {
  isLoading: boolean;
  error: string | null;
  failedStepIndex: number | null;
  results: FunnelStepResult[];
}

interface UseFunnelQueriesArgs {
  cubeApi: CubeApi | undefined;
  eventDim: string | undefined;
  measure: string | undefined;
  steps: string[];
  globalFilters: Filter[] | undefined;
}

function extractScalar(rs: ResultSet, measureKey: string): number {
  try {
    const raw = rs.rawData();

    if (Array.isArray(raw) && raw.length > 0) {
      const first = raw[0] as Record<string, unknown>;
      const value = Number(first?.[measureKey]);

      return Number.isFinite(value) ? value : 0;
    }
  } catch {
    /* fall through */
  }

  return 0;
}

export function useFunnelQueries({
  cubeApi,
  eventDim,
  measure,
  steps,
  globalFilters,
}: UseFunnelQueriesArgs): FunnelQueryState {
  const [state, setState] = useState<FunnelQueryState>({
    isLoading: false,
    error: null,
    failedStepIndex: null,
    results: [],
  });
  const reqId = useRef(0);

  useEffect(() => {
    if (!cubeApi || !eventDim || !measure || steps.length < 2) {
      setState({ isLoading: false, error: null, failedStepIndex: null, results: [] });
      return;
    }

    const myRequest = ++reqId.current;
    setState((prev) => ({ ...prev, isLoading: true, error: null, failedStepIndex: null }));

    const queries: Query[] = steps.map((stepValue) => ({
      measures: [measure],
      filters: [
        { member: eventDim, operator: 'equals', values: [stepValue] },
        ...(globalFilters ?? []),
      ] as Filter[],
    }));

    Promise.allSettled(queries.map((q) => cubeApi.load(q)))
      .then((settled) => {
        if (myRequest !== reqId.current) return;

        const failedIdx = settled.findIndex((r) => r.status === 'rejected');

        if (failedIdx >= 0) {
          const rejection = settled[failedIdx] as PromiseRejectedResult;
          setState({
            isLoading: false,
            error: rejection.reason?.message ?? String(rejection.reason),
            failedStepIndex: failedIdx,
            results: [],
          });
          return;
        }

        const counts = settled.map((r) => {
          const rs = (r as PromiseFulfilledResult<ResultSet>).value;
          return extractScalar(rs, measure);
        });
        const base = counts[0] || 0;

        const results: FunnelStepResult[] = steps.map((label, i) => {
          const count = counts[i];
          const prev = i === 0 ? count : counts[i - 1];

          return {
            step: i + 1,
            label,
            count,
            conversionPct: base > 0 ? (count / base) * 100 : 0,
            dropOffPct: prev > 0 ? (1 - count / prev) * 100 : 0,
          };
        });

        setState({ isLoading: false, error: null, failedStepIndex: null, results });
      });
  }, [cubeApi, eventDim, measure, steps.join('|'), JSON.stringify(globalFilters)]);

  return state;
}
