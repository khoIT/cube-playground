/**
 * Destinations cell: chips rendered from segment.activations[].
 * Phase 4 ships the data model; until activations[] is wired we tolerate
 * missing field and render the empty-state '—'. Max 2 chips visible,
 * overflow → "+N more".
 */

import { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import type { Segment } from '../../../../types/segment-api';
import styles from '../../segments.module.css';

interface ActivationLike {
  id?: string;
  destination?: string;
  env?: string;
  status?: 'active' | 'failed' | 'pending';
}

interface Props {
  segment: Segment;
}

const MAX_VISIBLE = 2;

export function DestinationsCell({ segment }: Props): ReactElement {
  const { t } = useTranslation();
  // Activations[] is added in Phase 4 — until then it's undefined.
  const activations = (segment as unknown as { activations?: ActivationLike[] }).activations ?? [];

  if (activations.length === 0) {
    return <span className={styles.cellEmpty}>—</span>;
  }

  const visible = activations.slice(0, MAX_VISIBLE);
  const overflow = activations.length - visible.length;

  return (
    <div className={styles.destChips}>
      {visible.map((a, i) => {
        const tone =
          a.status === 'failed' ? 'destructive' : a.status === 'pending' ? 'muted' : 'success';
        return (
          <span key={a.id ?? i} className={styles.destChip} data-tone={tone}>
            <ArrowRight size={10} aria-hidden />
            {(a.destination ?? 'cdp').toUpperCase()}
            {a.env ? ` · ${a.env}` : ''}
          </span>
        );
      })}
      {overflow > 0 && (
        <span className={styles.destChipOverflow}>
          {t('segments.library.usedIn.overflow', { defaultValue: '+{{n}} more', n: overflow })}
        </span>
      )}
    </div>
  );
}
