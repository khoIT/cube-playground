/** Segment editor — 3-column workspace: rail · center · live preview. */

import { ReactElement, useEffect, useState } from 'react';
import { useHistory, useParams } from 'react-router-dom';
import { Button, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { segmentsClient } from '../../../api/segments-client';
import { SegmentApiError } from '../../../api/api-client';
import { Breadcrumbs } from '../visuals';
import { useActiveGameId } from '../../../components/Header/use-game-context';
import { IdentityCard } from './identity-card';
import { RefreshBehaviourCard } from './refresh-behaviour-card';
import { renderRoot } from './predicate-builder/predicate-group';
import { usePredicateState, isTreeValid } from './hooks/use-predicate-state';
import { usePreview } from './hooks/use-preview';
import { WorkspaceRail } from './workspace-rail';
import { WorkspacePreview } from './workspace-preview';
import { EditorStep, STEP_ORDER, useStep } from './use-step';
import type { Segment, SegmentType, PredicateNode } from '../../../types/segment-api';
import styles from '../segments.module.css';

interface EditorParams { id?: string }

export function EditorView(): ReactElement {
  const { t } = useTranslation();
  const history = useHistory();
  const { id } = useParams<EditorParams>();
  const mode = id ? 'edit' : 'new';
  const gameId = useActiveGameId();

  const [name, setName] = useState('');
  const [cube, setCube] = useState<string | null>(null);
  const [type, setType] = useState<SegmentType>('predicate');
  const [cadence, setCadence] = useState<number | null>(60);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(!id);

  const predicate = usePredicateState();
  const { step, setStep, goNext, goBack } = useStep(mode);

  useEffect(() => {
    if (!id) return;
    segmentsClient
      .get(id)
      .then((seg: Segment) => {
        setName(seg.name);
        setCube(seg.cube);
        setType(seg.type);
        setCadence(seg.refresh_cadence_min ?? 60);
        if (seg.predicate_tree) predicate.replaceTree(seg.predicate_tree);
        setLoaded(true);
      })
      .catch((err: SegmentApiError) => {
        message.error(err.message);
        setLoaded(true);
      });
  }, [id]);

  const validIdentity = name.trim().length > 0 && cube != null;
  const validPredicate = isTreeValid(predicate.tree);
  const valid = validIdentity && (type === 'manual' || validPredicate);

  const completed: Partial<Record<EditorStep, boolean>> = {
    identity: validIdentity,
    predicate: type === 'manual' ? true : validPredicate,
    refresh: cadence != null,
  };

  const preview = usePreview({
    tree: predicate.tree,
    primaryCube: cube,
    enabled: cube != null && validPredicate,
  });

  const handleSave = async () => {
    if (!valid) {
      message.error(t('segments.editor.errors.invalid', { defaultValue: 'Fix the predicate and name first.' }));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        cube,
        type,
        predicate_tree: type === 'predicate' ? (predicate.tree as PredicateNode) : null,
        refresh_cadence_min: type === 'predicate' ? cadence : null,
        game_id: gameId,
      };
      if (id) {
        await segmentsClient.update(id, payload);
        message.success(t('segments.editor.success.updated', { defaultValue: 'Segment updated.' }));
        history.push(`/segments/${id}`);
      } else {
        const created = await segmentsClient.create(payload);
        message.success(t('segments.editor.success.created', { defaultValue: 'Segment created.' }));
        history.push(`/segments/${created.id}`);
      }
    } catch (err) {
      message.error(err instanceof SegmentApiError ? err.message : (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) {
    return (
      <main className={styles.page}>
        <div className={styles.skeletonRow} style={{ width: 240, height: 28 }} />
      </main>
    );
  }

  const stepIndex = STEP_ORDER.indexOf(step);
  const isLastStep = stepIndex === STEP_ORDER.length - 1;
  const stepTitleKey = `segments.editor.steps.${step}.center`;
  const centerTitleDefault: Record<EditorStep, string> = {
    identity: 'Pick a cube + name the segment',
    predicate: 'Define who belongs',
    refresh: 'Refresh behavior',
    activate: 'Activate to CDP',
  };

  return (
    <main className={styles.workspacePage}>
      <Breadcrumbs items={[
        { label: t('segments.detail.backToLibrary', { defaultValue: 'Segments' }), href: '#/segments' },
        { label: id ? `Edit · ${name || 'segment'}` : t('segments.editor.rail.titleNew', { defaultValue: 'New segment' }) },
      ]} />

      <div className={styles.workspace}>
        <WorkspaceRail
          step={step}
          completed={completed}
          onStepClick={setStep}
          mode={mode}
          segmentName={name}
        />
        <section className={styles.workspaceCenter}>
          <header className={styles.workspaceCenterHead}>
            <h2>{t(stepTitleKey, { defaultValue: centerTitleDefault[step] })}</h2>
            <Button type="text" onClick={() => history.goBack()}>
              {t('segments.editor.cancel', { defaultValue: 'Cancel' })}
            </Button>
          </header>

          <div className={styles.workspaceStepBodyPane}>
            {step === 'identity' && (
              <IdentityCard
                name={name}
                cube={cube}
                onNameChange={setName}
                onCubeChange={setCube}
              />
            )}
            {step === 'predicate' && (
              <>
                {renderRoot(predicate.tree, {
                  toggleConj: predicate.toggleConj,
                  addLeaf: predicate.addLeaf,
                  addGroup: predicate.addGroup,
                  removeNode: predicate.removeNode,
                  setLeafMember: predicate.setLeafMember,
                  setLeafOp: predicate.setLeafOp,
                  setLeafValues: predicate.setLeafValues,
                })}
              </>
            )}
            {step === 'refresh' && (
              <RefreshBehaviourCard
                type={type}
                cadenceMin={cadence}
                onTypeChange={setType}
                onCadenceChange={setCadence}
              />
            )}
            {step === 'activate' && (
              <div className={styles.activateEmpty}>
                <p>
                  {t('segments.editor.steps.activate.body', {
                    defaultValue:
                      'Activation lives in the segment Activation tab after save. Save first, then push to CDP.',
                  })}
                </p>
              </div>
            )}
          </div>

          <footer className={styles.workspaceCenterFoot}>
            <Button onClick={goBack} disabled={stepIndex === 0}>
              {t('segments.editor.back', { defaultValue: 'Back' })}
            </Button>
            <div style={{ flex: 1 }} />
            {isLastStep ? (
              <Button
                type="primary"
                loading={saving}
                disabled={!valid}
                onClick={handleSave}
              >
                {id
                  ? t('segments.editor.save', { defaultValue: 'Save changes' })
                  : t('segments.editor.create', { defaultValue: 'Create segment' })}
              </Button>
            ) : (
              <Button type="primary" onClick={goNext}>
                {t('segments.editor.continue', { defaultValue: 'Continue →' })}
              </Button>
            )}
          </footer>
        </section>
        <WorkspacePreview preview={preview} />
      </div>
    </main>
  );
}
