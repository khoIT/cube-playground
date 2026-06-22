/** Bar list card driven by a preset BarListCardSpec. */

import { ReactElement, useMemo } from 'react';
import type { Query } from '@cubejs-client/core';
import { BarList } from '../../visuals';
import { CardShell } from './card-shell';
import { resolveCardIcon } from './resolve-card-icon';
import { cardUnitChip } from './resolve-card-unit';
import { useSegmentCubeQuery } from '../use-segment-cube-query';
import { getCachedRows, isCacheFresh } from './use-card-cache-lookup';
import { categoryLabel } from './format-value';
import type { BarListCardSpec, Preset } from '../../presets/types';
import type { Segment } from '../../../../types/segment-api';

interface Props {
  spec: BarListCardSpec;
  segment: Segment;
  preset: Preset;
  cacheKey?: string;
}

export function BarListCard({ spec, segment, preset, cacheKey }: Props): ReactElement {
  const query = useMemo<Query>(() => ({
    measures: [spec.measure],
    dimensions: spec.chipBy ? [spec.groupBy, spec.chipBy] : [spec.groupBy],
    order: { [spec.measure]: 'desc' as never },
    limit: spec.limit ?? 6,
  }), [spec]);

  const initialRows = cacheKey ? getCachedRows(segment, cacheKey) : undefined;
  const skipBackgroundFetch = cacheKey ? isCacheFresh(segment, cacheKey) : false;
  const { rows, loading, error } = useSegmentCubeQuery(segment, query, preset.identityDim, {
    initialRows,
    skipBackgroundFetch,
  });

  const items = useMemo(() => rows.map((r) => {
    const row = r as Record<string, unknown>;
    const chipRaw = spec.chipBy ? row[spec.chipBy] : undefined;
    const chip = chipRaw == null || String(chipRaw).trim() === '' ? undefined : String(chipRaw).trim();
    return {
      label: categoryLabel(row[spec.groupBy]),
      value: Number(row[spec.measure] ?? 0),
      chip,
    };
  }), [rows, spec]);

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
      {items.length > 0 ? <BarList items={items} /> : <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>No data.</div>}
    </CardShell>
  );
}
