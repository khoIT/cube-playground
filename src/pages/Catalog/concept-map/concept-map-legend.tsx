/**
 * ConceptMapLegend — the 4-layer legend row: a colored swatch + label + live
 * count per layer. Colors come from the dedicated `--layer-*` tokens so the
 * legend, node cards (P3), and filter pills all read from one palette.
 */
import React from 'react';

import type { LayerFilter } from '../schema-cartographer/layer-filter-pills';

export type LayerCounts = Record<LayerFilter, number>;

const LAYER_META: ReadonlyArray<{ layer: LayerFilter; label: string; color: string }> = [
  { layer: 'fields', label: 'Fields', color: 'var(--layer-field)' },
  { layer: 'metrics', label: 'Metrics', color: 'var(--layer-metric)' },
  { layer: 'glossary', label: 'Glossary', color: 'var(--layer-glossary)' },
  { layer: 'segments', label: 'Segments', color: 'var(--layer-segment)' },
];

const rowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 16,
  alignItems: 'center',
};

const itemStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontFamily: 'var(--font-sans)',
  fontSize: 12,
  color: 'var(--text-secondary)',
};

const swatchStyle = (color: string): React.CSSProperties => ({
  width: 10,
  height: 10,
  borderRadius: 'var(--radius-full)',
  background: color,
  flexShrink: 0,
});

const countStyle: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontVariantNumeric: 'tabular-nums',
};

interface Props {
  counts: LayerCounts;
}

export function ConceptMapLegend({ counts }: Props) {
  return (
    <div style={rowStyle} role="list" aria-label="Concept layers">
      {LAYER_META.map(({ layer, label, color }) => (
        <span key={layer} style={itemStyle} role="listitem">
          <span style={swatchStyle(color)} aria-hidden="true" />
          {label}
          <span style={countStyle}>{counts[layer]}</span>
        </span>
      ))}
    </div>
  );
}
