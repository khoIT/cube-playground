/** KPI tile fed by a preset KpiSpec, scoped to a segment. */

import { ReactElement, useMemo } from 'react';
import type { Query } from '@cubejs-client/core';
import { KpiTile } from '../../visuals';
import { useSegmentCubeQuery } from '../use-segment-cube-query';
import { formatValue } from './format-value';
import type { KpiSpec, Preset } from '../../presets/types';
import type { Segment } from '../../../../types/segment-api';

interface Props {
  spec: KpiSpec;
  segment: Segment;
  preset: Preset;
}

export function KpiCard({ spec, segment, preset }: Props): ReactElement {
  const query = useMemo<Query>(() => ({
    measures: [spec.measure],
    ...(spec.timeDimension && spec.dateRange
      ? { timeDimensions: [{ dimension: spec.timeDimension, dateRange: spec.dateRange }] }
      : {}),
  }), [spec]);

  const { rows, loading, error } = useSegmentCubeQuery(segment, query, preset.identityDim);
  const value = loading ? '…' : error ? '—' : formatValue(rows[0]?.[spec.measure] ?? null, spec.format);

  return <KpiTile label={spec.label} value={value} footer={spec.unit} />;
}
