/**
 * Hand-rolled SVG Sankey for the lifecycle flow view.
 *
 * Two modes, decided by whether transition cells are present:
 *   - Disclosed-empty (transitions null): left/right node bars sized by the
 *     full-population current state, with a dashed overlay disclosing why flows
 *     aren't available yet (no second snapshot day, read disabled, etc.).
 *   - Populated (transitions present): left bars = prev-date cohort state totals,
 *     right bars = curr-date cohort totals, ribbons = the from→to matrix. These
 *     are the TRACKED-segment cohort — a subset of the population in the state
 *     cards above — so a footnote discloses the sample and date range.
 *
 * Design tokens only. Colors map to semantic status tokens per state.
 */
import React from 'react';
import type {
  LifecycleStateName,
  TransitionCell,
  LifecycleTransitionMeta,
} from '../../../../api/lifecycle-flow-client';
import { computeRibbonLayout, type RibbonGeometry } from './sankey-ribbon-layout';

export interface SankeyStateNode {
  state: LifecycleStateName;
  label: string;
  count: number;
}

interface Props {
  nodes: SankeyStateNode[];
  /** From→to cells when available; null renders the disclosed-empty overlay. */
  transitions?: TransitionCell[] | null;
  transitionMeta?: LifecycleTransitionMeta;
  transitionsUnavailableReason: string;
  width?: number;
  height?: number;
}

const STATE_COLORS: Record<LifecycleStateName, { fill: string; text: string; bar: string }> = {
  new: { fill: 'var(--info-soft)', text: 'var(--info-ink)', bar: 'var(--info-ink)' },
  core: { fill: 'var(--success-soft)', text: 'var(--success-ink)', bar: 'var(--success-ink)' },
  lapsing: { fill: 'var(--warning-soft)', text: 'var(--warning-ink)', bar: 'var(--warning-ink)' },
  reactivated: {
    fill: 'color-mix(in srgb, var(--brand) 15%, transparent)',
    text: 'var(--brand)',
    bar: 'var(--brand)',
  },
  churned: { fill: 'var(--destructive-soft)', text: 'var(--destructive-ink)', bar: 'var(--destructive-ink)' },
};

const NODE_WIDTH = 18;
const NODE_GAP = 10;
const SVG_PADDING = { top: 14, bottom: 8, left: 90, right: 90 };

function formatK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function colorFor(state: string) {
  return STATE_COLORS[state as LifecycleStateName] ?? STATE_COLORS.churned;
}

export function LifecycleSankey({
  nodes,
  transitions,
  transitionMeta,
  transitionsUnavailableReason,
  width = 560,
  height = 320,
}: Props) {
  const innerH = height - SVG_PADDING.top - SVG_PADDING.bottom;
  const leftX = SVG_PADDING.left;
  const rightX = width - SVG_PADDING.right - NODE_WIDTH;
  const hasFlows = Array.isArray(transitions) && transitions.length > 0;

  // ── Populated mode: bars + ribbons from the transition matrix ──────────────
  if (hasFlows && transitions) {
    const order = nodes.map((n) => n.state);
    const labelByState = new Map(nodes.map((n) => [n.state as string, n.label]));
    const geom: RibbonGeometry = {
      innerTop: SVG_PADDING.top,
      innerHeight: innerH,
      nodeGap: NODE_GAP,
      leftX,
      rightX,
      nodeWidth: NODE_WIDTH,
    };
    const { leftBars, rightBars, ribbons } = computeRibbonLayout(order, transitions, geom);

    return (
      <div style={{ position: 'relative', width, fontFamily: 'var(--font-sans)' }}>
        <svg width={width} height={height} aria-label="Lifecycle transition flows" style={{ overflow: 'visible' }}>
          {/* Ribbons first so node bars paint over their edges. */}
          {ribbons.map((r) => {
            const cx = (r.x0 + r.x1) / 2;
            const c = colorFor(r.from);
            return (
              <path
                key={`${r.from}->${r.to}`}
                d={`M ${r.x0},${r.y0} C ${cx},${r.y0} ${cx},${r.y1} ${r.x1},${r.y1}`}
                stroke={c.bar}
                strokeWidth={Math.max(1, r.thickness)}
                strokeOpacity={r.from === r.to ? 0.22 : 0.4}
                fill="none"
              >
                <title>{`${labelByState.get(r.from) ?? r.from} → ${labelByState.get(r.to) ?? r.to}: ${r.count.toLocaleString()}`}</title>
              </path>
            );
          })}

          {leftBars.map((b) => {
            const c = colorFor(b.state);
            const midY = b.y + b.height / 2;
            return (
              <g key={`l-${b.state}`}>
                <rect x={leftX} y={b.y} width={NODE_WIDTH} height={Math.max(0, b.height)} rx={4} fill={c.bar} opacity={0.85} />
                <text x={leftX - 6} y={midY + 4} textAnchor="end" fontSize={11} fontWeight={600} fill={c.text} fontFamily="var(--font-sans)">
                  {labelByState.get(b.state) ?? b.state}
                </text>
                <text x={leftX - 6} y={midY + 16} textAnchor="end" fontSize={10} fill="var(--text-muted)" fontFamily="var(--font-sans)">
                  {formatK(b.total)}
                </text>
              </g>
            );
          })}

          {rightBars.map((b) => {
            const c = colorFor(b.state);
            const midY = b.y + b.height / 2;
            return (
              <g key={`r-${b.state}`}>
                <rect x={rightX} y={b.y} width={NODE_WIDTH} height={Math.max(0, b.height)} rx={4} fill={c.bar} opacity={0.6} />
                <text x={rightX + NODE_WIDTH + 6} y={midY + 4} textAnchor="start" fontSize={11} fontWeight={600} fill={c.text} fontFamily="var(--font-sans)">
                  {labelByState.get(b.state) ?? b.state}
                </text>
                <text x={rightX + NODE_WIDTH + 6} y={midY + 16} textAnchor="start" fontSize={10} fill="var(--text-muted)" fontFamily="var(--font-sans)">
                  {formatK(b.total)}
                </text>
              </g>
            );
          })}

          <text x={leftX + NODE_WIDTH / 2} y={SVG_PADDING.top - 4} textAnchor="middle" fontSize={10} fontWeight={600} fill="var(--text-muted)" letterSpacing="0.05em" fontFamily="var(--font-sans)">
            {transitionMeta?.prevDate ? transitionMeta.prevDate.slice(5) : 'PREV'}
          </text>
          <text x={rightX + NODE_WIDTH / 2} y={SVG_PADDING.top - 4} textAnchor="middle" fontSize={10} fontWeight={600} fill="var(--text-muted)" letterSpacing="0.05em" fontFamily="var(--font-sans)">
            {transitionMeta?.currDate ? transitionMeta.currDate.slice(5) : 'CURR'}
          </text>
        </svg>

        <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.4 }}>
          {transitionsUnavailableReason}
        </div>
      </div>
    );
  }

  // ── Disclosed-empty mode: node bars from full-population current state ──────
  const total = nodes.reduce((s, n) => s + n.count, 0) || 1;
  const minBarH = 6;
  const availH = innerH - (nodes.length - 1) * NODE_GAP;
  const rawHeights = nodes.map((n) => Math.max(minBarH, (n.count / total) * availH));
  const rawTotal = rawHeights.reduce((s, h) => s + h, 0);
  const scale = rawTotal > availH ? availH / rawTotal : 1;
  const barHeights = rawHeights.map((h) => h * scale);
  const yPositions: number[] = [];
  let y = SVG_PADDING.top;
  barHeights.forEach((h) => {
    yPositions.push(y);
    y += h + NODE_GAP;
  });

  return (
    <div style={{ position: 'relative', width, fontFamily: 'var(--font-sans)' }}>
      <svg width={width} height={height} aria-label="Lifecycle state distribution" style={{ overflow: 'visible' }}>
        {nodes.map((node, i) => {
          const colors = STATE_COLORS[node.state];
          const bh = barHeights[i];
          const yp = yPositions[i];
          const midY = yp + bh / 2;
          return (
            <g key={node.state}>
              <rect x={leftX} y={yp} width={NODE_WIDTH} height={bh} rx={4} fill={colors.bar} opacity={0.85} />
              <text x={leftX - 6} y={midY + 4} textAnchor="end" fontSize={11} fontWeight={600} fill={colors.text} fontFamily="var(--font-sans)">
                {node.label}
              </text>
              <text x={leftX - 6} y={midY + 16} textAnchor="end" fontSize={10} fill="var(--text-muted)" fontFamily="var(--font-sans)">
                {formatK(node.count)}
              </text>
              <rect x={rightX} y={yp} width={NODE_WIDTH} height={bh} rx={4} fill={colors.bar} opacity={0.4} />
              <text x={rightX + NODE_WIDTH + 6} y={midY + 4} textAnchor="start" fontSize={11} fontWeight={600} fill={colors.text} fontFamily="var(--font-sans)">
                {node.label}
              </text>
              <text x={rightX + NODE_WIDTH + 6} y={midY + 16} textAnchor="start" fontSize={10} fill="var(--text-muted)" fontFamily="var(--font-sans)">
                {formatK(node.count)}
              </text>
            </g>
          );
        })}
        <text x={leftX + NODE_WIDTH / 2} y={SVG_PADDING.top - 4} textAnchor="middle" fontSize={10} fontWeight={600} fill="var(--text-muted)" letterSpacing="0.05em" fontFamily="var(--font-sans)">
          LAST WEEK
        </text>
        <text x={rightX + NODE_WIDTH / 2} y={SVG_PADDING.top - 4} textAnchor="middle" fontSize={10} fontWeight={600} fill="var(--text-muted)" letterSpacing="0.05em" fontFamily="var(--font-sans)">
          THIS WEEK
        </text>
      </svg>

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
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Transition flows
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', maxWidth: 220, lineHeight: 1.4 }}>
          {transitionsUnavailableReason}
        </span>
      </div>
    </div>
  );
}
