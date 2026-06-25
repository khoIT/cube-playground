/**
 * Feature Atlas — Variant 2: cluster graph. Radial surface clusters from the
 * pure build-atlas-graph layout, rendered as absolute-positioned nodes + an SVG
 * edge layer, with pan/zoom. Dep edges highlight only on hover/select (the
 * graph's collapse-by-interaction density control). Hand-rolled (no graph lib).
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { buildAtlasGraph } from './build-atlas-graph';
import { HEALTH_TOKENS } from './atlas-encoding';
import type { AtlasModel } from './atlas-types';

interface ViewProps {
  model: AtlasModel;
  visible: Set<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const PAD = 80;

export function AtlasGraphView({ model, visible, selectedId, onSelect }: ViewProps): ReactElement {
  const graph = useMemo(() => buildAtlasGraph(model), [model]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, s: 1 });
  const [hovered, setHovered] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  const offX = -graph.bounds.minX + PAD;
  const offY = -graph.bounds.minY + PAD;
  const stageW = graph.bounds.maxX - graph.bounds.minX + PAD * 2;
  const stageH = graph.bounds.maxY - graph.bounds.minY + PAD * 2;

  // Fit-to-viewport once on mount.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const s = Math.min(width / stageW, height / stageH) * 0.92;
    setView({ s, x: (width - stageW * s) / 2, y: (height - stageH * s) / 2 });
  }, [stageW, stageH]);

  const onDown = (e: React.MouseEvent) => { drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; };
  const onMove = (e: React.MouseEvent) => {
    if (!drag.current) return;
    setView((v) => ({ ...v, x: drag.current!.vx + (e.clientX - drag.current!.x), y: drag.current!.vy + (e.clientY - drag.current!.y) }));
  };
  const onUp = () => { drag.current = null; };
  const onWheel = (e: React.WheelEvent) => {
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    setView((v) => ({ ...v, s: Math.min(2.5, Math.max(0.2, v.s * factor)) }));
  };
  const zoom = (factor: number) => setView((v) => ({ ...v, s: Math.min(2.5, Math.max(0.2, v.s * factor)) }));

  const isVisible = (gid: string) => !gid.startsWith('feature:') || visible.has(gid.slice('feature:'.length));
  const pos = new Map(graph.nodes.map((n) => [n.id, { x: n.x + offX, y: n.y + offY }]));
  const activeNode = hovered ?? (selectedId ? `feature:${selectedId}` : null);

  return (
    <div
      ref={wrapRef}
      className={`atlas-graph${drag.current ? ' is-panning' : ''}`}
      onMouseDown={onDown}
      onMouseMove={onMove}
      onMouseUp={onUp}
      onMouseLeave={onUp}
      onWheel={onWheel}
    >
      <div style={{ position: 'absolute', transformOrigin: '0 0', transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`, width: stageW, height: stageH }}>
        <svg width={stageW} height={stageH}>
          {graph.edges.map((e) => {
            if (!isVisible(e.source) || !isVisible(e.target)) return null;
            const a = pos.get(e.source); const b = pos.get(e.target);
            if (!a || !b) return null;
            const active = activeNode === e.source || activeNode === e.target;
            return <line key={e.id} className={`atlas-graph-edge${active ? ' is-active' : ''}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
          })}
        </svg>
        {graph.nodes.map((n) => {
          const p = pos.get(n.id)!;
          if (n.kind === 'surface') {
            return <div key={n.id} className="atlas-gnode atlas-gnode-surface" style={{ left: p.x, top: p.y }}>{n.label}</div>;
          }
          if (!visible.has(n.feature!.id)) return null;
          const accent = HEALTH_TOKENS[n.feature!.health].ink;
          return (
            <div
              key={n.id}
              className={`atlas-gnode atlas-gnode-feature${selectedId === n.feature!.id ? ' is-selected' : ''}`}
              style={{ left: p.x, top: p.y, borderLeftColor: accent }}
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onSelect(n.feature!.id); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onSelect(n.feature!.id); } }}
              onMouseEnter={() => setHovered(n.id)}
              onMouseLeave={() => setHovered(null)}
              title={n.feature!.summary}
            >
              <span className="atlas-gn-label">{n.label}</span>
            </div>
          );
        })}
      </div>
      <div className="atlas-graph-controls">
        <button type="button" onClick={() => zoom(1.2)} aria-label="Zoom in">+</button>
        <button type="button" onClick={() => zoom(1 / 1.2)} aria-label="Zoom out">−</button>
      </div>
    </div>
  );
}
