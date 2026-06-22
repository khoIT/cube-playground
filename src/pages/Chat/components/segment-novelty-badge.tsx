/**
 * SegmentNoveltyBadge — quiet overlap warning fetched lazily after the proposal
 * renders. If a saved segment significantly overlaps the candidate predicate,
 * shows a single-line badge: "≈86% overlaps 'Lapsing Whales'" with a nav link.
 *
 * Renders nothing on empty results, error, or timeout. Never blocks confirm.
 * Always labeled "≈" — the overlap is approximate (sample-vs-snapshot).
 */
import React, { useEffect, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { T, Icon } from '../../../shell/theme';
import { segmentsClient } from '../../../api/segments-client';
import type { PredicateNode } from '../../../types/segment-api';

interface Props {
  gameId: string;
  cube: string;
  predicate: PredicateNode;
}

type TopOverlap = {
  segment_id: string;
  name: string;
  pct_of_candidate: number;
};

// Only surface an overlap badge when it exceeds this threshold — below this it
// is noise (different enough cohorts that we don't need to warn).
const OVERLAP_WARN_PCT = 40;

export function SegmentNoveltyBadge({ gameId, cube, predicate }: Props) {
  const history = useHistory();
  const [top, setTop] = useState<TopOverlap | null>(null);

  useEffect(() => {
    let cancelled = false;
    segmentsClient
      .overlapCandidate({ game_id: gameId, cube, predicate })
      .then((res) => {
        if (cancelled) return;
        const best = res.overlaps.find((o) => o.pct_of_candidate >= OVERLAP_WARN_PCT) ?? null;
        setTop(best);
      })
      .catch(() => {
        // Silently swallow — badge is non-blocking; absence is safe.
      });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // fetch once at mount; proposal predicate is stable

  if (!top) return null;

  const pct = Math.round(top.pct_of_candidate);

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--warning-soft)',
        // color-mix keeps the border faint without inline hex math (a raw
        // `var(--warning-ink)40` concat is an unparseable color and drops out).
        border: '1px solid color-mix(in srgb, var(--warning-ink) 25%, transparent)',
        alignSelf: 'flex-start',
      }}
    >
      <Icon icon={AlertCircle} size={12} color="var(--warning-ink)" />
      <span style={{ fontFamily: T.fSans, fontSize: 12, color: 'var(--warning-ink)' }}>
        ≈{pct}% overlaps{' '}
        <button
          type="button"
          onClick={() => history.push(`/segments/${top.segment_id}`)}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            fontFamily: T.fSans,
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--warning-ink)',
            textDecoration: 'underline',
            textDecorationStyle: 'dotted',
          }}
        >
          '{top.name}'
        </button>
      </span>
    </div>
  );
}
