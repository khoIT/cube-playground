/** Composition card — donut + bar list — driven by a preset CompositionCardSpec. */

import { ReactElement, useMemo } from 'react';
import type { Query } from '@cubejs-client/core';
import { CompositionCard as VisualCompositionCard } from '../../visuals';
import { CardShell } from './card-shell';
import { useSegmentCubeQuery } from '../use-segment-cube-query';
import { getCachedRows, isCacheFresh } from './use-card-cache-lookup';
import type { CompositionCardSpec, Preset } from '../../presets/types';
import type { Segment } from '../../../../types/segment-api';

interface Props {
  spec: CompositionCardSpec;
  segment: Segment;
  preset: Preset;
  cacheKey?: string;
}

export function CompositionDataCard({ spec, segment, preset, cacheKey }: Props): ReactElement {
  const query = useMemo<Query>(() => ({
    measures: [spec.measure],
    dimensions: [spec.groupBy],
    order: { [spec.measure]: 'desc' as never },
    limit: spec.limit ?? 6,
  }), [spec]);

  const initialRows = cacheKey ? getCachedRows(segment, cacheKey) : undefined;
  const skipBackgroundFetch = cacheKey ? isCacheFresh(segment, cacheKey) : false;
  const { rows, loading, error } = useSegmentCubeQuery(segment, query, preset.identityDim, {
    initialRows,
    skipBackgroundFetch,
  });

  const data = useMemo(() => {
    const slices = rows.map((r) => ({
      label: String((r as Record<string, unknown>)[spec.groupBy] ?? '—'),
      value: Number((r as Record<string, unknown>)[spec.measure] ?? 0),
    }));
    return slices;
  }, [rows, spec]);

  return (
    <CardShell title={spec.label} loading={loading} error={error}>
      {data.length > 0 ? (
        <VisualCompositionCard title={spec.label} donutData={data} barData={data} />
      ) : (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>No data.</div>
      )}
    </CardShell>
  );
}
