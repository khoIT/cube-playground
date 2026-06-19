/**
 * Fleet "Snapshot coverage" page — one row per predicate segment the caller may
 * read, showing its Track cadence, grains available, history depth, last
 * snapshot, and a mini coverage strip. The cross-segment answer to "which
 * grain/cadence is available for each segment". A single aggregate query on the
 * server powers every row (no N+1). Row click deep-links to that segment's
 * Monitor tab.
 */

import { ReactElement, useEffect, useMemo, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { BarChart3 } from 'lucide-react';
import {
  segmentMovementClient,
  type SnapshotCoverageResponse,
  type SnapshotCoverageRow,
  type MovementGranularity,
} from '../../../api/segment-movement-client';
import { CoverageMiniStrip } from './coverage-mini-strip';
import styles from '../segments.module.css';

type CaptureFilter = 'all' | 'subdaily' | 'none';
type SortKey = 'depth' | 'last';

const GRAIN_LABEL: Record<MovementGranularity, string> = {
  daily: 'D', '12h': '12h', '6h': '6h', '3h': '3h', '1h': '1h', '30m': '30m', '15m': '15m',
};

/** 'cfm_vn' → 'CFM · VN'. */
function gameLabel(gameId: string | null): string {
  if (!gameId) return '—';
  return gameId.split('_').map((p) => p.toUpperCase()).join(' · ');
}

const hasFineGrain = (r: SnapshotCoverageRow): boolean => r.grains.some((g) => g !== 'daily');

/** Inclusive day-gap between a snapshot day and the window's `to` date. */
function daysSince(lastTs: string | null, toDate: string): number | null {
  if (!lastTs) return null;
  const a = Date.parse(lastTs.slice(0, 10) + 'T00:00:00Z');
  const b = Date.parse(toDate + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

function lastLabel(lastTs: string | null, toDate: string): { text: string; cls: string } {
  const n = daysSince(lastTs, toDate);
  if (lastTs == null || n == null) return { text: '—', cls: styles.fleetLastNone };
  if (n <= 0) return { text: `today ${lastTs.slice(11, 16)}`, cls: styles.fleetLastRecent };
  if (n > 3) return { text: `${n}d ago ⚠`, cls: styles.fleetLastStale };
  return { text: `${n}d ago`, cls: styles.fleetLastOk };
}

export function SnapshotCoveragePage(): ReactElement {
  const history = useHistory();
  const [data, setData] = useState<SnapshotCoverageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<CaptureFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('depth');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    let cancelled = false;
    segmentMovementClient
      .snapshotCoverage()
      .then((res) => { if (!cancelled) setData(res); })
      .catch((err: Error) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, []);

  const rows = data?.rows ?? [];
  const toDate = data?.toDate ?? new Date().toISOString().slice(0, 10);

  const summary = useMemo(() => {
    const subDaily = rows.filter(hasFineGrain).length;
    const noCapture = rows.filter((r) => r.lastSnapshotTs == null).length;
    const stale = rows.filter((r) => {
      const n = daysSince(r.lastSnapshotTs, toDate);
      return n != null && n > 3;
    }).length;
    return { total: rows.length, subDaily, noCapture, stale };
  }, [rows, toDate]);

  const visible = useMemo(() => {
    const filtered = rows.filter((r) => {
      if (filter === 'subdaily') return hasFineGrain(r);
      if (filter === 'none') return r.lastSnapshotTs == null;
      return true;
    });
    const dir = sortDir === 'desc' ? -1 : 1;
    return [...filtered].sort((a, b) => {
      if (sortKey === 'depth') return (a.depthDays - b.depthDays) * dir;
      // 'last': null sorts last regardless of direction.
      if (a.lastSnapshotTs == null) return 1;
      if (b.lastSnapshotTs == null) return -1;
      return a.lastSnapshotTs.localeCompare(b.lastSnapshotTs) * dir;
    });
  }, [rows, filter, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else { setSortKey(key); setSortDir('desc'); }
  };
  const arrow = (key: SortKey) =>
    sortKey === key ? <span className={styles.fleetArr}>{sortDir === 'desc' ? '▼' : '▲'}</span> : null;

  return (
    <main className={styles.fleetPage}>
      <div className={styles.fleetEyebrow}>Segments</div>
      <div className={styles.fleetHead}>
        <span className={styles.fleetHeadIcon}><BarChart3 size={18} aria-hidden /></span>
        <div>
          <h1>Snapshot coverage</h1>
          <div className={styles.fleetMeta}>
            Fleet view of every segment's snapshot availability, cadence, and freshness
          </div>
        </div>
      </div>

      {error && <div className={styles.errorState}>{error}</div>}

      <div className={styles.summaryBand}>
        <div className={styles.summaryCard}>
          <span className={styles.summaryK}>Total segments</span>
          <span className={styles.summaryV}>{summary.total}</span>
          <span className={styles.summaryS}>predicate segments you can read</span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryK}>Capturing sub-daily</span>
          <span className={styles.summaryV}>{summary.subDaily}</span>
          <span className={styles.summaryS}>at least one finer-than-daily era</span>
        </div>
        <div className={`${styles.summaryCard} ${styles.summaryCardWarn}`}>
          <span className={styles.summaryK}>Stale or no snapshots</span>
          <span className={styles.summaryV}>{summary.stale + summary.noCapture}</span>
          <span className={styles.summaryS}>
            {summary.noCapture} no capture · {summary.stale} stale &gt; 3d
          </span>
        </div>
      </div>

      <div className={styles.fleetFilterRow}>
        <span className={styles.fleetFilterLabel}>Capture</span>
        <div className={styles.fleetPillGroup} role="group" aria-label="Filter by capture state">
          {(['all', 'subdaily', 'none'] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={filter === f ? styles.fleetPillOn : ''}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'All' : f === 'subdaily' ? 'Sub-daily' : 'None'}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.fleetTableCard}>
        <div className={styles.fleetTableWrap}>
          <table className={styles.fleetTable}>
            <thead>
              <tr>
                <th>Segment</th>
                <th>Game</th>
                <th>Track</th>
                <th>Grains available</th>
                <th className={styles.fleetSortable} onClick={() => toggleSort('depth')}>
                  History depth {arrow('depth')}
                </th>
                <th className={styles.fleetSortable} onClick={() => toggleSort('last')}>
                  Last snapshot {arrow('last')}
                </th>
                <th>Coverage</th>
              </tr>
            </thead>
            <tbody>
              {data == null && !error && (
                <tr><td colSpan={7} className={styles.fleetDim}>Loading…</td></tr>
              )}
              {data != null && visible.length === 0 && (
                <tr><td colSpan={7} className={styles.fleetDim}>No segments match this filter.</td></tr>
              )}
              {visible.map((r) => {
                const last = lastLabel(r.lastSnapshotTs, toDate);
                return (
                  <tr key={r.segmentId} onClick={() => history.push(`/segments/${r.segmentId}?tab=monitor`)}>
                    <td>
                      <span className={styles.fleetSegName}>
                        {r.name} <span className={styles.fleetGoArrow}>→</span>
                      </span>
                    </td>
                    <td className={styles.fleetDim}>{gameLabel(r.gameId)}</td>
                    <td>
                      <span className={`${styles.cadChip} ${r.trackCadence === 'Off' ? styles.cadChipOff : styles.cadChipCapture}`}>
                        {r.trackCadence}
                      </span>
                    </td>
                    <td>
                      {r.grains.length === 0 ? (
                        <span className={styles.fleetGrainNone}>—</span>
                      ) : (
                        <span className={styles.fleetGrains}>
                          {r.grains.map((g) => (
                            <span
                              key={g}
                              className={`${styles.fleetGrainMini} ${g === 'daily' ? styles.fleetGrainDaily : styles.fleetGrainFine}`}
                            >
                              {GRAIN_LABEL[g]}
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className={styles.fleetNum}>{r.depthDays > 0 ? `${r.depthDays}d` : <span className={styles.fleetDim}>—</span>}</td>
                    <td><span className={`${styles.fleetLast} ${last.cls}`}>{last.text}</span></td>
                    <td><CoverageMiniStrip eras={r.eras} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className={styles.fleetLegend}>
        <span className={styles.fleetLegendItem}>
          <span className={styles.fleetSwatch} style={{ background: 'var(--muted-ink)' }} /> Daily-captured era
        </span>
        <span className={styles.fleetLegendItem}>
          <span className={styles.fleetSwatch} style={{ background: 'var(--chart-2)' }} /> Sub-daily era (15m / 1h)
        </span>
        <span className={styles.fleetLegendItem}>
          <span className={styles.fleetSwatch} style={{ background: 'var(--brand)' }} /> cadence change
        </span>
        <span className={styles.fleetLegendItem}>
          <span
            className={styles.fleetSwatch}
            style={{ background: 'repeating-linear-gradient(45deg,var(--bg-muted),var(--bg-muted) 2px,var(--border-strong) 2px,var(--border-strong) 3px)' }}
          /> no capture
        </span>
      </div>
    </main>
  );
}

export default SnapshotCoveragePage;
