/**
 * Custom reactflow node types for the cube join graph: the cube card itself
 * and the non-interactive cluster box drawn behind each cluster's block.
 * All chrome comes from design tokens (see docs/design-guidelines.md) so the
 * canvas adapts to dark mode for free.
 */
import React from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';

import { NODE_H, NODE_W } from './cluster-grid-layout';
import { clusterAccent, clusterLabel } from './cube-clusters';

// Re-exported so existing importers (cube-graph-board) keep their import path.
export { clusterAccent };

export type CubeLint = 'isolated' | 'missing-target' | null;

export interface CubeNodeData {
  label: string;
  description: string;
  accent: string;
  dimmed: boolean;
  selected: boolean;
  lint: CubeLint;
}

export interface ClusterBoxData {
  cluster: string;
  accent: string;
  width: number;
  height: number;
}

const handleStyle: React.CSSProperties = {
  // Decorative anchor points only — edges are not user-connectable.
  width: 1,
  height: 1,
  minWidth: 1,
  minHeight: 1,
  background: 'transparent',
  border: 'none',
};

const LINT_LABEL: Record<Exclude<CubeLint, null>, string> = {
  isolated: 'isolated',
  'missing-target': 'missing target',
};

export function CubeNode({ data }: NodeProps<CubeNodeData>) {
  const { label, description, accent, dimmed, selected, lint } = data;
  return (
    <div
      title={description || label}
      style={{
        width: NODE_W,
        height: NODE_H,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 10px 0 0',
        background: 'var(--bg-card)',
        border: `1px solid ${selected ? 'var(--brand)' : 'var(--border-card)'}`,
        borderRadius: 'var(--radius-md)',
        boxShadow: selected ? 'var(--shadow-sm)' : 'none',
        opacity: dimmed ? 0.3 : 1,
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
        transition: 'opacity 120ms ease, border-color 120ms ease',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          alignSelf: 'stretch',
          width: 3,
          borderRadius: 'var(--radius-md) 0 0 var(--radius-md)',
          background: accent,
          flexShrink: 0,
        }}
      />
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontFamily: 'var(--font-sans)',
          fontSize: 13.5,
          fontWeight: 700,
          letterSpacing: '-0.01em',
          color: 'var(--text-primary)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          paddingLeft: 8,
        }}
      >
        {label}
      </span>
      {lint && (
        <span
          style={{
            flexShrink: 0,
            fontSize: 10,
            fontWeight: 600,
            padding: '1px 6px',
            borderRadius: 'var(--radius-full)',
            background: 'var(--warning-soft)',
            color: 'var(--warning-ink)',
          }}
        >
          {LINT_LABEL[lint]}
        </span>
      )}
      <Handle type="target" position={Position.Left} style={handleStyle} aria-hidden="true" />
      <Handle type="source" position={Position.Right} style={handleStyle} aria-hidden="true" />
    </div>
  );
}

/** Background rectangle labelling one cluster's block. Never interactive. */
export function ClusterBoxNode({ data }: NodeProps<ClusterBoxData>) {
  const { cluster, accent, width, height } = data;
  // Tint the box (bg + border) with the cluster accent so each group reads as
  // its color, and color the header text the same — far more legible than a
  // grey box + a faint dot. color-mix keeps one accent var driving both the
  // light and dark canvas.
  return (
    <div
      style={{
        width,
        height,
        boxSizing: 'border-box',
        border: `1px solid color-mix(in srgb, ${accent} 38%, transparent)`,
        borderRadius: 'var(--radius-lg)',
        background: `color-mix(in srgb, ${accent} 9%, var(--bg-card))`,
        pointerEvents: 'none',
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 10px',
          fontFamily: 'var(--font-sans)',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: accent,
        }}
      >
        <span
          aria-hidden="true"
          style={{ width: 8, height: 8, borderRadius: 'var(--radius-full)', background: accent }}
        />
        {clusterLabel(cluster)}
      </span>
    </div>
  );
}
