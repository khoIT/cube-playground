/** Line chart card driven by a preset LineCardSpec, scoped to a segment. */

import { ReactElement, useMemo } from 'react';
import type { Query } from '@cubejs-client/core';
import { LineChart } from '../../visuals';
import { CardShell } from './card-shell';
import { useSegmentCubeQuery } from '../use-segment-cube-query';
import type { LineCardSpec, Preset } from '../../presets/types';
import type { Segment } from '../../../../types/segment-api';

interface Props {
  spec: LineCardSpec;
  segment: Segment;
  preset: Preset;
}

export function LineChartCard({ spec, segment, preset }: Props): ReactElement {
  const query = useMemo<Query>(() => ({
    measures: [spec.measure],
    timeDimensions: [
      {
        dimension: spec.timeDimension,
        granularity: spec.granularity ?? 'day',
        dateRange: spec.dateRange ?? 'last 14 days',
      },
    ],
  }), [spec]);

  const { rows, loading, error } = useSegmentCubeQuery(segment, query, preset.identityDim);

  const data = useMemo(() => rows.map((r) => ({
    x: String((r as Record<string, unknown>)[`${spec.timeDimension}.day`] ?? (r as Record<string, unknown>)[spec.timeDimension] ?? ''),
    y: Number((r as Record<string, unknown>)[spec.measure] ?? 0),
  })), [rows, spec]);

  return (
    <CardShell title={spec.label} loading={loading} error={error}>
      {data.length > 0 ? <LineChart data={data} height={spec.height ?? 140} /> : <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>No data.</div>}
    </CardShell>
  );
}
