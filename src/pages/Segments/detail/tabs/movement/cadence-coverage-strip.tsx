/**
 * Capture-coverage strip for the Movement tab.
 *
 * A slim band sitting under the View toggle, painted by which cadence was
 * actually captured across each span of the window (from the read API's
 * `captureEras`). It answers "where in the window does each grain live?" —
 * fine grain may exist only for the recent days while the rest is daily-only,
 * so a single window-wide enabled/greyed flag would lie. Daily spans render in
 * the muted/coarse tone; any finer-than-daily era renders in the fine tone,
 * with a brand divider + date tick at each cadence change.
 *
 * Display-only: selection lives in the GranularityToggle. Renders nothing when
 * there is no capture timeline yet (older segments / first paint).
 */

import { ReactElement, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { CaptureEra, MovementGranularity } from '../../../../../api/segment-movement-client';
import styles from '../../../segments.module.css';

const CADENCE_LABEL: Record<MovementGranularity, string> = {
  daily: 'Daily',
  '12h': '12h',
  '6h': '6h',
  '3h': '3h',
  '1h': '1h',
  '30m': '30m',
  '15m': '15m',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM-DD ...' → 'Mon D' (no locale/timezone surprises). */
function shortDate(ts: string): string {
  const m = parseInt(ts.slice(5, 7), 10);
  const d = parseInt(ts.slice(8, 10), 10);
  if (!Number.isFinite(m) || !Number.isFinite(d) || m < 1 || m > 12) return ts.slice(0, 10);
  return `${MONTHS[m - 1]} ${d}`;
}

/** Inclusive day-count between two snapshot_ts strings (date portion only). */
function dayCount(from: string, to: string): number {
  const a = Date.parse(from.slice(0, 10) + 'T00:00:00Z');
  const b = Date.parse(to.slice(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 1;
  return Math.round((b - a) / 86_400_000) + 1;
}

interface Props {
  eras: CaptureEra[] | undefined;
  /** Finest grain captured anywhere — drives the legend's fine-tone label. */
  finest?: MovementGranularity;
}

export function CadenceCoverageStrip({ eras, finest }: Props): ReactElement | null {
  // Auto-collapsed: coverage is reassurance most visits don't need open, so it
  // starts as a one-line summary the user can expand on demand.
  const [open, setOpen] = useState(false);

  if (!eras || eras.length === 0) return null;

  const total = eras.reduce((sum, e) => sum + dayCount(e.from, e.to), 0) || 1;
  const spanLabel = `${shortDate(eras[0].from)} – ${shortDate(eras[eras.length - 1].to)}`;
  const hasFine = eras.some((e) => e.cadence !== 'daily');
  const hasChange = eras.length > 1;
  const collapsedSummary = eras.length === 1
    ? `${CADENCE_LABEL[eras[0].cadence]} · ${total}d`
    : `${eras.length} cadences · ${total}d`;

  return (
    <div className={styles.coverWrap} aria-label="Capture coverage timeline">
      <button
        type="button"
        className={`${styles.coverHead} ${styles.coverHeadBtn}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
        <span className={styles.coverLbl}>Capture coverage</span>
        <span className={styles.coverSub}>
          {open ? `what cadence was actually captured across ${spanLabel}` : `${spanLabel} · ${collapsedSummary}`}
        </span>
      </button>

      {open && (
      <>
      <div className={styles.coverStrip}>
        {eras.map((era, i) => {
          const days = dayCount(era.from, era.to);
          const pct = (days / total) * 100;
          const isFine = era.cadence !== 'daily';
          const changed = i > 0 && eras[i - 1].cadence !== era.cadence;
          const cap = `${CADENCE_LABEL[era.cadence]} capture · ${shortDate(era.from)}–${shortDate(era.to)} (${days}d)`;
          return (
            <span key={`${era.from}-${i}`} style={{ display: 'contents' }}>
              {changed && <span className={styles.coverMark} title={`Cadence change · ${shortDate(era.from)}`} />}
              <span
                className={`${styles.coverSeg} ${isFine ? styles.coverSegFine : styles.coverSegCoarse}`}
                style={{ flex: `0 0 ${pct}%` }}
                title={cap}
              >
                {pct >= 8 ? `${CADENCE_LABEL[era.cadence].toUpperCase()} · ${days}d` : ''}
              </span>
            </span>
          );
        })}
      </div>

      <div className={styles.coverTicks}>
        {eras.map((era, i) => {
          const days = dayCount(era.from, era.to);
          const pct = (days / total) * 100;
          const changed = i > 0 && eras[i - 1].cadence !== era.cadence;
          return (
            <span
              key={`tick-${era.from}-${i}`}
              className={`${styles.coverTick} ${changed ? styles.coverTickMark : ''}`}
              style={{ flex: `0 0 ${pct}%` }}
            >
              {shortDate(era.from)}
              {changed ? ` · ${CADENCE_LABEL[era.cadence]} on` : ''}
            </span>
          );
        })}
      </div>

      <div className={styles.coverLegend}>
        <span className={styles.coverItem}>
          <span className={styles.coverSwatch} style={{ background: 'var(--muted-ink)' }} />
          Daily-captured (finer views carry-forward as flat)
        </span>
        {hasFine && (
          <span className={styles.coverItem}>
            <span className={styles.coverSwatch} style={{ background: 'var(--chart-2, #3f8dff)' }} />
            {CADENCE_LABEL[finest ?? '15m']}-captured (full intraday detail)
          </span>
        )}
        {hasChange && (
          <span className={styles.coverItem} style={{ marginLeft: 'auto' }}>
            <span style={{ color: 'var(--brand)', fontWeight: 700 }}>▾</span> cadence change
          </span>
        )}
      </div>
      </>
      )}
    </div>
  );
}
