/**
 * CutoffDistributionPicker — histogram strip with a draggable threshold line.
 *
 * Renders once when a single numeric threshold is detected in the proposal
 * predicate. The parent owns the current cutoff value and receives updates
 * through `onChange` (debounced 250 ms). A "counting…" hint is shown while
 * the parent re-counts; the parent passes `counting` as a prop.
 *
 * FALLBACK: if distribution returns buckets:null, errors, or times out → the
 * component renders nothing so the card falls back to its normal numeric
 * display. Never blocks confirm.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { T } from '../../../shell/theme';
import { segmentsClient } from '../../../api/segments-client';
import type { PredicateNode } from '../../../types/segment-api';

interface Props {
  gameId: string;
  cube: string;
  member: string;
  predicate: PredicateNode;
  /** The numeric axis direction: gt/gte keeps right side; lt/lte keeps left side. */
  op: 'gt' | 'gte' | 'lt' | 'lte';
  value: number;
  onChange: (next: number) => void;
  /** Parent passes true while a re-count is in flight. */
  counting?: boolean;
}

type Bucket = { lo: number; hi: number; count: number };

const BAR_HEIGHT = 32;
const CHART_WIDTH = 480; // logical max; component uses container width via div

export function CutoffDistributionPicker({
  gameId,
  member,
  predicate,
  op,
  value,
  onChange,
  counting = false,
}: Props) {
  const [buckets, setBuckets] = useState<Bucket[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // Local dragged value (updates immediately on drag; onChange fires debounced).
  const [localValue, setLocalValue] = useState(value);

  // Keep localValue in sync when parent resets it (e.g. initial load).
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
    setLocalValue(value);
  }, [value]);

  // Fetch distribution once on mount.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    const timer = setTimeout(() => { if (!cancelled) setFailed(true); }, 8000);
    segmentsClient
      .distribution({ game_id: gameId, member, population_predicate: predicate })
      .then((res) => {
        clearTimeout(timer);
        if (!cancelled) {
          setBuckets(res.buckets && res.buckets.length > 0 ? res.buckets : null);
          setLoading(false);
        }
      })
      .catch(() => {
        clearTimeout(timer);
        if (!cancelled) { setFailed(true); setLoading(false); }
      });
    return () => { cancelled = true; clearTimeout(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally run once; props are stable at mount

  // Debounced callback so we don't spam the preview API on every pixel.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emitChange = useCallback((next: number) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { onChange(next); }, 250);
  }, [onChange]);

  // Dragging state: pointer capture on the SVG overlay.
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragging = useRef(false);

  const svgXToValue = useCallback((clientX: number): number => {
    if (!svgRef.current || !buckets?.length) return localValue;
    const rect = svgRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const min = buckets[0].lo;
    const max = buckets[buckets.length - 1].hi;
    return min + ratio * (max - min);
  }, [buckets, localValue]);

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    dragging.current = true;
    (e.target as Element).setPointerCapture(e.pointerId);
    const next = svgXToValue(e.clientX);
    setLocalValue(next);
    emitChange(next);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragging.current) return;
    const next = svgXToValue(e.clientX);
    setLocalValue(next);
    emitChange(next);
  };

  const handlePointerUp = () => { dragging.current = false; };

  // Render nothing on failure or unavailable distribution.
  if (failed || (!loading && !buckets)) return null;

  // Loading skeleton: 8 grey bars.
  if (loading || !buckets) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
        <span style={{ fontFamily: T.fSans, fontSize: 11, fontWeight: 600, color: 'var(--shell-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Distribution
        </span>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: BAR_HEIGHT }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} style={{ flex: 1, height: `${30 + Math.sin(i) * 20}%`, background: 'var(--fill-faint)', borderRadius: 2 }} />
          ))}
        </div>
      </div>
    );
  }

  // Compute bar heights (normalised to max count).
  const maxCount = Math.max(...buckets.map((b) => b.count), 1);
  const min = buckets[0].lo;
  const max = buckets[buckets.length - 1].hi;
  const range = max - min || 1;

  // Threshold line X position (0..1).
  const thresholdRatio = Math.max(0, Math.min(1, (localValue - min) / range));

  // Determine which buckets are in the "kept" side.
  const isKept = (b: Bucket): boolean =>
    op === 'gt' || op === 'gte' ? b.lo >= localValue : b.hi <= localValue;

  const svgW = CHART_WIDTH;
  const svgH = BAR_HEIGHT + 14; // bars + bottom label row

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontFamily: T.fSans, fontSize: 11, fontWeight: 600, color: 'var(--shell-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Distribution
        </span>
        {counting && (
          <span style={{ fontFamily: T.fSans, fontSize: 11, color: 'var(--shell-text-faint)', fontStyle: 'italic' }}>
            counting…
          </span>
        )}
      </div>

      {/* SVG histogram strip with draggable threshold. */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${svgW} ${svgH}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: BAR_HEIGHT + 14, cursor: 'ew-resize', display: 'block', borderRadius: 'var(--radius-sm)', overflow: 'visible' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* Bars */}
        {buckets.map((b, i) => {
          const x = ((b.lo - min) / range) * svgW;
          const w = Math.max(1, ((b.hi - b.lo) / range) * svgW - 1);
          const h = Math.max(2, (b.count / maxCount) * BAR_HEIGHT);
          const kept = isKept(b);
          return (
            <rect
              key={i}
              x={x}
              y={BAR_HEIGHT - h}
              width={w}
              height={h}
              fill={kept ? 'var(--brand)' : 'var(--fill-faint)'}
              rx={1}
              style={{ transition: 'fill 0.1s' }}
            />
          );
        })}

        {/* Threshold line */}
        <line
          x1={thresholdRatio * svgW}
          y1={0}
          x2={thresholdRatio * svgW}
          y2={BAR_HEIGHT}
          stroke="var(--text-primary)"
          strokeWidth={1.5}
          strokeDasharray="3 2"
        />

        {/* Threshold label */}
        <text
          x={Math.min(thresholdRatio * svgW + 3, svgW - 40)}
          y={svgH - 2}
          fontFamily={T.fSans}
          fontSize={10}
          fill="var(--shell-text-muted)"
        >
          {localValue % 1 === 0 ? localValue.toLocaleString() : localValue.toFixed(2)}
        </text>
      </svg>
    </div>
  );
}
