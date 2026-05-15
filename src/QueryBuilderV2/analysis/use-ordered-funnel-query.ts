import { useEffect, useRef, useState } from 'react';
import { CubeApi, Filter, Query, ResultSet } from '@cubejs-client/core';

import { FunnelQueryState, FunnelStepResult } from './use-funnel-queries';
import { OrderedFunnelCubeRef } from './detect-ordered-funnel';

interface UseOrderedFunnelQueryArgs {
  cubeApi: CubeApi | undefined;
  orderedCube: OrderedFunnelCubeRef | null;
  steps: string[];
  globalFilters: Filter[] | undefined;
}

export function useOrderedFunnelQuery({
  cubeApi,
  orderedCube,
  steps,
  globalFilters,
}: UseOrderedFunnelQueryArgs): FunnelQueryState {
  const [state, setState] = useState<FunnelQueryState>({
    isLoading: false,
    error: null,
    failedStepIndex: null,
    results: [],
  });
  const reqId = useRef(0);

  useEffect(() => {
    if (!cubeApi || !orderedCube || steps.length < 2) {
      setState({ isLoading: false, error: null, failedStepIndex: null, results: [] });
      return;
    }

    const myRequest = ++reqId.current;
    setState((prev) => ({ ...prev, isLoading: true, error: null, failedStepIndex: null }));

    const query: Query = {
      measures: [orderedCube.stepCountMeasure],
      dimensions: [orderedCube.stepIndexDimension],
      filters: [
        {
          member: orderedCube.stepNameDimension,
          operator: 'equals',
          values: steps,
        },
        ...((globalFilters ?? []) as Filter[]),
      ] as Filter[],
      order: { [orderedCube.stepIndexDimension]: 'asc' },
    };

    cubeApi
      .load(query)
      .then((rs: ResultSet) => {
        if (myRequest !== reqId.current) return;

        const raw = rs.rawData();
        const countByStep = new Map<number, number>();

        for (const row of raw as Array<Record<string, unknown>>) {
          const idx = Number(row?.[orderedCube.stepIndexDimension]);
          const count = Number(row?.[orderedCube.stepCountMeasure]);

          if (Number.isFinite(idx) && Number.isFinite(count)) {
            countByStep.set(idx, count);
          }
        }

        const counts = steps.map((_, i) => countByStep.get(i + 1) ?? 0);
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
      })
      .catch((err: any) => {
        if (myRequest !== reqId.current) return;
        setState({
          isLoading: false,
          error: err?.message ?? String(err),
          failedStepIndex: null,
          results: [],
        });
      });
  }, [cubeApi, orderedCube?.name, steps.join('|'), JSON.stringify(globalFilters)]);

  return state;
}
