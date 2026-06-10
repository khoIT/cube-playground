/**
 * SweepProgressBanner — the live banner shown while a sweep this mount didn't
 * start is running (a manual sweep navigated away from, the 6h cron, or another
 * tab). Collapsed it reads like before — source + elapsed + an N/M done counter.
 * Expanded it opens a dashboard-style breakdown: a stat strip (done/total + the
 * running opened/lapsed totals) over a completion bar, then the playbooks grouped
 * into Sweeping → Queued → Done cards so active work floats to the top.
 *
 * Progress arrives from the polled /sweep/status endpoint (2s cadence while in
 * flight), so the breakdown updates live without any extra request here. Sweeps
 * run with bounded concurrency server-side, so more than one row can read
 * "sweeping…" at once (its icon spins). Tokens only.
 */

import { useState } from 'react';
import { RefreshCw, ChevronDown, ChevronRight, Check, Loader, Minus } from 'lucide-react';
import type { PlaybookSweepProgress } from './use-care-cases';

interface SweepProgressBannerProps {
  source: 'manual' | 'cron' | null;
  startedAt: string | null;
  elapsedS: number;
  progress: PlaybookSweepProgress[];
}

// Human labels for the skip reasons the sweep emits, so a skipped row explains
// itself ("skipped · not available for this game") rather than leaking a slug.
const SKIP_LABEL: Record<string, string> = {
  unavailable: 'not available for this game',
  disabled: 'disabled',
  'trigger-eval-pending': 'trigger eval pending',
  'no-predicate': 'no usable condition',
  'query-failed': 'cohort query failed',
};

// Grouping order — active work first, finished last.
const GROUPS: { state: PlaybookSweepProgress['state']; title: string }[] = [
  { state: 'running', title: 'Sweeping' },
  { state: 'pending', title: 'Queued' },
  { state: 'done', title: 'Done' },
];

const SPIN_KEYFRAMES = '@keyframes cs-sweep-spin{to{transform:rotate(360deg)}}';

/** State dot/icon + a one-line status string for a single playbook row. */
function PlaybookProgressRow({ row, accent }: { row: PlaybookSweepProgress; accent: boolean }) {
  let icon = <Minus size={12} style={{ color: 'var(--text-muted)' }} />;
  let status = 'queued';
  let statusColor = 'var(--text-muted)';

  if (row.state === 'running') {
    icon = (
      <Loader
        size={12}
        style={{ color: 'var(--brand)', animation: 'cs-sweep-spin .9s linear infinite', transformOrigin: 'center' }}
      />
    );
    status = 'sweeping…';
    statusColor = 'var(--brand-hover)';
  } else if (row.state === 'done') {
    if (row.skipped) {
      status = `skipped · ${SKIP_LABEL[row.skipped] ?? row.skipped}`;
    } else {
      icon = <Check size={12} style={{ color: 'var(--success-ink)' }} />;
      const opened = row.opened ?? 0;
      const lapsed = row.lapsed ?? 0;
      status =
        opened === 0 && lapsed === 0
          ? `no change · ${row.cohortSize ?? 0} in cohort`
          : `opened ${opened} · lapsed ${lapsed}`;
      statusColor = 'var(--success-ink)';
    }
  }

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px', minWidth: 0,
        ...(accent ? { background: 'var(--brand-soft)', boxShadow: 'inset 2px 0 0 var(--brand)' } : null),
      }}
    >
      <span style={{ flexShrink: 0, display: 'grid', placeItems: 'center', width: 14 }}>{icon}</span>
      <span
        title={row.label}
        style={{
          flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)',
        }}
      >
        {row.label}
      </span>
      <span style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: statusColor }}>
        {status}
      </span>
    </div>
  );
}

/** One labelled group card (Sweeping / Queued / Done) holding its rows. */
function GroupCard({ title, rows }: { title: string; rows: PlaybookSweepProgress[] }) {
  if (rows.length === 0) return null;
  const accent = title === 'Sweeping';
  return (
    <div style={{ margin: '6px 8px', border: '1px solid var(--border-card)', borderRadius: 6, overflow: 'hidden' }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 7, padding: '6px 10px', background: 'var(--bg-muted)',
          fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-muted)',
        }}
      >
        {title}
        <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{rows.length}</span>
      </div>
      {rows.map((row) => (
        <PlaybookProgressRow key={row.playbookId} row={row} accent={accent} />
      ))}
    </div>
  );
}

export function SweepProgressBanner({ source, startedAt, elapsedS, progress }: SweepProgressBannerProps) {
  const [expanded, setExpanded] = useState(false);
  const hasProgress = progress.length > 0;

  const doneCount = progress.filter((p) => p.state === 'done').length;
  const openedTotal = progress.reduce((n, p) => n + (p.opened ?? 0), 0);
  const lapsedTotal = progress.reduce((n, p) => n + (p.lapsed ?? 0), 0);
  const pct = hasProgress ? Math.round((doneCount / progress.length) * 100) : 0;

  const sourceLabel = source === 'cron' ? ' (auto-sweep)' : source === 'manual' ? ' (manual)' : '';

  return (
    <div
      style={{
        margin: '0 0 12px', fontFamily: 'var(--font-sans)',
        color: 'var(--warning-ink)', background: 'var(--warning-soft)',
        border: '1px solid var(--border-card)', borderRadius: 'var(--radius-md)', overflow: 'hidden',
      }}
    >
      <style>{SPIN_KEYFRAMES}</style>

      {/* Header — clickable to expand when there's a breakdown to show. */}
      <button
        type="button"
        onClick={hasProgress ? () => setExpanded((v) => !v) : undefined}
        aria-expanded={hasProgress ? expanded : undefined}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-sans)',
          color: 'var(--warning-ink)', background: 'transparent', border: 'none',
          padding: '8px 12px', textAlign: 'left', cursor: hasProgress ? 'pointer' : 'default',
        }}
      >
        <RefreshCw size={13} style={{ flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0 }}>
          Sweep in progress{sourceLabel}
          {startedAt ? ` — ${elapsedS}s elapsed` : ''}. Results refresh when it finishes.
        </span>
        {hasProgress && (
          <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, fontVariantNumeric: 'tabular-nums' }}>
            {doneCount}/{progress.length} done
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        )}
      </button>

      {hasProgress && expanded && (
        <>
          {/* Stat strip — big done/total + the running opened/lapsed totals. */}
          <div
            style={{
              display: 'flex', alignItems: 'baseline', gap: 14, padding: '10px 12px 8px',
              background: 'var(--bg-card)', borderTop: '1px solid var(--border-card)',
            }}
          >
            <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>
              {doneCount}
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>/{progress.length}</span>
            </span>
            <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>done</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--success-ink)', fontVariantNumeric: 'tabular-nums' }}>{openedTotal} opened</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>·</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{lapsedTotal} lapsed</span>
          </div>

          {/* Completion bar. */}
          <div style={{ height: 3, background: 'var(--track, var(--border-card))' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: 'var(--brand)', borderRadius: '0 2px 2px 0', transition: 'width .3s ease' }} />
          </div>

          {/* Grouped cards — active work first. */}
          <div style={{ background: 'var(--bg-card)', padding: '0 0 6px' }}>
            {GROUPS.map((g) => (
              <GroupCard key={g.state} title={g.title} rows={progress.filter((p) => p.state === g.state)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
