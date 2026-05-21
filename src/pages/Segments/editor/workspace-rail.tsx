/**
 * Left rail for the editor workspace. 4 step items with marker (number → check
 * when complete → orange ring when active). Bottom link to identity-map.
 */

import { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Check, Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EditorStep, STEP_ORDER } from './use-step';
import styles from '../segments.module.css';

interface Props {
  step: EditorStep;
  completed: Partial<Record<EditorStep, boolean>>;
  onStepClick: (s: EditorStep) => void;
  mode: 'new' | 'edit';
  segmentName?: string;
}

interface StepMeta {
  key: EditorStep;
  label: string;
  sub: string;
}

export function WorkspaceRail({ step, completed, onStepClick, mode, segmentName }: Props): ReactElement {
  const { t } = useTranslation();

  const items: StepMeta[] = [
    {
      key: 'identity',
      label: t('segments.editor.steps.identity.label', { defaultValue: 'Identity' }),
      sub: t('segments.editor.steps.identity.sub', { defaultValue: 'Cube + name + tags' }),
    },
    {
      key: 'predicate',
      label: t('segments.editor.steps.predicate.label', { defaultValue: 'Predicate' }),
      sub: t('segments.editor.steps.predicate.sub', { defaultValue: 'Who belongs to this cohort' }),
    },
    {
      key: 'refresh',
      label: t('segments.editor.steps.refresh.label', { defaultValue: 'Refresh' }),
      sub: t('segments.editor.steps.refresh.sub', { defaultValue: 'Live cadence or static' }),
    },
    {
      key: 'activate',
      label: t('segments.editor.steps.activate.label', { defaultValue: 'Activate' }),
      sub: t('segments.editor.steps.activate.sub', { defaultValue: 'Push to CDP (after save)' }),
    },
  ];

  return (
    <aside className={styles.workspaceRail}>
      <div className={styles.workspaceRailTitle}>
        {mode === 'new'
          ? t('segments.editor.rail.titleNew', { defaultValue: 'New segment' })
          : t('segments.editor.rail.titleEdit', {
              defaultValue: 'Edit · {{name}}',
              name: segmentName ?? 'segment',
            })}
      </div>
      <ol className={styles.workspaceSteps}>
        {items.map((item, i) => {
          const active = step === item.key;
          const done = !!completed[item.key];
          const idx = STEP_ORDER.indexOf(item.key) + 1;
          return (
            <li key={item.key}>
              <button
                type="button"
                className={[
                  styles.workspaceStep,
                  active ? styles.workspaceStepActive : '',
                  done ? styles.workspaceStepDone : '',
                ].filter(Boolean).join(' ')}
                onClick={() => onStepClick(item.key)}
                aria-current={active ? 'step' : undefined}
              >
                <span className={styles.workspaceStepMarker}>
                  {done ? <Check size={12} aria-hidden /> : idx}
                </span>
                <span className={styles.workspaceStepBody}>
                  <span className={styles.workspaceStepLabel}>{item.label}</span>
                  <span className={styles.workspaceStepSub}>{item.sub}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <Link to="/segments/identity-map" className={styles.workspaceRailFootLink}>
        <Settings2 size={13} aria-hidden />
        {t('segments.editor.rail.identityMap', { defaultValue: 'Edit identity map →' })}
      </Link>
    </aside>
  );
}
