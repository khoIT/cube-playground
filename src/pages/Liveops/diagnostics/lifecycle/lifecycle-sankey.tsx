/**
 * Hand-rolled SVG Sankey for the lifecycle flow view.
 *
 * Left column = last week state nodes (heights proportional to count).
 * Right column = this week state nodes (same proportions).
 * Ribbons between them would represent user transitions — but mf_users holds
 * current state only (no history), so ribbons render as a disclosed empty-state
 * overlay. The node bars are real (from Cube state counts).
 *
 * Design tokens only. Colors map to semantic status tokens:
 *   new          → --info-soft / --info-ink
 *   core         → --success-soft / --success-ink
 *   lapsing      → --warning-soft / --warning-ink
 *   reactivated  → --brand (accent)
 *   churned      → --destructive-soft / --destructive-ink
 */
import React from 'react';
import type { LifecycleStateName } from '../../../../api/lifecycle-flow-client';

export interface SankeyStateNode {
  state: LifecycleStateName;
  label: string;
  count: number;
}

interface Props {
  nodes: SankeyStateNode[];
  transitionsUnavailableReason: string;
  width?: number;
  height?: number;
}

const STATE_COLORS: Record<LifecycleStateName, { fill: string; text: string; bar: string }> = {
  new: {
    fill: 'var(--info-soft)',
    text: 'var(--info-ink)',
    bar: 'var(--info-ink)',
  },
  core: {
    fill: 'var(--success-soft)',
    text: 'var(--success-ink)',
    bar: 'var(--success-ink)',
  },
  lapsing: {
    fill: 'var(--warning-soft)',
    text: 'var(--warning-ink)',
    bar: 'var(--warning-ink)',
  },
  reactivated: {
    fill: 'color-mix(in srgb, var(--brand) 15%, transparent)',
    text: 'var(--brand)',
    bar: 'var(--brand)',
  },
  churned: {
    fill: 'var(--destructive-soft)',
    text: 'var(--destructive-ink)',
    bar: 'var(--destructive-ink)',
  },
};

const NODE_WIDTH = 18;
const NODE_GAP = 10;
const LABEL_OFFSET = 26;
const SVG_PADDING = { top: 8, bottom: 8, left: 90, right: 90 };

function formatK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export function LifecycleSankey({
  nodes,
  transitionsUnavailableReason,
  width = 560,
  height = 300,
}: Props) {
  const innerH = height - SVG_PADDING.top - SVG_PADDING.bottom;
  const total = nodes.reduce((s, n) => s + n.count, 0) || 1;

  // Compute node bar heights proportional to count, minimum 6px for visibility.
  const minBarH = 6;
  const availH = innerH - (nodes.length - 1) * NODE_GAP;
  const rawHeights = nodes.map((n) => Math.max(minBarH, (n.count / total) * availH));
  // Scale down if overflows (due to minBarH clamping)
  const rawTotal = rawHeights.reduce((s, h) => s + h, 0);
  const scale = rawTotal > availH ? availH / rawTotal : 1;
  const barHeights = rawHeights.map((h, i) =>
    i < rawHeights.length - 1 ? h * scale : h * scale,
  );

  // Y positions for each node bar
  const yPositions: number[] = [];
  let y = SVG_PADDING.top;
  barHeights.forEach((h, i) => {
    yPositions.push(y);
    y += h + NODE_GAP;
  });

  // Left node x
  const leftX = SVG_PADDING.left;
  // Right node x (mirror)
  const rightX = width - SVG_PADDING.right - NODE_WIDTH;
  // Center of ribbon area
  const ribbonCenterX = width / 2;

  return (
    <div style={{ position: 'relative', width, fontFamily: 'var(--font-sans)' }}>
      <svg
        width={width}
        height={height}
        aria-label="Lifecycle state distribution"
        style={{ overflow: 'visible' }}
      >
        {nodes.map((node, i) => {
          const colors = STATE_COLORS[node.state];
          const bh = barHeights[i];
          const yp = yPositions[i];
          const midY = yp + bh / 2;

          return (
            <g key={node.state}>
              {/* Left node bar */}
              <rect
                x={leftX}
                y={yp}
                width={NODE_WIDTH}
                height={bh}
                rx={4}
                fill={colors.bar}
                opacity={0.85}
              />
              {/* Left label */}
              <text
                x={leftX - 6}
                y={midY + 4}
                textAnchor="end"
                fontSize={11}
                fontWeight={600}
                fill={colors.text}
                fontFamily="var(--font-sans)"
              >
                {node.label}
              </text>
              {/* Left count */}
              <text
                x={leftX - 6}
                y={midY + 16}
                textAnchor="end"
                fontSize={10}
                fill="var(--text-muted)"
                fontFamily="var(--font-sans)"
              >
                {formatK(node.count)}
              </text>

              {/* Right node bar (mirrors left — current state, same snapshot) */}
              <rect
                x={rightX}
                y={yp}
                width={NODE_WIDTH}
                height={bh}
                rx={4}
                fill={colors.bar}
                opacity={0.4}
              />
              {/* Right label */}
              <text
                x={rightX + NODE_WIDTH + 6}
                y={midY + 4}
                textAnchor="start"
                fontSize={11}
                fontWeight={600}
                fill={colors.text}
                fontFamily="var(--font-sans)"
              >
                {node.label}
              </text>
              <text
                x={rightX + NODE_WIDTH + 6}
                y={midY + 16}
                textAnchor="start"
                fontSize={10}
                fill="var(--text-muted)"
                fontFamily="var(--font-sans)"
              >
                {formatK(node.count)}
              </text>
            </g>
          );
        })}

        {/* Column headers */}
        <text
          x={leftX + NODE_WIDTH / 2}
          y={SVG_PADDING.top - 2}
          textAnchor="middle"
          fontSize={10}
          fontWeight={600}
          fill="var(--text-muted)"
          letterSpacing="0.05em"
          fontFamily="var(--font-sans)"
        >
          LAST WEEK
        </text>
        <text
          x={rightX + NODE_WIDTH / 2}
          y={SVG_PADDING.top - 2}
          textAnchor="middle"
          fontSize={10}
          fontWeight={600}
          fill="var(--text-muted)"
          letterSpacing="0.05em"
          fontFamily="var(--font-sans)"
        >
          THIS WEEK
        </text>
      </svg>

      {/* Ribbon area — disclosed empty state */}
      <div
        style={{
          position: 'absolute',
          top: SVG_PADDING.top,
          left: leftX + NODE_WIDTH + 4,
          width: rightX - leftX - NODE_WIDTH - 8,
          height: innerH,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          borderRadius: 'var(--radius-md)',
          background: 'var(--bg-surface, rgba(0,0,0,0.02))',
          border: '1px dashed var(--border-card)',
        }}
        title={transitionsUnavailableReason}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          Transition flows
        </span>
        <span
          style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            textAlign: 'center',
            maxWidth: 160,
            lineHeight: 1.4,
          }}
        >
          Populate once daily lifecycle snapshots accumulate
        </span>
      </div>
    </div>
  );
}
