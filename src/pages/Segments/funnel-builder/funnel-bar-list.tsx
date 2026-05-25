/**
 * FunnelBarList — thin wrapper over <BarList> that adds drop-off % labels
 * between each bar row. Displays step counts on the right and drop-off
 * percentage annotations between consecutive steps.
 */

import type { ReactElement } from 'react';
import { BarList } from '../visuals/bar-list';
import type { FunnelStep } from './run-funnel';
import styles from './funnel-builder.module.css';

interface Props {
  steps: FunnelStep[];
}

/** Color ramp: step 0 = brand, later steps fade toward muted. */
const STEP_COLORS = [
  'var(--brand)',
  'var(--brand-secondary, #6366f1)',
  'var(--chart-2, #8b5cf6)',
  'var(--chart-3, #a78bfa)',
  'var(--chart-4, #c4b5fd)',
  'var(--chart-5, #ddd6fe)',
];

export function FunnelBarList({ steps }: Props): ReactElement {
  const maxCount = steps[0]?.count ?? 1;

  return (
    <div className={styles.funnelBarList}>
      {steps.map((step, idx) => (
        <div key={idx} className={styles.funnelBarStep}>
          {/* Step number badge */}
          <div className={styles.funnelStepHeader}>
            <span className={styles.funnelStepNum}>Step {idx + 1}</span>
          </div>

          {/* Bar row */}
          <BarList
            items={[{ label: step.name, value: step.count, color: STEP_COLORS[idx] }]}
            max={maxCount}
          />

          {/* Drop-off annotation between this step and the next */}
          {idx < steps.length - 1 && (
            <div className={styles.funnelDropOff} aria-label={`Drop-off after step ${idx + 1}`}>
              <span className={styles.funnelDropOffArrow} aria-hidden>↓</span>
              <span className={styles.funnelDropOffPct}>
                {steps[idx + 1].dropPct.toFixed(1)}% drop-off
              </span>
              <span className={styles.funnelDropOffAbs}>
                (−{steps[idx + 1].dropFromPrev.toLocaleString('en-US')} users)
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
