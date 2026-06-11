/**
 * SweepRow — one row in the sweep history list.
 *
 * Renders the collapsed header (timestamp, duration, counts) and, when
 * expanded, the per-cube outcome detail grid grouped by severity:
 *   stale_serving → failed → unbuilt → sealed
 *
 * Uses only var(--…) design tokens. No inline hex.
 */

import React from 'react';
import type { PreaggSweep, PreaggSweepItem } from '../../../types/preagg-run';
import type { Outcome } from '../../../types/preagg-run';

// ---------------------------------------------------------------------------
// OutcomeChip — small colored badge for outcome classification
// ---------------------------------------------------------------------------

const OUTCOME_STYLES: Record<Outcome, React.CSSProperties> = {
  sealed: {
    background: 'var(--success-soft)',
    color: 'var(--success-ink)',
    borderColor: 'var(--live-badge-border)',
  },
  stale_serving: {
    background: 'var(--stale-badge-bg)',
    color: 'var(--stale-badge-text)',
    borderColor: 'var(--stale-badge-border)',
  },
  failed: {
    background: 'var(--destructive-soft)',
    color: 'var(--destructive-ink)',
    borderColor: 'var(--destructive-ink)',
  },
  unbuilt: {
    background: 'var(--muted-soft)',
    color: 'var(--muted-ink)',
    borderColor: 'var(--border-card)',
  },
};

const OUTCOME_DOT: Record<Outcome, React.CSSProperties> = {
  sealed:        { background: 'var(--success)' },
  stale_serving: { background: 'var(--stale-badge-dot)' },
  failed:        { background: 'var(--danger)' },
  unbuilt:       { background: 'var(--neutral-400)' },
};

const OUTCOME_LABEL: Record<Outcome, string> = {
  sealed:        'sealed',
  stale_serving: 'stale_serving',
  failed:        'failed',
  unbuilt:       'unbuilt',
};

export function OutcomeChip({ outcome }: { outcome: Outcome }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 22,
        padding: '0 9px',
        borderRadius: 'var(--radius-full)',
        fontSize: 11.5,
        fontWeight: 600,
        border: '1px solid transparent',
        ...OUTCOME_STYLES[outcome],
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 'var(--radius-full)',
          flexShrink: 0,
          ...OUTCOME_DOT[outcome],
        }}
      />
      {OUTCOME_LABEL[outcome]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Count chip — used in the collapsed sweep row
// ---------------------------------------------------------------------------

type ChipVariant = 'ok' | 'stale' | 'fail' | 'unb';

const CHIP_STYLES: Record<ChipVariant, React.CSSProperties> = {
  ok:    { background: 'var(--success-soft)',    color: 'var(--success-ink)' },
  stale: { background: 'var(--stale-badge-bg)', color: 'var(--stale-badge-text)' },
  fail:  { background: 'var(--destructive-soft)', color: 'var(--destructive-ink)' },
  unb:   { background: 'var(--muted-soft)',       color: 'var(--muted-ink)' },
};

function CountChip({ label, variant }: { label: string; variant: ChipVariant }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 22,
        padding: '0 8px',
        borderRadius: 'var(--radius-sm)',
        fontSize: 11.5,
        fontWeight: 600,
        ...CHIP_STYLES[variant],
      }}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDuration(ms: number | null): string {
  if (ms === null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function fmtDatetime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

// Detail shows what the sweep ATTEMPTED — problems first, then successes.
// 'unbuilt' items are ambient state (never attempted), owned by the readiness
// matrix above; listing them per-sweep just repeats the same rows every hour.
const OUTCOME_ORDER: Outcome[] = ['stale_serving', 'failed', 'sealed'];

const GROUP_LABEL: Record<Outcome, string> = {
  stale_serving: 'Stale-serving — refresh failed, old cache still answering',
  failed:        'Failed — refresh failed and not serveable',
  unbuilt:       'Unbuilt — never sealed (cold)',
  sealed:        'Sealed',
};

/** Problem outcomes get a retry CTA (scoped rebuild of the item's game). */
const RETRYABLE: ReadonlySet<Outcome> = new Set(['stale_serving', 'failed']);

// ---------------------------------------------------------------------------
// Expanded detail panel
// ---------------------------------------------------------------------------

// Shared 4-column track: game · cube/rollup · outcome · detail.
const ITEM_GRID = '96px minmax(180px, 1.4fr) 124px 2fr';

function DetailPanel({ items, gameFilter, onRetry, retryDisabled }: {
  items: PreaggSweepItem[];
  gameFilter: string | null;
  /** Scoped rebuild of one game (the build trigger); absent ⇒ no CTA shown. */
  onRetry?: (game: string) => void;
  retryDisabled?: boolean;
}) {
  const visible = gameFilter ? items.filter((i) => i.game === gameFilter) : items;

  const grouped = OUTCOME_ORDER.reduce<Record<Outcome, PreaggSweepItem[]>>(
    (acc, o) => ({ ...acc, [o]: [] }),
    {} as Record<Outcome, PreaggSweepItem[]>,
  );
  for (const item of visible) {
    grouped[item.outcome as Outcome]?.push(item);
  }

  const nonEmpty = OUTCOME_ORDER.filter((o) => grouped[o].length > 0);

  if (visible.length === 0) {
    return (
      <div style={{ padding: '12px 16px', background: 'var(--bg-muted)', borderTop: '1px solid var(--border-card)', fontSize: 12, color: 'var(--text-muted)' }}>
        No rollups for <strong style={{ fontFamily: 'var(--font-mono)' }}>{gameFilter}</strong> in this sweep.
      </div>
    );
  }

  return (
    <div
      style={{
        padding: '6px 16px 16px',
        background: 'var(--bg-muted)',
        borderTop: '1px solid var(--border-card)',
      }}
    >
      {/* Column header */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: ITEM_GRID,
          gap: 12,
          padding: '6px 0 2px',
          fontSize: 10,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: 'var(--text-muted)',
        }}
      >
        <span>Game</span>
        <span>Cube · rollup</span>
        <span>Status</span>
        <span>Detail</span>
      </div>
      {nonEmpty.map((outcome) => (
        <div key={outcome}>
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              color: 'var(--text-muted)',
              margin: '10px 0 2px',
            }}
          >
            {outcome === 'sealed'
              ? `${GROUP_LABEL[outcome]} — ${grouped[outcome].length} rollups`
              : GROUP_LABEL[outcome]}
          </div>
          {grouped[outcome].map((item) => (
            <div
              key={item.id}
              style={{
                display: 'grid',
                gridTemplateColumns: ITEM_GRID,
                alignItems: 'center',
                gap: 12,
                padding: '8px 0',
                borderBottom: '1px dashed var(--neutral-200)',
              }}
            >
              {/* Game — its own column. The id maps to the cube-dev model folder
                  cubes/<game>/, so it's the handle for jumping to the YAML. */}
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--brand)',
                }}
              >
                {item.game ?? '—'}
              </span>

              {/* Cube + rollup */}
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-primary)' }}>
                  {item.cube ?? '—'}
                </div>
                {item.rollup && (
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
                    {item.rollup}
                  </div>
                )}
              </div>

              {/* Outcome chip */}
              <OutcomeChip outcome={item.outcome as Outcome} />

              {/* Error message or ok note, with a retry CTA on problem rows */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {item.errorMessage ? (
                  <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.45, flex: 1 }}>
                    <code
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10.5,
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border-card)',
                        padding: '1px 5px',
                        borderRadius: 4,
                        color: 'var(--text-muted)',
                      }}
                    >
                      {item.errorSig ?? 'error'}
                    </code>
                    {' '}
                    {item.errorMessage.length > 120
                      ? item.errorMessage.slice(0, 120) + '…'
                      : item.errorMessage}
                  </div>
                ) : item.outcome === 'sealed' ? (
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)', flex: 1, lineHeight: 1.5 }}>
                    {item.partitionsBuilt ? (
                      <>
                        <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
                          {item.partitionsBuilt} partition{item.partitionsBuilt === 1 ? '' : 's'}
                          {' '}in {fmtDuration(item.buildMs)}
                        </span>
                        {item.rollupsBuilt && item.rollupsBuilt.length > 0 && (
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, display: 'block' }}>
                            {item.rollupsBuilt.join(' · ')}
                          </span>
                        )}
                      </>
                    ) : (
                      // Sealed by probe but no build lines in the window — the
                      // refresh key matched, so the worker had nothing to write.
                      'up to date — no partitions rebuilt'
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)', flex: 1 }}>
                    no error captured
                  </div>
                )}
                {onRetry && item.game && RETRYABLE.has(item.outcome as Outcome) && (
                  <button
                    type="button"
                    disabled={retryDisabled}
                    onClick={() => onRetry(item.game as string)}
                    title={retryDisabled ? 'A build is already running' : `Rebuild ${item.game}'s pre-aggregations now`}
                    style={{
                      flexShrink: 0,
                      height: 22,
                      padding: '0 9px',
                      fontSize: 11,
                      fontWeight: 600,
                      fontFamily: 'var(--font-sans)',
                      color: 'var(--brand)',
                      background: 'var(--brand-soft)',
                      border: '1px solid var(--brand)',
                      borderRadius: 'var(--radius-sm)',
                      cursor: retryDisabled ? 'not-allowed' : 'pointer',
                      opacity: retryDisabled ? 0.5 : 1,
                    }}
                  >
                    Retry
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SweepRow — public export
// ---------------------------------------------------------------------------

export interface SweepRowProps {
  sweep: PreaggSweep;
  items: PreaggSweepItem[] | null; // null = not yet loaded
  expanded: boolean;
  onToggle: () => void;
  gameFilter: string | null; // null = all games
  /** Scoped rebuild of one game — shown as a Retry CTA on failed items. */
  onRetry?: (game: string) => void;
  retryDisabled?: boolean;
}

export function SweepRow({ sweep, items, expanded, onToggle, gameFilter, onRetry, retryDisabled }: SweepRowProps) {
  return (
    <div style={{ borderBottom: '1px solid var(--border-card)' }}>
      {/* Collapsed header row */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => e.key === 'Enter' && onToggle()}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '11px 16px',
          cursor: 'pointer',
        }}
      >
        {/* Caret */}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--text-muted)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            flexShrink: 0,
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s',
          }}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>

        {/* Timestamp */}
        <div style={{ width: 150, flexShrink: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
            {fmtTime(sweep.startedAt)}
            {sweep.source === 'probe-snapshot' && (
              <span
                title="State sample taken by the readiness probe — no worker sweep ran in this window"
                style={{
                  fontSize: 9.5,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  padding: '1px 6px',
                  borderRadius: 'var(--radius-full)',
                  background: 'var(--muted-soft)',
                  color: 'var(--muted-ink)',
                }}
              >
                probe
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {fmtDatetime(sweep.startedAt)} GMT+7
          </div>
        </div>

        {/* Duration + games */}
        <div style={{ width: 150, flexShrink: 0, fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
            {fmtDuration(sweep.durationMs)}
          </span>
          <br />
          {sweep.gamesCount} games · {sweep.rollupsTotal} rollups
        </div>

        {/* Count chips — only what this sweep ATTEMPTED. Unbuilt is ambient
            state (it shows in the readiness matrix), not run output. */}
        <div style={{ display: 'flex', gap: 7, flex: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          {sweep.sealedCount > 0 && (
            <CountChip label={`${sweep.sealedCount} sealed`} variant="ok" />
          )}
          {sweep.staleCount > 0 && (
            <CountChip label={`${sweep.staleCount} stale-serving`} variant="stale" />
          )}
          {sweep.failedCount > 0 && (
            <CountChip label={`${sweep.failedCount} failed`} variant="fail" />
          )}
          {sweep.sealedCount === 0 && sweep.staleCount === 0 && sweep.failedCount === 0 && (
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
              nothing to refresh — all partitions current
            </span>
          )}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && items && (
        <DetailPanel items={items} gameFilter={gameFilter} onRetry={onRetry} retryDisabled={retryDisabled} />
      )}
      {expanded && !items && (
        <div
          style={{
            padding: '12px 16px',
            background: 'var(--bg-muted)',
            borderTop: '1px solid var(--border-card)',
            fontSize: 12,
            color: 'var(--text-muted)',
          }}
        >
          Loading…
        </div>
      )}
    </div>
  );
}
