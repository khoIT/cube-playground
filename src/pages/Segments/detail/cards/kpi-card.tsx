/** KPI tile fed by a preset KpiSpec, scoped to a segment. */

import { ReactElement, useMemo } from 'react';
import type { Query } from '@cubejs-client/core';
import { KpiTile } from '../../visuals';
import { useSegmentCubeQuery } from '../use-segment-cube-query';
import { formatValue } from './format-value';
import { getCachedRows } from './use-card-cache-lookup';
import type { KpiSpec, Preset } from '../../presets/types';
import type { Segment } from '../../../../types/segment-api';

interface Props {
  spec: KpiSpec;
  segment: Segment;
  preset: Preset;
  /** Lookup key into segment.card_cache for synchronous hydration. */
  cacheKey?: string;
}

export function KpiCard({ spec, segment, preset, cacheKey }: Props): ReactElement {
  const query = useMemo<Query>(() => ({
    measures: [spec.measure],
    ...(spec.timeDimension && spec.dateRange
      ? { timeDimensions: [{ dimension: spec.timeDimension, dateRange: spec.dateRange }] }
      : {}),
  }), [spec]);

  const initialRows = cacheKey ? getCachedRows(segment, cacheKey) : undefined;
  const { rows, loading, error } = useSegmentCubeQuery(segment, query, preset.identityDim, {
    initialRows,
  });
  const value = loading ? '…' : error ? '—' : formatValue(rows[0]?.[spec.measure] ?? null, spec.format);

  return <KpiTile label={spec.label} value={value} footer={spec.unit} />;
}
