/**
 * Monitor tab — default landing for ALL segments. Stacks size-trend chart,
 * refresh history, and activation summary sections.
 */

import { ReactElement } from 'react';
import type { Segment } from '../../../../types/segment-api';
import { SizeTrendSection } from './monitor/size-trend-section';
import { RefreshHistorySection } from './monitor/refresh-history-section';
import { ActivationSummarySection } from './monitor/activation-summary-section';
import styles from '../../segments.module.css';

interface Props {
  segment: Segment;
  onActivate?: () => void;
  onJumpToActivation?: () => void;
}

export function MonitorTab({ segment, onActivate, onJumpToActivation }: Props): ReactElement {
  return (
    <div className={styles.monitorGrid}>
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
