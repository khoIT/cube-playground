/**
 * One row in the Segment Refreshes table: status chip, age-vs-cadence, per-card
 * ok/error tally, and operator actions (Refresh now / Unstick). Expands to show
 * erroring card ids + messages. Tokens only — no inline hex.
 */

import React, { useState } from 'react';
import { ChevronRight, RefreshCw, Wrench } from 'lucide-react';
import {
  stateMeta,
  fmtAge,
  fmtCadence,
  type StateTone,
} from './segment-refresh-ops-data';
import type { SegmentRefreshOpsRow } from '../../../types/segment-refresh-ops';

const TONE_CHIP: Record<StateTone, React.CSSProperties> = {
  positive:    { background: 'var(--success-soft)',     color: 'var(--success-ink)' },
  info:        { background: 'var(--info-soft)',         color: 'var(--info-ink)' },
  warning:     { background: 'var(--warning-soft)',      color: 'var(--warning-ink)' },
  destructive: { background: 'var(--destructive-soft)',  color: 'var(--destructive-ink)' },
  muted:       { background: 'var(--muted-soft)',        color: 'var(--muted-ink)' },
};

function StateChip({ state }: { state: SegmentRefreshOpsRow['derivedState'] }) {
  const meta = stateMeta(state);
  return (
    <span
      title={meta.blurb}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 22,
        padding: '0 9px',
        borderRadius: 'var(--radius-full)',
        fontSize: 11.5,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        ...TONE_CHIP[meta.tone],
      }}
    >
      {meta.label}
    </span>
  );
}

const actionBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  height: 26,
  padding: '0 10px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border-card)',
  background: 'var(--bg-card)',
  color: 'var(--text-secondary)',
  fontSize: 11.5,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

export interface SegmentRefreshRowProps {
  row: SegmentRefreshOpsRow;
  busy: boolean;
  onRefresh: (id: string) => void;
  onUnstick: (id: string) => void;
}

export function SegmentRefreshRow({ row, busy, onRefresh, onUnstick }: SegmentRefreshRowProps) {
  const [open, setOpen] = useState(false);
  const hasErrors = row.cards.error > 0;
  const canExpand = hasErrors || row.brokenReason != null;
  const showUnstick = row.derivedState === 'wedged';

  return (
    <div style={{ borderBottom: '1px solid var(--border-card)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '11px 16px',
        }}
      >
        {/* Expand caret */}
        <button
          type="button"
          onClick={() => canExpand && setOpen((v) => !v)}
          aria-label={open ? 'Collapse' : 'Expand'}
          disabled={!canExpand}
          style={{
            border: 'none',
            background: 'transparent',
            cursor: canExpand ? 'pointer' : 'default',
            padding: 0,
            display: 'flex',
            color: canExpand ? 'var(--text-muted)' : 'transparent',
          }}
        >
          <ChevronRight
            size={15}
            style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 120ms' }}
          />
        </button>

        {/* Name + game */}
        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {row.name}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {row.gameId} · {row.uidCount.toLocaleString()} uids · every {fmtCadence(row.cadenceMin)}
          </div>
        </div>

        {/* Card tally */}
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', whiteSpace: 'nowrap', minWidth: 92, textAlign: 'right' }}>
          {row.cards.total > 0 ? (
            <>
              <span style={{ color: hasErrors ? 'var(--destructive-ink)' : 'var(--text-secondary)', fontWeight: 600 }}>
                {row.cards.ok}/{row.cards.total}
              </span>{' '}
              cards ok
            </>
          ) : (
            'no cards'
          )}
        </div>

        {/* Last refreshed */}
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', whiteSpace: 'nowrap', minWidth: 96, textAlign: 'right' }}>
          {fmtAge(row.ageMs)}
        </div>

        {/* State chip */}
        <div style={{ minWidth: 96, textAlign: 'right' }}>
          <StateChip state={row.derivedState} />
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 6, minWidth: 0 }}>
          {showUnstick && (
            <button
              type="button"
              style={{ ...actionBtn, ...(busy ? { opacity: 0.5, cursor: 'wait' } : {}), borderColor: 'var(--destructive-ink)', color: 'var(--destructive-ink)' }}
              disabled={busy}
              onClick={() => onUnstick(row.id)}
              title="Reset this wedged segment to stale so the cron re-runs it"
            >
              <Wrench size={13} /> Unstick
            </button>
          )}
          <button
            type="button"
            style={{ ...actionBtn, ...(busy ? { opacity: 0.5, cursor: 'wait' } : {}) }}
            disabled={busy}
            onClick={() => onRefresh(row.id)}
            title="Enqueue an immediate refresh"
          >
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      {/* Expanded detail — erroring cards + broken reason */}
      {open && canExpand && (
        <div style={{ padding: '4px 16px 14px 43px', background: 'var(--bg-subtle, var(--muted-soft))' }}>
          {row.brokenReason && (
            <div style={{ fontSize: 12, color: 'var(--destructive-ink)', marginBottom: 8 }}>
              <strong>Broken:</strong> {row.brokenReason}
            </div>
          )}
          {row.erroringCards.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 5 }}>
                Erroring cards ({row.erroringCards.length})
              </div>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {row.erroringCards.map((c) => (
                  <li key={c.cardId} style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                    <code style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{c.cardId}</code>
                    {c.error ? <span style={{ color: 'var(--text-muted)' }}> — {c.error}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
