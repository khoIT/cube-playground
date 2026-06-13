/**
 * One snapshot-run row in the Lakehouse snapshots table, expandable to its
 * per-segment breakdown (which segments landed, how many rows each, which were
 * skipped/errored and why). Wire types for the runs portion of
 * GET /api/segment-refresh/snapshot-runs live here with the row that renders
 * them; the section owns the fetch. Tokens only — no inline hex.
 */

import React, { useState } from 'react';
import { ChevronRight } from 'lucide-react';

export interface SnapshotRunError {
  segmentId: string;
  gameId: string | null;
  detail: string | null;
}

/** One segment's outcome within a run (server resolves name; null = deleted). */
export interface SnapshotRunItem {
  segmentId: string;
  name: string | null;
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

function SegmentItemLine({ item }: { item: SnapshotRunItem }) {
  return (
    <li style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12, minWidth: 0 }}>
      <span style={{ color: STATUS_INK[item.status] ?? 'var(--text-muted)', fontWeight: 600, minWidth: 52, flexShrink: 0 }}>
        {item.status}
      </span>
      <span
        style={{ color: 'var(--text-primary)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        title={item.segmentId}
      >
        {item.name ?? item.segmentId}
      </span>
      {item.gameId && <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{item.gameId}</span>}
      {item.rowCount != null && (
        <span style={{ color: 'var(--text-secondary)', flexShrink: 0 }}>{item.rowCount.toLocaleString()} rows</span>
      )}
      {item.detail && <span style={{ color: 'var(--text-muted)' }}>— {item.detail}</span>}
    </li>
  );
}

export function SnapshotRunExpandableRow({ run }: { run: SnapshotRun }) {
  const [open, setOpen] = useState(false);
  const expandable = run.items.length > 0;
  return (
    <React.Fragment>
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
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 3 }}>
              {run.items.map((item) => (
                <SegmentItemLine key={item.segmentId} item={item} />
              ))}
            </ul>
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
