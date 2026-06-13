/**
 * CubeGraphLegend — color key for the topology clusters. Mirrors the on-system
 * ConceptMapLegend (swatch + label, wrapping row, design tokens) but renders
 * only the clusters actually present in the current game's graph, so it never
 * overflows into an unreadable strip. Order follows CLUSTER_ORDER.
 */
import React from 'react';

import { CLUSTER_ORDER, clusterMeta } from './cube-clusters';

const rowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '6px 12px',
  alignItems: 'center',
};

const itemStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  fontFamily: 'var(--font-sans)',
  fontSize: 11.5,
  color: 'var(--text-secondary)',
  whiteSpace: 'nowrap',
};

const swatchStyle = (color: string): React.CSSProperties => ({
  width: 9,
  height: 9,
  borderRadius: 'var(--radius-sm)',
  background: color,
  flexShrink: 0,
});

interface Props {
  /** Cluster keys present in the current graph (others are hidden). */
  present: ReadonlySet<string>;
}

export function CubeGraphLegend({ present }: Props) {
  const clusters = CLUSTER_ORDER.filter((c) => present.has(c));
  if (clusters.length === 0) return null;

  return (
    <div style={rowStyle} role="list" aria-label="Cluster colors">
      {clusters.map((cluster) => {
        const { label, short, accent } = clusterMeta(cluster);
        // Compact label keeps the strip on one tidy run; the full descriptive
        // label (e.g. "Session events (direct join)") shows on hover.
        return (
          <span key={cluster} style={itemStyle} role="listitem" title={label}>
            <span style={swatchStyle(accent)} aria-hidden="true" />
            {short}
          </span>
        );
      })}
    </div>
  );
}
