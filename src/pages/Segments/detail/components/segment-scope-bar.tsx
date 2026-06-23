/**
 * Population-scope bar — lets the analyst zoom the whole detail page into the
 * paying sub-segment without mutating the segment definition. A segmented
 * control (Everyone / Paying) drives the `?scope=paying` URL param via
 * {@link useSegmentScope}; every KPI/Insights/Monitor card re-scopes through
 * useSegmentCubeQuery. The control previews both counts so the payer size is
 * visible before committing.
 *
 * Rendered only for cubes that model a lifetime-paying segment (gated by the
 * provider's `available`). The payer count is fetched live, OUTSIDE the active
 * sub-scope, so it always reads as the base-segment payer total.
 */

import { ReactElement, useMemo } from 'react';
import type { Query } from '@cubejs-client/core';
import type { Segment } from '../../../../types/segment-api';
import type { Preset } from '../../presets/types';
import { useSegmentScope } from '../segment-scope-context';
import { useSegmentCubeQuery } from '../use-segment-cube-query';
import { formatCompact } from '../cards/format-value';
import styles from './segment-scope-bar.module.css';

interface Props {
  segment: Segment;
  preset: Preset;
  /** Title-row inline placement: drop the row margin; the paying caveat shrinks
   *  to a tooltip on the Paying button so it never wraps the title row. */
  compact?: boolean;
}

export function SegmentScopeBar({ segment, preset, compact = false }: Props): ReactElement | null {
  const { scope, setScope, available } = useSegmentScope();
  const cube = preset.identityDim.split('.')[0];

  // Base-segment payer count (ignorePayingScope so it's stable regardless of the
  // active sub-scope). Drives the "Paying" chip count + the share-of-segment note.
  const payingQuery = useMemo<Query>(() => ({ measures: [`${cube}.paying_users`] }), [cube]);
  const { rows } = useSegmentCubeQuery<Record<string, number>>(
    segment,
    payingQuery,
    preset.identityDim,
    { ignorePayingScope: true },
  );

  if (!available) return null;

  const total = segment.uid_count;
  const payingRaw = rows[0]?.[`${cube}.paying_users`];
  const paying = typeof payingRaw === 'number' ? payingRaw : null;
  const pct = paying != null && total > 0 ? (paying / total) * 100 : null;
  const isPaying = scope === 'paying';

  const payingTip = pct != null
    ? `${pct.toFixed(1)}% of segment — non-destructive view, definition unchanged`
    : 'Non-destructive view, definition unchanged';

  return (
    <div
      className={[styles.scopeBar, compact ? styles.scopeBarCompact : ''].filter(Boolean).join(' ')}
      role="group"
      aria-label="Population scope"
    >
      <div className={styles.seg}>
        <button type="button" aria-pressed={!isPaying} onClick={() => setScope('all')}>
          Everyone <span className={styles.count}>{formatCompact(total)}</span>
        </button>
        <button
          type="button"
          aria-pressed={isPaying}
          onClick={() => setScope('paying')}
          title={compact ? payingTip : undefined}
        >
          Paying <span className={styles.count}>{paying != null ? formatCompact(paying) : '—'}</span>
        </button>
      </div>
      {/* Full caveat note only in the (legacy) stacked layout; compact folds it
          into the Paying button tooltip to keep the title row on one line. */}
      {isPaying && !compact && (
        <span className={styles.note}>
          {pct != null && <><b>{pct.toFixed(1)}%</b> of segment&nbsp;·&nbsp;</>}
          non-destructive view, definition unchanged
          <button type="button" className={styles.clear} onClick={() => setScope('all')}>Clear</button>
        </span>
      )}
      {isPaying && compact && (
        <button type="button" className={styles.clear} onClick={() => setScope('all')}>Clear</button>
      )}
    </div>
  );
}
