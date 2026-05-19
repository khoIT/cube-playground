/** Donut card driven by a preset DonutCardSpec. */

import { ReactElement, useMemo } from 'react';
import type { Query } from '@cubejs-client/core';
import { Donut } from '../../visuals';
import { CardShell } from './card-shell';
import { useSegmentCubeQuery } from '../use-segment-cube-query';
import type { DonutCardSpec, Preset } from '../../presets/types';
import type { Segment } from '../../../../types/segment-api';

interface Props {
  spec: DonutCardSpec;
  segment: Segment;
  preset: Preset;
}

export function DonutCard({ spec, segment, preset }: Props): ReactElement {
  const query = useMemo<Query>(() => ({
    measures: [spec.measure],
    dimensions: [spec.groupBy],
    order: { [spec.measure]: 'desc' as never },
    limit: spec.limit ?? 6,
  }), [spec]);

  const { rows, loading, error } = useSegmentCubeQuery(segment, query, preset.identityDim);

  const slices = useMemo(() => rows.map((r) => ({
    label: String((r as Record<string, unknown>)[spec.groupBy] ?? '—'),
    value: Number((r as Record<string, unknown>)[spec.measure] ?? 0),
  })), [rows, spec]);

  return (
    <CardShell title={spec.label} loading={loading} error={error}>
      {slices.length > 0 ? <Donut data={slices} /> : <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>No data.</div>}
    </CardShell>
  );
}
