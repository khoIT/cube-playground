/**
 * Header chip showing the count of active CDP destinations for this segment.
 * Click → switches the detail view to the Activation tab.
 *
 * Coloring: muted when no activations, accent when active, destructive when
 * any activation has `status === 'failed'`.
 */

import { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, AlertTriangle } from 'lucide-react';
import type { Segment } from '../../../../types/segment-api';
import styles from '../../segments.module.css';

interface Props {
  segment: Segment;
  onJump: () => void;
}

export function ActivationChip({ segment, onJump }: Props): ReactElement | null {
  const { t } = useTranslation();
  const activations = segment.activations ?? [];
  if (activations.length === 0) return null;

  const failed = activations.filter((a) => a.status === 'failed').length;
  const tone: 'active' | 'failed' = failed > 0 ? 'failed' : 'active';

  const label = failed > 0
    ? t('segments.detail.activationChip.failed', {
        defaultValue: '{{failed}} of {{n}} activations failed',
        failed,
        n: activations.length,
      })
    : t('segments.detail.activationChip.active', {
        defaultValue: 'Active in {{n}} destination(s)',
        n: activations.length,
      });

  return (
    <button
      type="button"
      className={styles.activationChip}
      data-tone={tone}
      onClick={onJump}
      title={t('segments.detail.activationChip.title', {
        defaultValue: 'View activations',
      })}
    >
      {failed > 0 ? <AlertTriangle size={12} aria-hidden /> : <Send size={12} aria-hidden />}
      <span>{label}</span>
    </button>
  );
}
