/**
 * Activation tab — renders per-activation cards from `segment.activations[]`.
 * Phase 4 ships the shell + empty state + read-only list. Phase 7 wires the
 * `+ Activate to CDP` CTA into the push-modal Activate tab.
 */

import { ReactElement, useState } from 'react';
import { Button, Modal } from 'antd';
import { ArrowRight, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNowStrict } from 'date-fns';
import type { Activation, Segment } from '../../../../types/segment-api';
import styles from '../../segments.module.css';

interface Props {
  segment: Segment;
  onActivate?: () => void;
  /**
   * Removes an activation from the segment. Called with the activation id;
   * implementations should invoke the segments-client DELETE endpoint and
   * propagate the updated segment back up. Confirm UX is handled inside this
   * tab — the parent just performs the network call.
   */
  onDeactivate?: (activationId: string) => Promise<void> | void;
}

function formatWhen(value: string | null): string {
  if (!value) return '—';
  try {
    return formatDistanceToNowStrict(new Date(value), { addSuffix: true });
  } catch {
    return '—';
  }
}

function statusTone(s: Activation['status']): 'success' | 'destructive' | 'muted' {
  if (s === 'active') return 'success';
  if (s === 'failed') return 'destructive';
  return 'muted';
}

export function ActivationTab({ segment, onActivate, onDeactivate }: Props): ReactElement {
  const { t } = useTranslation();
  const activations = segment.activations ?? [];
  const [pendingId, setPendingId] = useState<string | null>(null);

  function confirmDeactivate(a: Activation) {
    if (!onDeactivate) return;
    Modal.confirm({
      title: t('segments.detail.activation.deactivateTitle', {
        defaultValue: 'Deactivate this destination?',
      }),
      content: t('segments.detail.activation.deactivateBody', {
        defaultValue: 'This removes {{metric}} from {{dest}} · {{env}}. It does not delete the segment.',
        metric: a.metric_name,
        dest: a.destination.toUpperCase(),
        env: a.env,
      }),
      okText: t('segments.detail.activation.deactivateOk', { defaultValue: 'Deactivate' }),
      okType: 'danger',
      cancelText: t('common.cancel', { defaultValue: 'Cancel' }),
      onOk: async () => {
        setPendingId(a.id);
        try {
          await onDeactivate(a.id);
        } finally {
          setPendingId(null);
        }
      },
    });
  }

  return (
    <section className={styles.activationTab}>
      <header className={styles.activationTabHeader}>
        <div>
          <h2 className={styles.activationTabTitle}>
            {t('segments.detail.activation.title', { defaultValue: 'Activation' })}
          </h2>
          <p className={styles.activationTabDesc}>
            {t('segments.detail.activation.description', {
              defaultValue: 'Push this segment to downstream tools as a CDP metric.',
            })}
          </p>
        </div>
        <Button
          type="primary"
          onClick={onActivate}
          disabled={!onActivate}
        >
          {t('segments.detail.activation.cta', { defaultValue: '+ Activate to CDP' })}
        </Button>
      </header>

      {activations.length === 0 ? (
        <div className={styles.activationEmpty}>
          <p>
            {t('segments.detail.activation.empty', {
              defaultValue: 'No activations yet. Activate this segment to make it available in CDP.',
            })}
          </p>
        </div>
      ) : (
        <div className={styles.activationList}>
          {activations.map((a) => (
            <article key={a.id} className={styles.activationCard} data-tone={statusTone(a.status)}>
              <div className={styles.activationCardHead}>
                <span className={styles.activationDest}>
                  <ArrowRight size={12} aria-hidden /> {a.destination.toUpperCase()} · {a.env}
                </span>
                <span className={styles.activationStatus} data-tone={statusTone(a.status)}>
                  {a.status}
                </span>
              </div>
              <div className={styles.activationMetric}>{a.metric_name}</div>
              <div className={styles.activationMeta}>
                <span>{t('segments.detail.activation.registered', { defaultValue: 'Registered' })} {formatWhen(a.registered_at)}</span>
                <span>{t('segments.detail.activation.lastPush', { defaultValue: 'Last push' })} {formatWhen(a.last_pushed_at)}</span>
              </div>
              {a.last_error && (
                <div className={styles.activationError}>
                  <AlertCircle size={12} aria-hidden /> {a.last_error}
                </div>
              )}
              {onDeactivate && (
                <div className={styles.activationCardFoot}>
                  <button
                    type="button"
                    className={styles.activationDeactivateBtn}
                    disabled={pendingId === a.id}
                    onClick={() => confirmDeactivate(a)}
                  >
                    {pendingId === a.id
                      ? t('segments.detail.activation.deactivating', { defaultValue: 'Deactivating…' })
                      : t('segments.detail.activation.deactivate', { defaultValue: 'Deactivate' })}
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
