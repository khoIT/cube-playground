/**
 * CohortProfilePanel — lazy "who are these people?" breakdown for a candidate
 * segment predicate before it is saved.
 *
 * Collapsed by default behind a ghost toggle button. Fetches
 * segmentsClient.profile() ONCE on first expand. Renders each dimension as a
 * compact top-k list with a small bar + value + pct. Missing dims are silently
 * skipped; a partial response still renders. Never blocks confirm.
 */
import React, { useState, useRef } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { T, Icon } from '../../../shell/theme';
import { segmentsClient } from '../../../api/segments-client';
import type { PredicateNode } from '../../../types/segment-api';

interface Props {
  gameId: string;
  cube: string;
  predicate: PredicateNode;
}

type TopRow = { value: string; count: number; pct: number };
type Breakdown = { dimension: string; label: string; top: TopRow[] };
type ProfileData = {
  total: number | null;
  breakdowns: Breakdown[];
  approx: boolean;
};

type LoadState = 'idle' | 'loading' | 'done' | 'error';

export function CohortProfilePanel({ gameId, cube, predicate }: Props) {
  const [open, setOpen] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [data, setData] = useState<ProfileData | null>(null);
  // Prevent duplicate fetches if the user toggles quickly.
  const fetched = useRef(false);

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !fetched.current) {
      fetched.current = true;
      setLoadState('loading');
      segmentsClient
        .profile({ game_id: gameId, cube, predicate })
        .then((res) => {
          setData(res);
          setLoadState('done');
        })
        .catch(() => {
          setLoadState('error');
        });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* Toggle button */}
      <button
        type="button"
        onClick={handleToggle}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          background: 'none',
          border: 'none',
          padding: '2px 0',
          cursor: 'pointer',
          fontFamily: T.fSans,
          fontSize: 12,
          fontWeight: 500,
          color: 'var(--shell-text-muted)',
          alignSelf: 'flex-start',
        }}
      >
        <Icon icon={open ? ChevronDown : ChevronRight} size={13} color="var(--shell-text-muted)" />
        Profile this cohort
      </button>

      {open && (
        <div
          style={{
            background: 'var(--bg-muted)',
            border: '1px solid var(--border-card)',
            borderRadius: 'var(--radius-md)',
            padding: '10px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          {loadState === 'loading' && (
            <span style={{ fontFamily: T.fSans, fontSize: 12, color: 'var(--shell-text-faint)' }}>
              Loading profile…
            </span>
          )}

          {loadState === 'error' && (
            <span style={{ fontFamily: T.fSans, fontSize: 12, color: 'var(--warning-ink)' }}>
              Profile unavailable for this cohort.
            </span>
          )}

          {loadState === 'done' && data && (
            <>
              {data.approx && (
                <span style={{ fontFamily: T.fSans, fontSize: 11, color: 'var(--shell-text-faint)', fontStyle: 'italic' }}>
                  Approximate — sampled population
                </span>
              )}

              {data.breakdowns.length === 0 && (
                <span style={{ fontFamily: T.fSans, fontSize: 12, color: 'var(--shell-text-faint)' }}>
                  No dimension breakdowns available for this cube.
                </span>
              )}

              {data.breakdowns.map((bd) => (
                <BreakdownBlock key={bd.dimension} breakdown={bd} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Renders one dimension's top-k rows as compact labelled bars. */
function BreakdownBlock({ breakdown }: { breakdown: Breakdown }) {
  if (!breakdown.top.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {/* Dimension label */}
      <span
        style={{
          fontFamily: T.fSans,
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--shell-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        {breakdown.label}
      </span>

      {breakdown.top.map((row) => (
        <div key={row.value} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Value label */}
          <span
            style={{
              fontFamily: T.fSans,
              fontSize: 12,
              color: 'var(--shell-text)',
              minWidth: 80,
              maxWidth: 120,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
            title={row.value}
          >
            {row.value}
          </span>

          {/* Bar track */}
          <div
            style={{
              flex: 1,
              height: 6,
              background: 'var(--fill-faint)',
              borderRadius: 3,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${Math.min(100, row.pct)}%`,
                height: '100%',
                background: 'var(--brand)',
                borderRadius: 3,
              }}
            />
          </div>

          {/* Pct + count */}
          <span
            style={{
              fontFamily: T.fSans,
              fontSize: 11,
              color: 'var(--shell-text-muted)',
              fontVariantNumeric: 'tabular-nums',
              flexShrink: 0,
              minWidth: 40,
              textAlign: 'right',
            }}
          >
            {row.pct.toFixed(0)}%
          </span>
        </div>
      ))}
    </div>
  );
}
