/**
 * One snapshot-run row in the Lakehouse snapshots table, expandable to its
 * per-segment breakdown (which segments landed, how many rows each, which were
 * skipped/errored and why). Wire types for the runs portion of
 * GET /api/segment-refresh/snapshot-runs live here with the row that renders
 * them; the section owns the fetch. Tokens only — no inline hex.
 */

import React, { useState } from 'react';
import { ChevronRight, RefreshCw } from 'lucide-react';

/** Reused spin for the live-run indicator — mirrors segment-refresh-row. */
const SPIN_KEYFRAMES = '@keyframes segsnapshot-spin{to{transform:rotate(360deg)}}';

export interface SnapshotRunError {
  segmentId: string;
  gameId: string | null;
  detail: string | null;
}

/** One segment's outcome within a run (server resolves name/owner; null = deleted). */
export interface SnapshotRunItem {
  segmentId: string;
  name: string | null;
  owner: string | null;
  gameId: string | null;
  rowCount: number | null;
  status: string; // 'written' | 'skipped' | 'error' | 'started'
  detail: string | null;
}

export interface SnapshotRun {
  snapshotDate: string;
  startedAt: string | null;
  written: number;
  skipped: number;
  errored: number;
  deltaStatus: string | null;
  deltaRows: number | null;
  definitionsStatus: string | null;
  definitionsRows: number | null;
  /** Run-level failure that aborted before any segment wrote (null = healthy). */
  runError: string | null;
  errors: SnapshotRunError[];
  items: SnapshotRunItem[];
}

const td: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: 12.5,
  color: 'var(--text-primary)',
  borderBottom: '1px solid var(--border-card)',
  verticalAlign: 'top',
};

const STATUS_INK: Record<string, string> = {
  written: 'var(--success-ink)',
  skipped: 'var(--muted-ink)',
  error: 'var(--destructive-ink)',
  started: 'var(--info-ink)',
};

/** Shared grid template so every breakdown row aligns into columns regardless
 *  of name/owner length: status | segment | game | owner | rows | detail. */
const breakdownGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '58px minmax(120px, 1.4fr) 82px minmax(120px, 1fr) 88px minmax(0, 1.2fr)',
  gap: 12,
  alignItems: 'baseline',
};

const ellipsis: React.CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

const breakdownHead: React.CSSProperties = {
  ...breakdownGrid,
  fontSize: 10,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--text-muted)',
  paddingBottom: 2,
};

function SegmentItemRow({ item }: { item: SnapshotRunItem }) {
  return (
    <div style={{ ...breakdownGrid, fontSize: 12 }}>
      <span style={{ color: STATUS_INK[item.status] ?? 'var(--text-muted)', fontWeight: 600 }}>{item.status}</span>
      <span style={{ ...ellipsis, color: 'var(--text-primary)', fontWeight: 600 }} title={item.segmentId}>
        {item.name ?? item.segmentId}
      </span>
      <span style={{ ...ellipsis, color: 'var(--text-muted)' }}>{item.gameId ?? '—'}</span>
      {/* Owner — the snapshot lands every owner's segments, so show whose it is. */}
      <span style={{ ...ellipsis, color: 'var(--text-muted)' }} title={item.owner ? `owner: ${item.owner}` : undefined}>
        {item.owner ?? '—'}
      </span>
      <span style={{ color: 'var(--text-secondary)', textAlign: 'right' }}>
        {item.rowCount != null ? item.rowCount.toLocaleString() : '—'}
      </span>
      <span style={{ ...ellipsis, color: 'var(--text-muted)' }} title={item.detail ?? undefined}>{item.detail ?? ''}</span>
    </div>
  );
}

export function SnapshotRunExpandableRow({ run, live = false }: { run: SnapshotRun; live?: boolean }) {
  // Auto-open the live run so segments stream into view as they land.
  const [open, setOpen] = useState(live);
  const expandable = run.items.length > 0;
  return (
    <React.Fragment>
      {live && <style>{SPIN_KEYFRAMES}</style>}
      <tr>
        <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap' }}>
          <button
            type="button"
            onClick={() => expandable && setOpen((v) => !v)}
            aria-label={open ? 'Collapse segment breakdown' : 'Expand segment breakdown'}
            disabled={!expandable}
            style={{
              border: 'none',
              background: 'transparent',
              cursor: expandable ? 'pointer' : 'default',
              padding: 0,
              marginRight: 6,
              verticalAlign: 'middle',
              color: expandable ? 'var(--text-muted)' : 'transparent',
            }}
          >
            <ChevronRight
              size={13}
              style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 120ms' }}
            />
          </button>
          {/* Live indicator — a run is in flight on this gateway; segments are
              still landing (mirrors the segment-refresh row spinner). */}
          {live && (
            <RefreshCw
              size={12}
              aria-label="snapshot in progress"
              style={{ color: 'var(--info-ink)', animation: 'segsnapshot-spin .9s linear infinite', transformOrigin: 'center', marginRight: 6, verticalAlign: 'middle' }}
            />
          )}
          {run.snapshotDate}
        </td>
        <td style={td}>{run.startedAt ?? '—'}</td>
        <td style={td}>{run.written}</td>
        <td style={td}>{run.skipped}</td>
        <td style={{ ...td, color: run.errored > 0 ? 'var(--destructive-ink)' : 'var(--text-primary)', fontWeight: run.errored > 0 ? 700 : 400 }}>
          {run.errored}
        </td>
        <td style={td}>
          {run.deltaStatus
            ? `${run.deltaStatus}${run.deltaRows != null ? ` · ${run.deltaRows.toLocaleString()} rows` : ''}`
            : '—'}
        </td>
        <td style={{ ...td, color: run.definitionsStatus === 'error' ? 'var(--destructive-ink)' : 'var(--text-primary)' }}>
          {run.definitionsStatus
            ? `${run.definitionsStatus}${run.definitionsRows != null ? ` · ${run.definitionsRows.toLocaleString()} rows` : ''}`
            : '—'}
        </td>
      </tr>
      {/* A run-level abort (lakehouse unreachable → schema/tables couldn't be
          ensured) writes no per-segment rows, so it must surface here or the
          run reads as a silent 0/0/0. Always visible — never behind a chevron. */}
      {run.runError && (
        <tr>
          <td colSpan={7} style={{ ...td, background: 'var(--destructive-soft)', color: 'var(--destructive-ink)', fontSize: 12, fontWeight: 600 }}>
            run failed: {run.runError}
          </td>
        </tr>
      )}
      {open && expandable && (
        <tr>
          <td colSpan={7} style={{ ...td, background: 'var(--bg-subtle, var(--muted-soft))', padding: '8px 12px 10px 43px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
              <div style={breakdownHead}>
                <span>Status</span>
                <span>Segment</span>
                <span>Game</span>
                <span>Owner</span>
                <span style={{ textAlign: 'right' }}>Rows</span>
                <span>Detail</span>
              </div>
              {run.items.map((item) => (
                <SegmentItemRow key={item.segmentId} item={item} />
              ))}
            </div>
          </td>
        </tr>
      )}
      {/* Errored segments stay visible WITHOUT expanding — failures must not
          hide behind a chevron. */}
      {run.errors.map((e) => (
        <tr key={`${run.snapshotDate}-${e.segmentId}`}>
          <td colSpan={7} style={{ ...td, background: 'var(--destructive-soft)', color: 'var(--destructive-ink)', fontSize: 12 }}>
            {e.segmentId}{e.gameId ? ` (${e.gameId})` : ''}: {e.detail ?? 'unknown error'}
          </td>
        </tr>
      ))}
    </React.Fragment>
  );
}
