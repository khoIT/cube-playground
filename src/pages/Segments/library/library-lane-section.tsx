/**
 * One lane in the segments library: a labelled group header (title + one-line
 * purpose + count) followed by its rows. Used twice — "Served downstream" (the
 * small, high-stakes published-contract lane) above "Exploration" (scratch
 * analysis) — to make the served/exploration split read at a glance.
 *
 * One reusable section (vs two near-identical lane files) keeps the markup DRY;
 * the `served` flag only tints the title with the segment-member accent.
 */

import { ReactElement, ReactNode } from 'react';
import styles from '../segments.module.css';

interface Props {
  title: string;
  subtitle: string;
  count: number;
  served?: boolean;
  /** Shown when the lane has no rows (instead of a blank gap). */
  emptyHint?: string;
  children: ReactNode;
}

export function LibraryLaneSection({ title, subtitle, count, served, emptyHint, children }: Props): ReactElement {
  return (
    <section>
      <div className={styles.laneHeader}>
        <span className={[styles.laneTitle, served ? styles.laneTitleServed : ''].filter(Boolean).join(' ')}>
          {title}
        </span>
        <span className={styles.laneSubtitle}>{subtitle}</span>
        <span className={styles.laneCount}>{count}</span>
      </div>
      {count === 0 && emptyHint ? <div className={styles.laneEmpty}>{emptyHint}</div> : children}
    </section>
  );
}
