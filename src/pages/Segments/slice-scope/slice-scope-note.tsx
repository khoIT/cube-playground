/**
 * Informs the user that segment metrics are scoped to the slice the segment was
 * created from (its predicate) — so a measure like revenue reflects that slice,
 * not each member's full history. Renders nothing when there's no slice
 * (manual segments, or predicates with no filters).
 */

import { ReactElement } from 'react';
import { Info } from 'lucide-react';
import type { PredicateNode } from '../../../types/segment-api';
import { describePredicate } from './describe-predicate';
import styles from '../segments.module.css';

interface Props {
  predicate: PredicateNode | null;
  /** Wording differs slightly between an existing segment and the create flow. */
  variant?: 'monitor' | 'create';
}

export function SliceScopeNote({ predicate, variant = 'monitor' }: Props): ReactElement | null {
  const chips = describePredicate(predicate);
  if (chips.length === 0) return null;

  const lead =
    variant === 'create'
      ? 'Monitor metrics will be scoped to this slice — values like revenue reflect the slice below, not each member’s full history.'
      : 'Metrics below are scoped to this slice — values like revenue reflect the slice, not each member’s full history.';

  return (
    <div className={styles.sliceScopeBanner} role="note">
      <Info size={16} className={styles.sliceScopeIcon} aria-hidden />
      <div className={styles.sliceScopeBody}>
        <span>{lead}</span>
        <div className={styles.sliceScopeChips}>
          {chips.map((c, i) => (
            <span key={i} className={styles.sliceScopeChip}>{c}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
