/**
 * Crow's-foot ER markers for join edges. Instead of overlapping text labels,
 * each edge shows cardinality visually at its ends: a "crow's foot" on the
 * many side and a single bar on the one side — the standard entity-relationship
 * notation, readable at a glance and collision-free.
 *
 * `markersForCardinality` maps the builder's cardinality (N:1 / 1:N / 1:1) to
 * reactflow `markerStart` / `markerEnd` url() refs. The marker shapes inherit
 * the edge stroke color via `context-stroke`, so one set of defs serves every
 * cluster color. `EdgeCardinalityMarkers` renders the shared `<defs>` once;
 * `CardinalityKey` is the small legend that teaches the notation.
 */
import React from 'react';

import type { EdgeCardinality } from './build-join-graph';

// reactflow wraps a string marker as `url('#<value>')`, so pass the bare id.
const ONE = 'ef-card-one';
const MANY = 'ef-card-many';
const ARROW = 'ef-card-arrow';

/** markerStart sits at the join's source cube, markerEnd at the target cube. */
export function markersForCardinality(card: EdgeCardinality): {
  markerStart?: string;
  markerEnd?: string;
} {
  switch (card) {
    case 'N:1': // source = many, target = one
      return { markerStart: MANY, markerEnd: ONE };
    case '1:N': // source = one, target = many
      return { markerStart: ONE, markerEnd: MANY };
    case '1:1':
      return { markerStart: ONE, markerEnd: ONE };
    default: // unknown relationship — plain directional arrow at the target
      return { markerEnd: ARROW };
  }
}

const markerProps = {
  markerUnits: 'userSpaceOnUse' as const,
  orient: 'auto-start-reverse',
};

/**
 * Hidden SVG holding the shared marker defs. Must be in the DOM for the
 * `url(#…)` refs on the edges to resolve. `context-stroke` makes each marker
 * adopt the referencing edge's color.
 */
export function EdgeCardinalityMarkers() {
  return (
    <svg
      aria-hidden="true"
      style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none' }}
    >
      <defs>
        {/* one — a single perpendicular bar near the node */}
        <marker
          id="ef-card-one"
          viewBox="0 0 14 14"
          markerWidth={14}
          markerHeight={14}
          refX={9}
          refY={7}
          {...markerProps}
        >
          <path d="M9 2 L9 12" stroke="context-stroke" strokeWidth={1.6} strokeLinecap="round" fill="none" />
        </marker>
        {/* many — crow's foot splaying open toward the node */}
        <marker
          id="ef-card-many"
          viewBox="0 0 14 14"
          markerWidth={19}
          markerHeight={19}
          refX={12}
          refY={7}
          {...markerProps}
        >
          <path
            d="M0 7 L12 1 M0 7 L12 7 M0 7 L12 13"
            stroke="context-stroke"
            strokeWidth={1.8}
            strokeLinecap="round"
            fill="none"
          />
        </marker>
        {/* unknown cardinality — plain filled arrow */}
        <marker
          id="ef-card-arrow"
          viewBox="0 0 12 12"
          markerWidth={13}
          markerHeight={13}
          refX={9}
          refY={6}
          {...markerProps}
        >
          <path d="M2 2 L10 6 L2 10 z" fill="context-stroke" />
        </marker>
      </defs>
    </svg>
  );
}

const keyRowStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 12,
  fontFamily: 'var(--font-sans)',
  fontSize: 11,
  color: 'var(--text-muted)',
};

const keyItemStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
};

/** Tiny legend teaching the crow's-foot notation (many) vs bar (one). */
export function CardinalityKey() {
  const stroke = 'var(--text-muted)';
  return (
    <span style={keyRowStyle} aria-label="Relationship notation">
      <span style={keyItemStyle}>
        <svg width="20" height="14" aria-hidden="true">
          <line x1="0" y1="7" x2="20" y2="7" stroke={stroke} strokeWidth={1.4} />
          <path d="M20 7 L8 2 M20 7 L8 7 M20 7 L8 12" stroke={stroke} strokeWidth={1.4} fill="none" />
        </svg>
        many
      </span>
      <span style={keyItemStyle}>
        <svg width="20" height="14" aria-hidden="true">
          <line x1="0" y1="7" x2="20" y2="7" stroke={stroke} strokeWidth={1.4} />
          <line x1="15" y1="2" x2="15" y2="12" stroke={stroke} strokeWidth={1.4} />
        </svg>
        one
      </span>
    </span>
  );
}
