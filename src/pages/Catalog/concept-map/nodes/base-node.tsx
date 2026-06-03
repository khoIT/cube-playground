/**
 * BaseNode — shared card chrome for every concept-map node type. reactflow
 * renders DOM nodes (not a canvas), so this styles with design tokens exactly
 * like the rest of the app: per-layer accent from `--layer-*`, the same lucide
 * icon vocabulary as ConceptChip, and the unified trust ladder.
 *
 * The card exposes `role="button"` + `aria-label` + `tabIndex` so it is
 * announced and reachable; click/keyboard activation is wired by the board /
 * focus layer. Edge handles are present but visually muted (edges are
 * decorative — see concept-map.css) and marked aria-hidden.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { Handle, Position, type NodeProps } from 'reactflow';
import { BarChart3, ExternalLink, Hash, Info, Users, type LucideIcon } from 'lucide-react';

import { conceptDetailRoute, type ConceptLayer } from '../concept-node';
import type { ConceptNodeData } from '../build-layout';
import type { Trust } from '../../../../api/glossary-client';

interface LayerVisual {
  Icon: LucideIcon;
  accent: string;
  mono?: boolean;
}

// Icon matches ConceptChip / catalog TypeIcon; accent is the dedicated layer token.
export const LAYER_VISUAL: Record<ConceptLayer, LayerVisual> = {
  field: { Icon: Hash, accent: 'var(--layer-field)', mono: true },
  metric: { Icon: BarChart3, accent: 'var(--layer-metric)' },
  term: { Icon: Info, accent: 'var(--layer-glossary)' },
  appSegment: { Icon: Users, accent: 'var(--layer-segment)' },
};

const TRUST_BADGE: Record<Trust, { bg: string; ink: string; label: string }> = {
  certified: { bg: 'var(--success-soft)', ink: 'var(--success-ink)', label: '✓ certified' },
  draft: { bg: 'var(--muted-soft)', ink: 'var(--muted-ink)', label: 'draft' },
  deprecated: { bg: 'var(--destructive-soft)', ink: 'var(--destructive-ink)', label: 'deprecated' },
};

const NODE_WIDTH = 240;

const handleStyle: React.CSSProperties = {
  // Muted: edges/handles are decorative chrome, not interactive targets here.
  width: 1,
  height: 1,
  minWidth: 1,
  minHeight: 1,
  background: 'transparent',
  border: 'none',
};

export function BaseNode({ data }: NodeProps<ConceptNodeData>) {
  const { node, dimmed, focused } = data;
  const visual = LAYER_VISUAL[node.kind];
  const { Icon, accent, mono } = visual;
  const route = conceptDetailRoute(node);

  const cardStyle: React.CSSProperties = {
    width: NODE_WIDTH,
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: '8px 10px',
    background: 'var(--bg-card)',
    border: `1px solid ${focused ? accent : 'var(--border-card)'}`,
    borderLeft: `3px solid ${accent}`,
    borderRadius: 'var(--radius-md)',
    boxShadow: focused ? `0 0 0 2px ${accent}` : 'none',
    opacity: dimmed ? 0.4 : 1,
    fontFamily: 'var(--font-sans)',
    transition: 'opacity 0.15s, box-shadow 0.15s, border-color 0.15s',
    cursor: 'pointer',
    outline: 'none',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-primary)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };

  const sublabelStyle: React.CSSProperties = {
    fontSize: 11,
    color: 'var(--text-muted)',
    fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };

  return (
    <div
      style={cardStyle}
      role="button"
      tabIndex={0}
      aria-pressed={focused}
      aria-label={`${node.kind} ${node.label}`}
      data-focused={focused || undefined}
      data-dimmed={dimmed || undefined}
      onKeyDown={(e) => {
        // Keyboard parity for focus (reactflow's onNodeClick is mouse-only).
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          data.onActivate?.();
        }
      }}
    >
      <Handle type="target" position={Position.Left} style={handleStyle} isConnectable={false} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <Icon size={14} strokeWidth={2.5} color={accent} style={{ flexShrink: 0 }} aria-hidden />
        <span style={labelStyle}>{node.label}</span>
      </div>

      {node.sublabel && <span style={sublabelStyle}>{node.sublabel}</span>}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <TrustFooter kind={node.kind} trust={node.trust} />
        {route && (
          <Link
            to={route}
            // Stop the click from bubbling to reactflow's onNodeClick (focus).
            onClick={(e) => e.stopPropagation()}
            title={`Open ${node.kind} detail`}
            aria-label={`Open ${node.label} detail`}
            style={{ display: 'inline-flex', color: 'var(--text-muted)', flexShrink: 0 }}
          >
            <ExternalLink size={13} strokeWidth={2.5} aria-hidden />
          </Link>
        )}
      </div>

      <Handle type="source" position={Position.Right} style={handleStyle} isConnectable={false} />
    </div>
  );
}

function TrustFooter({ kind, trust }: { kind: ConceptLayer; trust?: Trust }) {
  // Fields are read-only data-model members — no trust ladder, a static tag.
  if (kind === 'field') {
    return (
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: 'var(--text-muted)',
        }}
      >
        read-only
      </span>
    );
  }
  if (!trust) return null;
  const meta = TRUST_BADGE[trust];
  return (
    <span
      style={{
        alignSelf: 'flex-start',
        padding: '0 5px',
        borderRadius: 'var(--radius-pill)',
        fontSize: 10,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        lineHeight: '15px',
        background: meta.bg,
        color: meta.ink,
      }}
      title={trust}
    >
      {meta.label}
    </span>
  );
}
