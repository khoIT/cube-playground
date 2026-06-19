/**
 * Per-segment snapshot ledger — the collapsible "all historic snapshots" table
 * that sits under the coverage strip in the merged Monitor tab. One row per
 * captured snapshot (newest first), grouped by day: time (GMT+7), grain chip,
 * cohort size, # KPIs captured. The grain chip uses the SAME era-classification
 * the coverage strip uses (server-side computeCaptureEras → dayGrainMap), so a
 * day is labelled identically on both — the ledger reads its own window, so the
 * two can differ only at the window edges, never in the per-day grain logic.
 *
 * Counts only — no member identities. Collapsed by default. Row click is a
 * stub link-out (a frozen-snapshot detail view is a separate, later surface).
 */

import { ReactElement, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  segmentMovementClient,
  type SnapshotLedgerRow,
  type MovementGranularity,
} from '../../../../../api/segment-movement-client';
import { useCollapsiblePref } from '../../cards/use-collapsible-pref';
import styles from '../../../segments.module.css';

interface Props {
  segmentId: string;
}

const GRAIN_LABEL: Record<MovementGranularity, string> = {
  daily: 'Daily',
  '12h': '12h',
  '6h': '6h',
  '3h': '3h',
  '1h': '1h',
  '30m': '30m',
  '15m': '15m',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM-DD …' → 'Mon D' (no timezone surprises — string slice only). */
function dayLabel(ts: string): string {
  const m = parseInt(ts.slice(5, 7), 10);
  const d = parseInt(ts.slice(8, 10), 10);
  if (!Number.isFinite(m) || m < 1 || m > 12) return ts.slice(0, 10);
  return `${MONTHS[m - 1]} ${d}`;
}

/** 'YYYY-MM-DD HH:MM:SS' → 'HH:MM'. */
function timeLabel(ts: string): string {
  return ts.slice(11, 16) || '00:00';
}

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export function SnapshotLedgerSection({ segmentId }: Props): ReactElement | null {
  const [rows, setRows] = useState<SnapshotLedgerRow[] | null>(null);
  const [collapsed, toggleCollapsed] = useCollapsiblePref(`monitor:snapshot-ledger:${segmentId}`);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    segmentMovementClient
      .snapshotLedger(segmentId)
      .then((res) => {
        if (!cancelled) setRows(res.rows);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [segmentId]);

  // Group consecutive rows (already newest-first) by calendar day for sub-heads.
  const groups: Array<{ day: string; rows: SnapshotLedgerRow[] }> = [];
  for (const r of rows ?? []) {
    const day = r.ts.slice(0, 10);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.rows.push(r);
    else groups.push({ day, rows: [r] });
  }

  return (
    <section className={styles.monitorSection}>
      <header className={styles.monitorSectionHead}>
        <button
          type="button"
          className={styles.cardCollapseBtn}
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronRight size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
          <h3>Snapshot history</h3>
        </button>
        {rows != null && rows.length > 0 && (
          <span className={styles.ledgerCount}>{rows.length} captured</span>
        )}
      </header>

      {collapsed ? null : rows == null ? (
        <div className={styles.monitorEmpty}>Loading snapshots…</div>
      ) : rows.length === 0 ? (
        <div className={styles.monitorEmpty}>No snapshots captured yet for this window.</div>
      ) : (
        <div className={styles.ledgerTable}>
          <div className={styles.ledgerHead}>
            <span>Time</span>
            <span>Grain</span>
            <span>Members</span>
            <span>KPIs</span>
          </div>
          {groups.map((g) => (
            <div key={g.day}>
              <div className={styles.ledgerDay}>{dayLabel(g.day)}</div>
              {g.rows.map((r) => (
                <div key={r.ts} className={styles.ledgerRow} title="Snapshot detail coming soon">
                  <span className={styles.ledgerTime}>{timeLabel(r.ts)}</span>
                  <span>
                    <span
                      className={`${styles.ledgerGrain} ${r.grain === 'daily' ? styles.ledgerGrainDaily : styles.ledgerGrainFine}`}
                    >
                      {GRAIN_LABEL[r.grain]}
                    </span>
                  </span>
                  <span className={styles.ledgerNum}>{formatCount(r.memberCount)}</span>
                  <span className={styles.ledgerNum}>{r.kpiCount}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
