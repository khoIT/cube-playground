/** KPI tile fed by a preset KpiSpec, scoped to a segment. */

import { ReactElement, useMemo } from 'react';
import type { Query } from '@cubejs-client/core';
import { KpiTile } from '../../visuals';
import { useSegmentCubeQuery } from '../use-segment-cube-query';
import { formatValue } from './format-value';
import { getCachedRows, isCacheFresh } from './use-card-cache-lookup';
import type { KpiSpec, Preset } from '../../presets/types';
import type { Segment } from '../../../../types/segment-api';

interface Comparison {
  /** Already-formatted delta text, e.g. "↑ 2.1% vs last week". */
  text: string;
  /** Tone for the delta colour. Defaults to 'neutral'. */
  tone?: 'positive' | 'negative' | 'neutral';
}

interface Props {
  spec: KpiSpec;
  segment: Segment;
  preset: Preset;
  /** Lookup key into segment.card_cache for synchronous hydration. */
  cacheKey?: string;
  /** Optional pre-computed comparison line (e.g. "↑ 2.1% vs last week"). */
  comparison?: Comparison | null;
  /** Optional static footer override (e.g. "next at 14:30"). */
  footer?: string | null;
}

export function KpiCard({ spec, segment, preset, cacheKey, comparison, footer }: Props): ReactElement {
  const query = useMemo<Query>(() => ({
    measures: [spec.measure],
    ...(spec.timeDimension && spec.dateRange
      ? { timeDimensions: [{ dimension: spec.timeDimension, dateRange: spec.dateRange }] }
      : {}),
  }), [spec]);

  const initialRows = cacheKey ? getCachedRows(segment, cacheKey) : undefined;
  const skipBackgroundFetch = cacheKey ? isCacheFresh(segment, cacheKey) : false;
  const { rows, loading, error } = useSegmentCubeQuery(segment, query, preset.identityDim, {
    initialRows,
    skipBackgroundFetch,
  });
  const value = loading ? '…' : error ? '—' : formatValue(rows[0]?.[spec.measure] ?? null, spec.format);

  return (
    <KpiTile
      label={spec.label}
      value={value}
      delta={comparison?.text}
      tone={comparison?.tone ?? 'neutral'}
      footer={footer ?? spec.unit}
    />
  );
}
