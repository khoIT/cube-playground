/**
 * Popover shown when a heatmap cell is clicked: the cell's coordinates, its
 * value and share of the grid total, and a "Save as segment" hand-off that
 * seeds the Segments editor with the cell's two-dimension predicate (reusing
 * the same sessionStorage prefill bridge the chat segment-proposal card uses).
 *
 * Top-contributor rows are intentionally not fetched here — that needs an
 * identity-level query for the slice; the save-as-segment path lets the user
 * materialize the cohort and inspect its members instead. Closes on outside
 * click or Escape. Tokens only (no inline hex; the heatmap ramp is the sole
 * allowlisted palette and lives in chart-heatmap.tsx).
 */

import { ReactElement, useEffect, useRef } from 'react';
import { useHistory } from 'react-router-dom';
import { X } from 'lucide-react';
import type { PredicateNode } from '../../../types/segment-api';
import type { EditorLocationState } from '../../Segments/editor/editor-route-state';
import { stashEditorPrefill } from '../../Segments/editor/editor-prefill-store';

interface Props {
  rect: DOMRect;
  seriesLabel: string;
  seriesValue: string;
  categoryLabel: string;
  categoryValue: string;
  valueLabel: string;
  valueFormatted: string;
  /** Share of the grid total, in [0, 1]. */
  pctOfTotal: number;
  cube: string;
  predicate: PredicateNode;
  segmentName: string;
  onClose: () => void;
}

const WIDTH = 260;

export function HeatmapDrilldownPopover(props: Props): ReactElement {
  const { rect, onClose } = props;
  const history = useHistory();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    // The popover is anchored to the cell's click-time rect; scrolling would
    // leave it floating over the wrong cell, so close it on any scroll/resize.
    // Defer the click listener a tick so the opening click doesn't immediately close it.
    const id = window.setTimeout(() => document.addEventListener('mousedown', onDocClick), 0);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  // Anchor under the cell centre, nudged left, clamped into the viewport.
  const rawLeft = rect.left + rect.width / 2 - WIDTH * 0.3;
  const left = Math.max(8, Math.min(rawLeft, window.innerWidth - WIDTH - 8));
  const top = rect.bottom + 6;

  function handleSave(): void {
    const state: EditorLocationState = {
      advisorPrefill: { name: props.segmentName, cube: props.cube, predicateTree: props.predicate },
    };
    stashEditorPrefill(state);
    history.push('/segments/new', state);
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Cell details"
      style={{
        position: 'fixed',
        left,
        top,
        width: WIDTH,
        zIndex: 1000,
        background: 'var(--bg-card)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-lg)',
        padding: 14,
        fontFamily: 'var(--font-sans)',
      }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        style={{
          position: 'absolute', top: 8, right: 8, border: 'none', background: 'transparent',
          color: 'var(--text-muted)', cursor: 'pointer', padding: 2, lineHeight: 0,
        }}
      >
        <X size={14} aria-hidden />
      </button>

      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>
        {props.seriesLabel} · {props.categoryLabel}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 10 }}>
        {props.seriesValue} × {props.categoryValue}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
        <span style={{ fontSize: 22, fontWeight: 600, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
          {props.valueFormatted}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{props.valueLabel}</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
        {(props.pctOfTotal * 100).toFixed(1)}% of grid total
      </div>

      <button
        type="button"
        onClick={handleSave}
        style={{
          width: '100%', fontSize: 12.5, fontWeight: 500, color: 'var(--brand)',
          background: 'var(--brand-soft)', border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-md)', padding: '6px 10px', cursor: 'pointer',
        }}
      >
        Save this cell as a segment
      </button>
    </div>
  );
}
