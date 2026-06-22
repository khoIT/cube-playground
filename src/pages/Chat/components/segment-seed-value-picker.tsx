/**
 * SegmentSeedValuePicker — the seed path of "Build segment from this".
 *
 * Shown when an explored query is a breakdown (groups by a dimension but filters
 * no rows — translateQuery reason `breakdown_unfiltered`). The grouping
 * dimension's selectivity lives in a GROUP BY, so we cannot translate it to a
 * cohort directly. Instead we fetch the dimension's distinct values and let the
 * user pick which one(s) define the segment, then hand back an equals/in
 * predicate via `onConfirm`.
 *
 * Best-effort: if the value fetch fails or returns nothing, the panel says so
 * and offers Cancel — it never blocks or errors the card.
 */
import React, { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { T, Icon } from '../../../shell/theme';
import { segmentsClient } from '../../../api/segments-client';

interface Props {
  gameId: string;
  /** Candidate grouping dimensions (usually one). */
  dimensions: string[];
  /** The explored breakdown query — run as-is to enumerate distinct values. */
  query: unknown;
  onConfirm: (dimension: string, values: string[]) => void;
  onCancel: () => void;
}

export function SegmentSeedValuePicker({ gameId, dimensions, query, onConfirm, onCancel }: Props) {
  const [dimension, setDimension] = useState(dimensions[0] ?? '');
  const [values, setValues] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setValues(null);
    setSelected(new Set());
    segmentsClient
      .dimensionValues({ game_id: gameId, dimension, query })
      .then((r) => {
        if (cancelled) return;
        setValues(r.values);
      })
      .catch(() => {
        if (!cancelled) setValues([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gameId, dimension, query]);

  const toggle = (v: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  };

  const shortDim = dimension.split('.').pop() ?? dimension;

  return (
    <div
      style={{
        marginTop: 12,
        padding: 16,
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-card)',
        background: 'var(--bg-card)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon icon={Users} size={14} color="var(--brand)" />
        <span style={{ fontFamily: T.fSans, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
          Which {shortDim}?
        </span>
      </div>

      {/* Dimension switch — only when the breakdown had more than one grouping dim. */}
      {dimensions.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {dimensions.map((d) => {
            const active = d === dimension;
            return (
              <button
                key={d}
                type="button"
                onClick={() => setDimension(d)}
                style={{
                  padding: '3px 10px',
                  borderRadius: 'var(--radius-sm)',
                  border: `1px solid ${active ? 'var(--brand)' : 'var(--border-card)'}`,
                  background: active ? 'var(--info-soft)' : 'transparent',
                  color: active ? 'var(--info-ink)' : 'var(--text-secondary)',
                  fontFamily: T.fSans,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {d.split('.').pop() ?? d}
              </button>
            );
          })}
        </div>
      )}

      {loading && (
        <span style={{ fontFamily: T.fSans, fontSize: 12, color: 'var(--text-muted)' }}>Loading values…</span>
      )}

      {!loading && values && values.length === 0 && (
        <span style={{ fontFamily: T.fSans, fontSize: 12, color: 'var(--text-muted)' }}>
          Couldn’t load values for this dimension. Build from the Playground instead.
        </span>
      )}

      {!loading && values && values.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {values.map((v) => {
            const on = selected.has(v);
            return (
              <button
                key={v}
                type="button"
                onClick={() => toggle(v)}
                style={{
                  padding: '4px 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: `1px solid ${on ? 'var(--brand)' : 'var(--border-card)'}`,
                  background: on ? 'var(--info-soft)' : 'transparent',
                  color: on ? 'var(--info-ink)' : 'var(--text-secondary)',
                  fontFamily: T.fSans,
                  fontSize: 12,
                  fontWeight: on ? 600 : 400,
                  cursor: 'pointer',
                }}
              >
                {v}
              </button>
            );
          })}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={onCancel}
          style={{
            height: 32,
            padding: '0 14px',
            borderRadius: 'var(--radius-md)',
            background: 'transparent',
            border: '1px solid var(--border-card)',
            cursor: 'pointer',
            fontFamily: T.fSans,
            fontSize: 13,
            color: 'var(--text-muted)',
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={selected.size === 0}
          onClick={() => onConfirm(dimension, [...selected])}
          style={{
            height: 32,
            padding: '0 14px',
            borderRadius: 'var(--radius-md)',
            background: selected.size === 0 ? 'var(--bg-muted)' : 'var(--brand)',
            border: 'none',
            cursor: selected.size === 0 ? 'default' : 'pointer',
            fontFamily: T.fSans,
            fontSize: 13,
            fontWeight: 600,
            color: selected.size === 0 ? 'var(--text-muted)' : 'var(--text-inverse)',
          }}
        >
          Build segment
        </button>
      </div>
    </div>
  );
}
