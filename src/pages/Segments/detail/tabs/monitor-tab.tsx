/**
 * Monitor tab — default landing for ALL segments. Stacks size-trend chart,
 * refresh history, and activation summary sections.
 */

import { ReactElement } from 'react';
import type { Segment } from '../../../../types/segment-api';
import { SizeTrendSection } from './monitor/size-trend-section';
import { RefreshHistorySection } from './monitor/refresh-history-section';
import { ActivationSummarySection } from './monitor/activation-summary-section';
import { CadenceControl } from './monitor/cadence-control';
import { SliceScopeNote } from '../../slice-scope/slice-scope-note';
import styles from '../../segments.module.css';

interface Props {
  segment: Segment;
  onActivate?: () => void;
  onJumpToActivation?: () => void;
  /** Propagates a cadence change up so the header health pill stays in sync. */
  onCadenceChange?: (next: Segment) => void;
}

export function MonitorTab({ segment, onActivate, onJumpToActivation, onCadenceChange }: Props): ReactElement {
  return (
    <div className={styles.monitorGrid}>
      <SliceScopeNote predicate={segment.predicate_tree} />
      <CadenceControl segment={segment} onCadenceChange={onCadenceChange} />
      <SizeTrendSection segment={segment} />
      <RefreshHistorySection segment={segment} />
      <ActivationSummarySection
        segment={segment}
        onActivate={onActivate}
        onJumpToTab={onJumpToActivation}
      />
    </div>
  );
}
