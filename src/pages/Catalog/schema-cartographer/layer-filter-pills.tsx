/**
 * LayerFilterPills — toggle row for the four concept layers in the Cartographer.
 *
 * "Fields" governs whether the cube tree is shown at all.
 * "Metrics" / "Glossary" / "Segments" govern which reverse-edge sections
 * render in the detail panel's ConceptRelationsSection.
 *
 * All four default to ON so the page is immediately useful without configuration.
 */
import React from 'react';

export type LayerFilter = 'fields' | 'metrics' | 'glossary' | 'segments';

export const ALL_LAYERS: readonly LayerFilter[] = ['fields', 'metrics', 'glossary', 'segments'];

interface Props {
  active: ReadonlySet<LayerFilter>;
  onChange: (next: Set<LayerFilter>) => void;
}

const LAYER_LABELS: Record<LayerFilter, string> = {
  fields:   'Fields',
  metrics:  'Metrics',
  glossary: 'Glossary',
  segments: 'Segments',
};

const containerStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  flexWrap: 'wrap',
};

function pillStyle(on: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '3px 10px',
    borderRadius: 'var(--radius-full)',
    border: on ? '1px solid var(--brand)' : '1px solid var(--border-card)',
    background: on ? 'var(--brand)' : 'var(--bg-card)',
    color: on ? 'var(--text-on-brand)' : 'var(--text-secondary)',
    fontFamily: 'var(--font-sans)',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    userSelect: 'none',
    transition: 'background 0.15s, color 0.15s, border-color 0.15s',
  };
}

export function LayerFilterPills({ active, onChange }: Props) {
  const toggle = (layer: LayerFilter) => {
    const next = new Set(active);
    if (next.has(layer)) {
      // Keep at least one layer active so the UI never goes blank.
      if (next.size > 1) next.delete(layer);
    } else {
      next.add(layer);
    }
    onChange(next);
  };

  return (
    <div style={containerStyle} role="group" aria-label="Layer filters">
      {ALL_LAYERS.map((layer) => {
        const on = active.has(layer);
        return (
          <button
            key={layer}
            type="button"
            aria-pressed={on}
            style={pillStyle(on)}
            onClick={() => toggle(layer)}
          >
            {LAYER_LABELS[layer]}
          </button>
        );
      })}
    </div>
  );
}
