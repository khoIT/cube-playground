/**
 * Definition tab — Identity card (cube + identity_dim + refresh cadence)
 * stacked above the existing PredicateTab content.
 */

import { ReactElement } from 'react';
import { Button } from 'antd';
import { Pencil, Zap } from 'lucide-react';
import { useHistory } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PredicateTab } from './predicate-tab';
import type { Preset } from '../../presets/types';
import type { Segment } from '../../../../types/segment-api';
import styles from '../../segments.module.css';

interface Props {
  segment: Segment;
  preset: Preset | null;
}

export function DefinitionTab({ segment, preset }: Props): ReactElement {
  const { t } = useTranslation();
  const history = useHistory();
  const identityDim = preset?.identityDim ?? null;

  return (
    <div className={styles.definitionTab}>
      <section className={styles.definitionIdentity}>
        <header className={styles.definitionSectionHead}>
          <h3>{t('segments.detail.definition.identity', { defaultValue: 'Identity' })}</h3>
        </header>
        <dl className={styles.definitionList}>
          <div>
            <dt>{t('segments.detail.definition.cube', { defaultValue: 'Cube' })}</dt>
            <dd>{segment.cube ?? '—'}</dd>
          </div>
          <div>
            <dt>{t('segments.detail.definition.identityDim', { defaultValue: 'Identity dim' })}</dt>
            <dd>{identityDim ?? '—'}</dd>
          </div>
          <div>
            <dt>{t('segments.detail.definition.cadence', { defaultValue: 'Refresh cadence' })}</dt>
            <dd>
              {segment.refresh_cadence_min != null
                ? t('segments.detail.definition.cadenceValue', {
                    defaultValue: '{{m}} min',
                    m: segment.refresh_cadence_min,
                  })
                : '—'}
            </dd>
          </div>
        </dl>
      </section>

      <section className={styles.definitionPredicate}>
        <header className={styles.definitionSectionHead}>
          <h3>{t('segments.detail.definition.predicate', { defaultValue: 'Predicate' })}</h3>
          {segment.type === 'predicate' ? (
            <Button
              icon={<Pencil size={13} />}
              onClick={() => history.push(`/segments/${segment.id}/edit`)}
            >
              {t('segments.detail.actions.editPredicate', { defaultValue: 'Edit predicate' })}
            </Button>
          ) : (
            <Button
              icon={<Zap size={13} />}
              onClick={() => history.push(`/segments/${segment.id}/edit?convert=live`)}
            >
              {t('segments.detail.actions.convertToLive', { defaultValue: 'Convert to Live' })}
            </Button>
          )}
        </header>
        <PredicateTab segment={segment} />
      </section>
    </div>
  );
}
