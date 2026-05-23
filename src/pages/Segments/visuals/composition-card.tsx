import type { ReactElement } from 'react';
import { Donut } from './donut';
import { BarList } from './bar-list';
import styles from './visuals.module.css';

export interface CompositionSlice {
  label: string;
  value: number;
  color?: string;
}

export interface CompositionCardProps {
  title: string;
  /** Data for the donut ring on the left. */
  donutData: CompositionSlice[];
  /** Data for the horizontal bar list on the right / below. */
  barData: CompositionSlice[];
}

/**
 * Card combining a donut chart with a bar list — used for segment composition
 * breakdowns (platform, country, etc.).
 */
export function CompositionCard({ title, donutData, barData }: CompositionCardProps): ReactElement {
  return (
    <div className={styles.compositionCard}>
      {title && <h3 className={styles.compositionCardTitle}>{title}</h3>}
      <Donut data={donutData} size={120} legendPosition="right" />
      <BarList items={barData} />
    </div>
  );
}
