/**
 * Tiny coverage strip for one fleet row — a miniature of the per-segment
 * cadence-coverage spine. Paints each capture era proportional to its day span
 * (daily = muted, sub-daily = fine/blue), with a brand mark at each cadence
 * change. Renders a single hatched "no capture" bar when the segment has no
 * eras (no game / never captured).
 */

import { ReactElement } from 'react';
import type { CaptureEra } from '../../../api/segment-movement-client';
import styles from '../segments.module.css';

interface Props {
  eras: CaptureEra[];
}

/** Inclusive day-count between two 'YYYY-MM-DD…' strings. */
function dayCount(from: string, to: string): number {
  const a = Date.parse(from.slice(0, 10) + 'T00:00:00Z');
  const b = Date.parse(to.slice(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 1;
  return Math.round((b - a) / 86_400_000) + 1;
}

export function CoverageMiniStrip({ eras }: Props): ReactElement {
  if (!eras || eras.length === 0) {
    return (
      <div className={styles.miniStrip} aria-label="No capture">
        <span className={`${styles.miniSeg} ${styles.miniSegEmpty}`} style={{ flex: 1 }} />
      </div>
    );
  }

  const total = eras.reduce((sum, e) => sum + dayCount(e.from, e.to), 0) || 1;

  return (
    <div className={styles.miniStrip} aria-label="Capture coverage">
      {eras.map((era, i) => {
        const pct = (dayCount(era.from, era.to) / total) * 100;
        const fine = era.cadence !== 'daily';
        const changed = i > 0 && eras[i - 1].cadence !== era.cadence;
        return (
          <span key={`${era.from}-${i}`} style={{ display: 'contents' }}>
            {changed && <span className={styles.miniMark} />}
            <span
              className={`${styles.miniSeg} ${fine ? styles.miniSegFine : styles.miniSegDaily}`}
              style={{ flex: `0 0 ${pct}%` }}
            />
          </span>
        );
      })}
    </div>
  );
}
