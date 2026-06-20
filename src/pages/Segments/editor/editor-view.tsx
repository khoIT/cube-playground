/** Segment editor — 3-column workspace: rail · center · live preview. */

import { ReactElement, useEffect, useRef, useState } from 'react';
import { useHistory, useParams } from 'react-router-dom';
import { Button, Tooltip, message } from 'antd';
import { ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { buildDefinitionDeeplink } from '../../../utils/playground-deeplink';
import { useIdentityMap } from '../../../hooks/use-identity-map';
import { segmentsClient } from '../../../api/segments-client';
import { SegmentApiError } from '../../../api/api-client';
import { invalidateSegmentIds } from '../use-segment-ids';
import { Breadcrumbs } from '../visuals';
import { useActiveGameId } from '../../../components/Header/use-game-context';
import { useAuthUser } from '../../../auth/auth-context';
import { IdentityCard } from './identity-card';
import { RefreshBehaviourCard } from './refresh-behaviour-card';
import { renderRoot } from './predicate-builder/predicate-group';
import { simplifyPredicate } from '../../../QueryBuilderV2/segments-save-bar/simplify-predicate';
import { usePredicateState, isTreeValid } from './hooks/use-predicate-state';
import { parseCubeSegmentsFromQueryJson } from '../slice-scope/parse-cube-segments';
import { usePredicateMemberCatalog } from './predicate-builder/use-predicate-member-catalog';
import { CubeSegmentScopeChips } from './cube-segment-scope-chips';
import { usePreview } from './hooks/use-preview';
import { WorkspaceRail } from './workspace-rail';
import { WorkspacePreview } from './workspace-preview';
import { EditorStep, STEP_ORDER, useStep } from './use-step';
import { resolveReturnPath, type EditorLocationState } from './editor-route-state';
import { consumeEditorPrefill } from './editor-prefill-store';
import type { Segment, SegmentType, SegmentVisibility, PredicateNode } from '../../../types/segment-api';
import styles from '../segments.module.css';

interface EditorParams { id?: string }

export function EditorView(): ReactElement {
  const { t } = useTranslation();
  const history = useHistory();
  const { id } = useParams<EditorParams>();
  const mode = id ? 'edit' : 'new';
  const gameId = useActiveGameId();
  // Deep-link from a static segment's "Convert to Live" action — start the
  // editor in Live mode so the user lands straight on the predicate builder.
  const wantsConvertToLive =
    new URLSearchParams(history.location.search).get('convert') === 'live';

  const authUser = useAuthUser();
  const canSetOrg = authUser?.role === 'admin';

  const [name, setName] = useState('');
  const [cube, setCube] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<SegmentVisibility>('personal');
  const [type, setType] = useState<SegmentType>('predicate');
  const [cadence, setCadence] = useState<number | null>(60);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(!id);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [savedTrend, setSavedTrend] = useState<number[]>([]);
  // Cube-level segments riding in the stored query (e.g. mf_users.whales).
  // They scope membership alongside the editable predicate but are named SQL
  // snippets in the cube model — shown read-only, preserved by the server on
  // every predicate edit.
  const [cubeSegments, setCubeSegments] = useState<string[]>([]);

  const predicate = usePredicateState();
  const { step, setStep, goNext, goBack } = useStep(mode);
  // Load /meta member catalog for the chosen cube — powers the member-field dropdown.
  const { catalog } = usePredicateMemberCatalog(cube);
  // Track whether we have a loaded segment to know can_administer status.
  const [canAdminister, setCanAdminister] = useState(mode === 'new');
  // Shared cube→identity-field map; powers the playground deeplink's identity dim.
  const { mappings } = useIdentityMap();

  useEffect(() => {
    if (!id) return;
    segmentsClient
      .get(id)
      .then((seg: Segment) => {
        setName(seg.name);
        setCube(seg.cube);
        setVisibility(seg.visibility ?? 'personal');
        setType(seg.type === 'manual' && wantsConvertToLive ? 'predicate' : seg.type);
        setCadence(seg.refresh_cadence_min ?? 60);
        // Simplify on load so segments saved before the build-time resolver
        // (or hand-edited into verbose shapes) still render concise here.
        if (seg.predicate_tree) predicate.replaceTree(simplifyPredicate(seg.predicate_tree));
        setCubeSegments(parseCubeSegmentsFromQueryJson(seg.cube_query_json));
        setCanAdminister(seg.can_administer);
        setSavedCount(seg.uid_count);
        setLoaded(true);
      })
      .catch((err: SegmentApiError) => {
        message.error(err.message);
        setLoaded(true);
      });
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    segmentsClient
      .refreshLog(id, 14, 200)
      .then((rows) => {
        if (cancelled) return;
        // refreshLog comes newest-first; reverse so the sparkline reads left→right oldest→newest.
        const trend = rows
          .filter((r) => r.status !== 'broken' && typeof r.uid_count === 'number')
          .map((r) => r.uid_count)
          .reverse();
        setSavedTrend(trend);
      })
      .catch(() => {
        if (!cancelled) setSavedTrend([]);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Pre-seed the builder when opened from another surface (the Advisor / chat
  // segment-proposal push a proposed cohort here for review/edit). The entry
  // state arrives via the sessionStorage bridge because hash history drops
  // location.state; we fall back to location.state for router setups that do
  // preserve it (tests, browser history). Consumed once on mount and held in a
  // ref so the save handler can also read returnTo. New mode only — an existing
  // segment's own load wins.
  const entryStateRef = useRef<EditorLocationState | null>(null);
  useEffect(() => {
    const state =
      consumeEditorPrefill() ??
      (history.location.state as EditorLocationState | undefined) ??
      null;
    entryStateRef.current = state;
    if (id) return;
    const prefill = state?.advisorPrefill;
    if (!prefill) return;
    if (prefill.name) setName(prefill.name);
    if (prefill.cube) setCube(prefill.cube);
    if (prefill.predicateTree) predicate.replaceTree(simplifyPredicate(prefill.predicateTree));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    cubeSegments,
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
        visibility,
        // Include cube_segments so PATCH can rebuild cube_query_json with
        // the updated chip set. Empty array explicitly clears the sidecar.
        cube_segments: type === 'predicate' ? cubeSegments : undefined,
      };
      // Return target (e.g. the Advisor's cohort review / draft-cohort edit) →
      // go back there scoped to the saved segment; else the segment detail page.
      const returnTo = entryStateRef.current?.returnTo;
      if (id) {
        await segmentsClient.update(id, payload);
        message.success(t('segments.editor.success.updated', { defaultValue: 'Segment updated.' }));
        history.push(returnTo ? resolveReturnPath(returnTo, id) : `/segments/${id}`, returnTo?.state);
      } else {
        const created = await segmentsClient.create(payload);
        invalidateSegmentIds();
        message.success(t('segments.editor.success.created', { defaultValue: 'Segment created.' }));
        history.push(
          returnTo ? resolveReturnPath(returnTo, created.id) : `/segments/${created.id}`,
          returnTo?.state,
        );
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

  // "Open in Playground" carries the CURRENT (possibly unsaved) definition so
  // the playground mirrors what's on screen; save-back targets this segment id.
  // Identity dim comes from the shared identity map (same anchor the refresh
  // job resolves), falling back to the cube's own user_id dimension.
  const identityDim = cube
    ? (mappings.find((m) => m.cube === cube)?.identity_field ?? `${cube}.user_id`)
    : null;
  const playgroundLink =
    id && type === 'predicate' && cube && validPredicate && identityDim
      ? buildDefinitionDeeplink({
          segment: {
            id,
            name,
            type,
            cube,
            predicate_tree: predicate.tree as PredicateNode,
            cube_query_json: null,
            uid_list: [],
            game_id: gameId,
          },
          identityDim,
          cubeSegments,
          gameId,
        })
      : null;
  const stepTitleKey = `segments.editor.steps.${step}.center`;
  const centerTitleDefault: Record<EditorStep, string> = {
    identity: 'Pick a cube + name the segment',
    predicate: 'Define who belongs',
    refresh: 'Refresh behavior',
    activate: 'Activate to CDP',
  };

  return (
    <main className={styles.workspacePage}>
      <Breadcrumbs items={
        id
          ? [
              { label: t('segments.detail.backToLibrary', { defaultValue: 'Segments' }), href: '#/segments' },
              { label: name || t('segments.editor.rail.titleEdit', { defaultValue: 'Segment' }), href: `#/segments/${id}` },
              { label: t('segments.editor.breadcrumb.edit', { defaultValue: 'Edit' }) },
            ]
          : [
              { label: t('segments.detail.backToLibrary', { defaultValue: 'Segments' }), href: '#/segments' },
              { label: t('segments.editor.rail.titleNew', { defaultValue: 'New segment' }) },
            ]
      } />

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
            <div style={{ display: 'inline-flex', gap: 8 }}>
              {step === 'predicate' && playgroundLink && (
                'disabled' in playgroundLink ? (
                  <Tooltip title={playgroundLink.reason}>
                    <span>
                      <Button icon={<ExternalLink size={13} aria-hidden />} disabled>
                        {t('segments.detail.actions.openInPlayground', { defaultValue: 'Open in Playground' })}
                      </Button>
                    </span>
                  </Tooltip>
                ) : (
                  <Button
                    icon={<ExternalLink size={13} aria-hidden />}
                    onClick={() => window.location.assign(playgroundLink.url)}
                  >
                    {t('segments.detail.actions.openInPlayground', { defaultValue: 'Open in Playground' })}
                  </Button>
                )
              )}
              {id && (
                <Button onClick={() => history.push(`/segments/${id}`)}>
                  {t('segments.editor.viewSegment', { defaultValue: 'View segment' })}
                </Button>
              )}
              <Button type="text" onClick={() => history.goBack()}>
                {t('segments.editor.cancel', { defaultValue: 'Cancel' })}
              </Button>
            </div>
          </header>

          <div className={styles.workspaceStepBodyPane}>
            {step === 'identity' && (
              <IdentityCard
                name={name}
                cube={cube}
                visibility={visibility}
                canSetOrg={canSetOrg}
                onNameChange={setName}
                onCubeChange={setCube}
                onVisibilityChange={setVisibility}
              />
            )}
            {step === 'predicate' && (
              <>
                {(catalog?.modelSegments.length ?? 0) > 0 || cubeSegments.length > 0 ? (
                  <CubeSegmentScopeChips
                    modelSegments={catalog?.modelSegments ?? []}
                    activeSegments={cubeSegments}
                    primaryCube={cube ?? ''}
                    canAdminister={canAdminister}
                    onChange={setCubeSegments}
                  />
                ) : null}
                {renderRoot(predicate.tree, {
                  toggleConj: predicate.toggleConj,
                  addLeaf: predicate.addLeaf,
                  addGroup: predicate.addGroup,
                  removeNode: predicate.removeNode,
                  setLeafMember: predicate.setLeafMember,
                  setLeafOp: predicate.setLeafOp,
                  setLeafValues: predicate.setLeafValues,
                  catalog,
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
        <WorkspacePreview preview={preview} savedCount={savedCount} savedTrend={savedTrend} />
      </div>
    </main>
  );
}
