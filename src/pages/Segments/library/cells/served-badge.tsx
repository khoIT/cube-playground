/**
 * Violet "Served" lozenge shown wherever a served segment's name renders, so the
 * served/exploration distinction reads at a glance. A deprecated (force-demoted)
 * segment shows a muted "Retired" variant — readable, not silently identical to a
 * draft.
 */

import { ReactElement } from 'react';
import { Radio } from 'lucide-react';
import type { SegmentLifecycle } from '../../../../types/segment-api';
import styles from '../../segments.module.css';

interface Props {
  lifecycle: SegmentLifecycle | undefined;
}

export function ServedBadge({ lifecycle }: Props): ReactElement | null {
  if (lifecycle === 'served') {
    return (
      <span className={styles.servedBadge} title="Published as a downstream serving contract">
        <Radio size={11} aria-hidden />
        Served
      </span>
    );
  }
  if (lifecycle === 'deprecated') {
    return (
      <span className={styles.servedBadge} data-variant="retired" title="Demoted — no longer pullable downstream">
        Retired
      </span>
    );
  }
  return null;
}
