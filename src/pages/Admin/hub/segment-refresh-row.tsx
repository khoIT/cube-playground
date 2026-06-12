/**
 * One row in the Segment Refreshes table: status chip, age-vs-cadence, per-card
 * ok/error tally, and operator actions (Refresh now / Unstick). Expands to show
 * erroring card ids + messages. Tokens only — no inline hex.
 */

import React, { useCallback, useState } from 'react';
import { ChevronRight, RefreshCw, Wrench } from 'lucide-react';
import {
  stateMeta,
  fmtAge,
  fmtCadence,
  useCardProgress,
  type StateTone,
} from './segment-refresh-ops-data';
import type { SegmentRefreshOpsRow, CardPhase, SegmentCardProgress } from '../../../types/segment-refresh-ops';

/** Per-card phase → dot colour for the live refresh checklist. */
const PHASE_DOT: Record<CardPhase, string> = {
  queued: 'var(--text-muted)',
  running: 'var(--info-ink)',
  ok: 'var(--success-ink)',
  error: 'var(--destructive-ink)',
};

const SPIN_KEYFRAMES = '@keyframes segrefresh-spin{to{transform:rotate(360deg)}}';

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

/** One card line: spinning icon while its query runs, coloured dot once settled. */
function CardLine({ cardId, phase }: { cardId: string; phase: CardPhase }) {
  return (
    <li style={{ fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
      {phase === 'running' ? (
        <RefreshCw
          size={11}
          aria-label="querying"
          style={{ color: 'var(--info-ink)', flexShrink: 0, animation: 'segrefresh-spin .9s linear infinite', transformOrigin: 'center' }}
        />
      ) : (
        <span
          aria-hidden
          style={{
            width: 7,
            height: 7,
            margin: '0 2px',
            borderRadius: '50%',
            flexShrink: 0,
            background: PHASE_DOT[phase],
          }}
        />
      )}
      <code
        title={cardId}
        style={{
          color: phase === 'queued' ? 'var(--text-muted)' : 'var(--text-primary)',
          fontWeight: phase === 'running' ? 700 : 500,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {cardId}
      </code>
      {phase === 'running' && (
        <span style={{ fontSize: 10.5, color: 'var(--info-ink)', fontStyle: 'italic', flexShrink: 0 }}>querying…</span>
      )}
    </li>
  );
}

/** Live per-card checklist for a refresh pass. Presentational — the row owns the
 *  poll. Stays visible AFTER the pass completes (showing final ok/error per card)
 *  so a fast pass doesn't flash by; only collapsing or a new refresh resets it.
 *  When no progress has been reported yet (uid phase, or the run is on another
 *  gateway), falls back to a plain "querying…" sign. */
function LiveChecklist({ progress }: { progress: SegmentCardProgress | null }) {
  // No per-card detail yet — show a generic in-progress sign rather than nothing.
  if (!progress) {
    return (
      <div style={{ fontSize: 12, color: 'var(--info-ink)', display: 'flex', alignItems: 'center', gap: 7 }}>
        <style>{SPIN_KEYFRAMES}</style>
        <RefreshCw size={13} style={{ animation: 'segrefresh-spin .9s linear infinite', transformOrigin: 'center' }} />
        Querying cards… (materializing the cohort before per-card progress)
      </div>
    );
  }
  const { total, done, ok, error, cards } = progress;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const live = !progress.finishedAt;
  return (
    <div>
      <style>{SPIN_KEYFRAMES}</style>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6, lineHeight: 1.4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {live && (
          <RefreshCw size={12} style={{ color: 'var(--info-ink)', animation: 'segrefresh-spin .9s linear infinite', transformOrigin: 'center', flexShrink: 0 }} />
        )}
        <strong style={{ color: live ? 'var(--info-ink)' : 'var(--text-primary)' }}>
          {live ? 'Refreshing live' : 'Last refresh pass'}
        </strong>
        <span>— {done}/{total} cards</span>
        <span>· <span style={{ color: 'var(--success-ink)' }}>{ok} ok</span></span>
        <span>· <span style={{ color: error > 0 ? 'var(--destructive-ink)' : 'var(--text-muted)' }}>{error} failed</span></span>
        {!live && <span style={{ color: 'var(--text-muted)' }}>· complete</span>}
      </div>
      {/* Progress bar — info while running, green/red tinted once complete. */}
      <div style={{ height: 4, borderRadius: 'var(--radius-full)', background: 'var(--muted-soft)', overflow: 'hidden', marginBottom: 10 }}>
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: live ? 'var(--info-ink)' : error > 0 ? 'var(--destructive-ink)' : 'var(--success-ink)',
            transition: 'width 300ms',
          }}
        />
      </div>
      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: 'none',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '3px 16px',
        }}
      >
        {cards.map((c) => (
          <CardLine key={c.cardId} cardId={c.cardId} phase={c.phase} />
        ))}
      </ul>
    </div>
  );
}

export interface SegmentRefreshRowProps {
  row: SegmentRefreshOpsRow;
  /** Waiting in the serial refresh queue behind the in-flight segment. */
  queued?: boolean;
  busy: boolean;
  onRefresh: (id: string) => void;
  onUnstick: (id: string) => void;
  /** Called once when a live refresh pass for this row finishes, so the parent
   *  can refetch the ops list to reflect the settled state. */
  onProgressComplete?: (id: string) => void;
}

export function SegmentRefreshRow({ row, queued = false, busy, onRefresh, onUnstick, onProgressComplete }: SegmentRefreshRowProps) {
  const [open, setOpen] = useState(false);
  const hasFailing = row.failingCards > 0;
  const hardDown = row.cards.error > 0; // cards with no last-good to render
  const isRefreshing = row.derivedState === 'in_flight';
  // Allow expanding a refreshing row even with no prior errors, so the live
  // checklist is reachable the first time a healthy segment refreshes.
  const canExpand = row.erroringCards.length > 0 || row.brokenReason != null || isRefreshing;
  const showUnstick = row.derivedState === 'wedged';
  const handleComplete = useCallback(() => onProgressComplete?.(row.id), [onProgressComplete, row.id]);

  // Poll per-card progress while expanded. Owned by the row (not the checklist)
  // so the last-known progress survives after the pass finishes and the row
  // flips out of 'in_flight' — otherwise a fast pass (e.g. cards that 400
  // instantly on a missing pre-agg) would flash by and vanish.
  const { progress } = useCardProgress(row.id, open, 1500, handleComplete);
  // Show the live view whenever we have progress for this segment, or while it's
  // actively refreshing (even before the first per-card report lands).
  const showLive = open && (progress != null || isRefreshing);

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

        {/* Card tally — surface the FAILING count (last refresh errored) so cards
            that still serve a last-good value can't read green as "X/X cards ok".
            Destructive when some are hard-down (no last-good), warning when all
            failing cards are still serving last-good (the silent decay). */}
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', whiteSpace: 'nowrap', minWidth: 92, textAlign: 'right' }}>
          {row.cards.total > 0 ? (
            hasFailing ? (
              <span style={{ color: hardDown ? 'var(--destructive-ink)' : 'var(--warning-ink)', fontWeight: 600 }}>
                {row.failingCards}/{row.cards.total} failing
              </span>
            ) : (
              <>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
                  {row.cards.ok}/{row.cards.total}
                </span>{' '}
                cards ok
              </>
            )
          ) : (
            'no cards'
          )}
        </div>

        {/* Last refreshed */}
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', whiteSpace: 'nowrap', minWidth: 96, textAlign: 'right' }}>
          {fmtAge(row.ageMs)}
        </div>

        {/* State chip — queued in the serial drain takes display precedence over
            the staleness-derived state, which would otherwise just say "Due". */}
        <div style={{ minWidth: 96, textAlign: 'right' }}>
          {queued && row.derivedState !== 'in_flight' ? (
            <span
              title="Waiting in the refresh queue behind the segment currently refreshing"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                height: 22,
                padding: '0 9px',
                borderRadius: 'var(--radius-full)',
                fontSize: 11.5,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                background: 'var(--info-soft)',
                color: 'var(--info-ink)',
              }}
            >
              Queued
            </span>
          ) : (
            <StateChip state={row.derivedState} />
          )}
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
          {/* Disabled while this segment's refresh is in flight — the server
              dedupes too, but the button shouldn't invite a redundant click. */}
          <button
            type="button"
            style={{ ...actionBtn, ...(busy || isRefreshing ? { opacity: 0.5, cursor: busy ? 'wait' : 'default' } : {}) }}
            disabled={busy || isRefreshing}
            onClick={() => onRefresh(row.id)}
            title={isRefreshing ? 'Refresh already in progress' : 'Enqueue an immediate refresh'}
          >
            <RefreshCw size={13} /> {isRefreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Expanded detail — live checklist while refreshing, else erroring
          cards + broken reason from the last pass. */}
      {open && canExpand && (
        <div style={{ padding: '4px 16px 14px 43px', background: 'var(--bg-subtle, var(--muted-soft))' }}>
          {showLive && (
            <div style={{ marginBottom: row.erroringCards.length > 0 || row.brokenReason ? 12 : 0 }}>
              <LiveChecklist progress={progress} />
            </div>
          )}
          {row.brokenReason && (
            <div style={{ fontSize: 12, color: 'var(--destructive-ink)', marginBottom: 8 }}>
              <strong>Broken:</strong> {row.brokenReason}
            </div>
          )}
          {row.cardsStale && (
            <div style={{ fontSize: 12, color: 'var(--warning-ink)', marginBottom: 8, lineHeight: 1.45 }}>
              <strong>Serving last-good:</strong> {row.failingCards} card{row.failingCards === 1 ? '' : 's'}{' '}
              {row.failingCards === 1 ? 'is' : 'are'} failing to refresh but still rendering a prior value
              (newest value changed {fmtAge(row.newestCardAgeMs)}). Reads green by status alone. Use Refresh
              to force a recompute, or check the card-runner logs for the errors below.
            </div>
          )}
          {row.erroringCards.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 5 }}>
                Failing cards ({row.erroringCards.length})
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
