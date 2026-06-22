/** Segmented bar card — single stacked horizontal composition strip, driven
 *  by a preset SegmentedBarCardSpec. Suited for lifecycle / spend tier strips
 *  where a donut would waste vertical space. */

import { ReactElement, useMemo } from 'react';
import type { Query } from '@cubejs-client/core';
import { SegmentedBar } from '../../visuals';
import { CardShell } from './card-shell';
import { resolveCardIcon } from './resolve-card-icon';
import { cardUnitChip } from './resolve-card-unit';
import { useSegmentCubeQuery } from '../use-segment-cube-query';
import { getCachedRows, isCacheFresh } from './use-card-cache-lookup';
import { categoryLabel } from './format-value';
import type { SegmentedBarCardSpec, Preset } from '../../presets/types';
import type { Segment } from '../../../../types/segment-api';

interface Props {
  spec: SegmentedBarCardSpec;
  segment: Segment;
  preset: Preset;
  cacheKey?: string;
}

export function SegmentedBarCard({ spec, segment, preset, cacheKey }: Props): ReactElement {
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

  const items = useMemo(() => rows.map((r) => ({
    label: categoryLabel((r as Record<string, unknown>)[spec.groupBy]),
    value: Number((r as Record<string, unknown>)[spec.measure] ?? 0),
  })), [rows, spec]);

  return (
    <CardShell
      title={spec.label}
      icon={resolveCardIcon(spec.measure, 'bars')}
      unit={cardUnitChip(spec.measure, spec.label)}
      loading={loading}
      error={error}
      skeletonShape="bars"
      cardKey={cacheKey}
    >
      {items.length > 0 ? (
        <SegmentedBar items={items} footer={spec.footer} />
      ) : (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>No data.</div>
      )}
    </CardShell>
  );
}
