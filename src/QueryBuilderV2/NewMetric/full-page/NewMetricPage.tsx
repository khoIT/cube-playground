import { useEffect, useMemo, useRef, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { Modal, notification } from 'antd';
import { useNewMetricMeta } from '../hooks/use-new-metric-meta';
import { useNewMetricDraft } from '../hooks/use-new-metric-draft';
import { useActiveGameId } from '../../../components/Header/use-game-context';
import { useActiveStep, type ArtifactStepId } from './hooks/use-active-step';
import { Shell } from './shell/shell';
import { LeftRail } from './shell/left-rail';
import { RightRail } from './shell/right-rail';
import { StepChrome } from './shell/step-chrome';
import { ArtifactKindBody } from './steps/step-0-artifact-kind/artifact-kind-body';
import { SourceBody } from './steps/step-1-source/source-body';
import { SourcePreviewRail } from './steps/step-1-source/source-preview-rail';
import { OperationBody } from './steps/step-2-operation/operation-body';
import { useAutoMetricName } from './hooks/use-auto-metric-name';
import { computeAutoMetricName } from './hooks/compute-auto-metric-name';
import { findOp, primarySlotIdFor } from './steps/step-2-operation/operations';
import { OperationDetailRail } from './steps/step-2-operation/operation-detail-rail';
import { ColumnBody } from './steps/step-3-column/column-body';
import { ColumnHealthRail } from './steps/step-3-column/column-health-rail';
import { FiltersBody } from './steps/step-4-filters/filters-body';
import { IdentityBody } from './steps/step-5-identity/identity-body';
import { YamlPreviewRail } from './steps/step-5-identity/yaml-preview-rail';
import { TestRunBody, type TestRunControls } from './steps/step-6-test-run/test-run-body';
import { TestRunDimensionView } from './steps/step-6-test-run/test-run-dimension-view';
import { TestRunSegmentView } from './steps/step-6-test-run/test-run-segment-view';
import { discardAllPending, sweepStale } from './steps/step-6-test-run/pending-writes';
import { DimKindBody } from './steps/step-dim-kind/dim-kind-body';
import { DimBuilderBody } from './steps/step-dim-builder/dim-builder-body';
import { SegmentTreeBody } from './steps/step-segment-tree/segment-tree-body';
import { PerfProbe } from '../../../dev/perf-probe';
import { isEmpty as isFilterTreeEmpty } from '../filter-tree';
import type { ArtifactKind, DimKind, DimBuilder } from '../types';

/**
 * Route component for `/data-model/new`. Mounts the full-page wizard shell
 * behind `?v=2`. (Legacy route `/metrics/new` redirects here.)
 *
 * Despite the file/class name, this wizard is the *data-model* builder —
 * it edits cube YAML (artifactKind: measure | dimension | segment). The
 * lightweight business-metric registration form lives at `/catalog/metric/new`
 * (MetricCompositionWizard).
 *
 * Step 0 picks the kind; remaining steps branch via `useActiveStep`'s per-kind
 * step graph.
 *
 * RR5 + HashRouter only — no useNavigate / useSearchParams / RR6 idioms.
 */
export function NewMetricPage() {
  const location = useLocation();
  const history = useHistory();
  const params = new URLSearchParams(location.search);
  const v = params.get('v');
  const isV2 = v === '2';

  const { meta, cubejsApi, loading, error } = useNewMetricMeta();
  const reachableNames = useMemo<Set<string> | undefined>(() => {
    if (!meta) return undefined;
    const s = new Set<string>();
    for (const c of meta.cubes) {
      for (const d of c.dimensions ?? []) s.add(d.name);
      for (const m of c.measures ?? []) s.add(m.name);
    }
    return s;
  }, [meta]);

  // Suggestions for the Identity-step TagCombo. Computed from current /meta
  // because the wizard route is mounted outside the QueryBuilder context that
  // backs the existing `useExistingTags` hook.
  const tagSuggestions = useMemo<string[]>(() => {
    if (!meta) return [];
    const seen = new Set<string>();
    for (const c of meta.cubes) {
      for (const m of c.measures ?? []) {
        const tags = (m as any).meta?.tags;
        if (Array.isArray(tags)) for (const t of tags) if (typeof t === 'string') seen.add(t);
      }
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [meta]);

  const initialGameId = useActiveGameId();
  const draftState = useNewMetricDraft({ reachableNames, initialGameId });
  const { draft, setField, setInput, setArtifactKind, toggleSource, setPrimarySource, clearPersisted } = draftState;
  const { step, setStep, canGoTo, next, back, totalSteps, doneFlags, graph, currentStep } =
    useActiveStep(draft);

  // Transient pulse flag for Step 1's source picker, raised when the user
  // clicks a source-gated op card in Step 2.
  const [highlightSources, setHighlightSources] = useState(false);
  function pulseSourcesAndBack() {
    setHighlightSources(true);
    back();
    window.setTimeout(() => setHighlightSources(false), 1500);
  }

  // True while the confirm dialog for kind switching is open. Disables the
  // radio cards on Step 0 so a quick double-click can't dispatch two switches
  // (red-team F-W).
  const [kindSwitchPending, setKindSwitchPending] = useState(false);

  // Bridge between StepChrome's Continue button on the test-run step and
  // TestRunBody's internal submit handler. The body owns the schema-write /
  // preview state so we expose `submit` via an imperative ref and surface
  // readiness via a boolean for `canContinue`.
  const testRunCtrl = useRef<TestRunControls | null>(null);
  const [canSubmitTestRun, setCanSubmitTestRun] = useState(false);

  // Live auto-fill of name + title from the draft. The hook resets its
  // auto-controlled refs internally when `artifactKind` changes (red-team
  // F-12), so dim ↔ measure flips re-evaluate the auto-name cleanly.
  useAutoMetricName(draft, setField);

  // One-shot cleanup: when the wizard mounts (after meta + draft hydration),
  // sweep any test-run YAML the previous session left orphaned on disk. The
  // current draft's identity is preserved so an in-progress measure isn't
  // wiped out on a tab refresh.
  const sweepDoneRef = useRef(false);
  useEffect(() => {
    if (sweepDoneRef.current || !meta) return;
    sweepDoneRef.current = true;
    const primary = draft.sourceCubes[0];
    const keep =
      primary && draft.name
        ? { cubeName: primary, measureName: draft.name }
        : null;
    void sweepStale(keep);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta]);

  // selectedCubes must live BEFORE the `if (!isV2)` early-return so the hook
  // order stays stable. NewMetricPage's route (/metrics/new) matches as a
  // prefix on /metrics/new/success too — when Submit pushes to the success
  // URL the wizard re-renders with isV2=false, and any post-return hook
  // would trigger React's "rendered fewer hooks" error.
  const selectedCubes = useMemo(() => {
    if (!meta) return [];
    const byName = new Map(meta.cubes.map((c) => [c.name, c]));
    return draft.sourceCubes
      .map((n) => byName.get(n))
      .filter((c): c is NonNullable<typeof c> => Boolean(c));
  }, [meta, draft.sourceCubes]);

  // Apply ?cube= deep-link once meta is available, validating against meta.cubes.
  const [cubeParamApplied, setCubeParamApplied] = useState(false);
  useEffect(() => {
    if (cubeParamApplied || !meta) return;
    const cubeParam = params.get('cube');
    if (!cubeParam) {
      setCubeParamApplied(true);
      return;
    }
    if (meta.cubes.some((c) => c.name === cubeParam)) {
      if (draft.sourceCubes.length === 0) setField('sourceCubes', [cubeParam]);
    } else {
      // eslint-disable-next-line no-console
      console.warn(`[new-metric-page] ?cube=${cubeParam} not in meta — ignored.`);
    }
    setCubeParamApplied(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta]);

  if (!isV2) {
    return (
      <div style={{ padding: 32, fontFamily: 'var(--font-sans)' }}>
        <h2>New data model</h2>
        <p style={{ color: 'var(--text-muted)' }}>
          Append <code>?v=2</code> to this URL to open the full-page wizard.
        </p>
      </div>
    );
  }

  // `primaryCube` powers downstream step rails / summaries. Additional selected
  // cubes (for cross-cube ratio) live in `selectedCubes` (computed above).
  const primaryCubeName = draft.sourceCubes[0] ?? null;
  const selectedCube = primaryCubeName && meta
    ? meta.cubes.find((c) => c.name === primaryCubeName) ?? null
    : null;

  const autoName = computeAutoMetricName(draft);
  const isAutoName = !draft.name || draft.name === autoName;
  const metricName = draft.name || autoName;

  const opLabel = draft.operation
    ? draft.operation === 'countDistinct'
      ? 'Count distinct'
      : draft.operation.charAt(0).toUpperCase() + draft.operation.slice(1)
    : 'Aggregation type';
  // For the LeftRail summary line we show the primary slot's leaf (or for
  // ratio the numerator's leaf), matching how the user thinks about the metric.
  const primarySlotId = primarySlotIdFor(draft.operation);
  const primarySlotValue = draft.inputs[primarySlotId] ?? null;
  const columnLeaf = primarySlotValue
    ? primarySlotValue.includes('.')
      ? primarySlotValue.split('.').slice(-1)[0]
      : primarySlotValue
    : null;

  // Source summary: single cube → just its name. Multi-source → "primary +N more".
  const sourceSummary = draft.sourceCubes.length === 0
    ? 'Pick a cube or view'
    : draft.sourceCubes.length === 1
      ? draft.sourceCubes[0]
      : `${draft.sourceCubes[0]} +${draft.sourceCubes.length - 1} more`;

  const kindLabel: Record<ArtifactKind, string> = {
    measure: 'Measure',
    dimension: 'Dimension',
    segment: 'Segment',
  };

  // Per-step summary line for the LeftRail. Looked up by step id rather than
  // numeric index so the same code works for all three kinds.
  function summaryFor(id: ArtifactStepId): string | undefined {
    switch (id) {
      case 'kind': return kindLabel[draft.artifactKind];
      case 'source': return sourceSummary;
      case 'op': return draft.operation ? opLabel : 'Aggregation type';
      case 'column': return columnLeaf ?? (draft.operation === 'count' ? 'count is *' : 'Field to measure');
      case 'filters': return 'Where clause';
      case 'identity': return draft.name || 'Name & format';
      case 'test-run': return 'Verify shape';
      case 'dim-kind': return draft.dimKind ?? 'Pick dim kind';
      case 'builder': return draft.dimBuilder ? 'Configured' : 'Configure the dim';
      case 'filter-tree': return isFilterTreeEmpty(draft.filterTree) ? 'No filters yet' : 'Cohort defined';
      default: return undefined;
    }
  }
  const summaries = graph.map((cfg) => summaryFor(cfg.id));

  function handleDiscard() {
    Modal.confirm({
      title: 'Discard new metric?',
      content: 'Your draft will be cleared and any test-run YAML on disk will be removed.',
      okText: 'Discard',
      okType: 'danger',
      cancelText: 'Keep editing',
      onOk: async () => {
        // Delete any test-run YAML the live preview committed during this
        // session before clearing local state. Best-effort — failures don't
        // block the user-facing discard.
        await discardAllPending();
        clearPersisted();
        draftState.reset();
        history.push('/build');
      },
    });
  }

  function handleSaveDraft() {
    notification.info({ message: 'Draft saved' });
  }

  function hasKindSpecificSubState(kind: ArtifactKind): boolean {
    if (kind === 'dimension') return !!draft.dimBuilder || !!draft.dimKind;
    if (kind === 'segment') return !isFilterTreeEmpty(draft.filterTree);
    // measure: `operation` always has a default ('sum'), so it's not a real
    // signal — only treat the measure as having sub-state if a slot is filled.
    if (kind === 'measure') return Object.values(draft.inputs).some((v) => v);
    return false;
  }

  function handleKindSelect(nextKind: ArtifactKind) {
    if (nextKind === draft.artifactKind) return;
    // Only prompt when switching AWAY from a kind whose sub-state would be
    // wiped by the reducer. Switching INTO a kind never destroys sub-state
    // (the previous kind's state is what gets wiped).
    if (hasKindSpecificSubState(draft.artifactKind)) {
      setKindSwitchPending(true);
      Modal.confirm({
        title: 'Switch artifact kind?',
        content: `Your ${draft.artifactKind} progress will be cleared. Continue?`,
        okText: `Switch to ${kindLabel[nextKind]}`,
        okType: 'danger',
        cancelText: 'Keep editing',
        onOk: () => {
          setArtifactKind(nextKind);
          setKindSwitchPending(false);
        },
        onCancel: () => setKindSwitchPending(false),
      });
      return;
    }
    setArtifactKind(nextKind);
  }

  return (
    <PerfProbe id="NewMetricPage">
      <Shell
        leftRail={
          <LeftRail
            graph={graph}
            step={step}
            setStep={setStep}
            canGoTo={canGoTo}
            summaries={summaries}
            doneFlags={doneFlags}
            metricName={metricName}
            isAutoName={isAutoName}
            onSaveDraft={handleSaveDraft}
            onDiscard={handleDiscard}
          />
        }
        main={renderStep({
          stepId: currentStep.id,
          stepTitle: currentStep.name,
          stepSubtitle: currentStep.sub,
          stepNumber: step + 1,
          totalSteps,
          draft,
          meta,
          loading,
          error,
          setField,
          setInput,
          toggleSource,
          setPrimarySource,
          next,
          back,
          canBack: step > 0,
          selectedCube,
          tagSuggestions,
          cubejsApi,
          highlightSources,
          onRequestBackToSources: pulseSourcesAndBack,
          testRunCtrl,
          canSubmitTestRun,
          setCanSubmitTestRun,
          kindSwitchPending,
          onKindSelect: handleKindSelect,
        })}
        rightRail={(() => {
          const rail = rightRailMeta({ stepId: currentStep.id, selectedCube, operation: draft.operation, column: primarySlotValue });
          return (
            <RightRail title={rail.title} subtitle={rail.subtitle}>
              {currentStep.id === 'source' && <SourcePreviewRail cube={selectedCube} />}
              {currentStep.id === 'op' && <OperationDetailRail cube={selectedCube} operation={draft.operation} />}
              {currentStep.id === 'column' && <ColumnHealthRail cube={selectedCube} column={primarySlotValue} operation={draft.operation} cubeApi={cubejsApi} />}
              {currentStep.id === 'filters' && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Cohort funnel arrives in a follow-up. The compiled SQL preview is in the main panel.</div>}
              {currentStep.id === 'identity' && <YamlPreviewRail draft={draft} sourceCube={selectedCube} />}
              {(currentStep.id === 'kind' || currentStep.id === 'dim-kind' || currentStep.id === 'builder' || currentStep.id === 'filter-tree' || currentStep.id === 'test-run') && (
                <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Preview lands in a follow-up phase.</div>
              )}
            </RightRail>
          );
        })()}
      />
    </PerfProbe>
  );
}

function rightRailMeta(args: {
  stepId: ArtifactStepId;
  selectedCube: { name: string; title?: string } | null;
  operation: string | null;
  column: string | null;
}): { title: string; subtitle?: string } {
  const { stepId, selectedCube, operation, column } = args;
  if (stepId === 'kind') return { title: 'Artifact kind', subtitle: 'What you are authoring' };
  if (stepId === 'source') {
    return selectedCube
      ? { title: 'Selected source', subtitle: selectedCube.name }
      : { title: 'Source preview', subtitle: 'Pick a source to inspect its schema' };
  }
  if (stepId === 'op') {
    return operation
      ? { title: 'Operation', subtitle: operation }
      : { title: 'Operation preview', subtitle: 'Pick an aggregation to see its formula' };
  }
  if (stepId === 'column') {
    return column
      ? { title: 'Column health', subtitle: column }
      : { title: 'Column preview', subtitle: 'Pick a column to inspect distribution' };
  }
  if (stepId === 'filters') return { title: 'Filters preview', subtitle: 'Cohort impact' };
  if (stepId === 'identity') return { title: 'YAML preview', subtitle: selectedCube?.name };
  if (stepId === 'dim-kind') return { title: 'Dimension kind', subtitle: 'Banding / time-since / passthrough / boolean' };
  if (stepId === 'builder') return { title: 'Dimension builder', subtitle: 'Configure the SQL shape' };
  if (stepId === 'filter-tree') return { title: 'Segment filter', subtitle: 'Define the cohort WHERE' };
  return { title: 'Preview' };
}

function renderStep(args: {
  stepId: ArtifactStepId;
  stepTitle: string;
  stepSubtitle?: string;
  stepNumber: number;
  totalSteps: number;
  draft: ReturnType<typeof useNewMetricDraft>['draft'];
  meta: ReturnType<typeof useNewMetricMeta>['meta'];
  loading: boolean;
  error: string | null;
  setField: ReturnType<typeof useNewMetricDraft>['setField'];
  setInput: ReturnType<typeof useNewMetricDraft>['setInput'];
  toggleSource: ReturnType<typeof useNewMetricDraft>['toggleSource'];
  setPrimarySource: ReturnType<typeof useNewMetricDraft>['setPrimarySource'];
  next: () => void;
  back: () => void;
  canBack: boolean;
  selectedCube: ReturnType<typeof useNewMetricMeta>['meta'] extends infer T
    ? T extends { cubes: Array<infer C> } ? C | null : null
    : null;
  tagSuggestions: string[];
  cubejsApi: ReturnType<typeof useNewMetricMeta>['cubejsApi'];
  highlightSources: boolean;
  onRequestBackToSources: () => void;
  testRunCtrl: React.MutableRefObject<TestRunControls | null>;
  canSubmitTestRun: boolean;
  setCanSubmitTestRun: (ready: boolean) => void;
  kindSwitchPending: boolean;
  onKindSelect: (kind: ArtifactKind) => void;
}) {
  const {
    stepId, stepTitle, stepSubtitle, stepNumber, totalSteps,
    draft, meta, loading, error, setField, toggleSource, setPrimarySource,
    next, back, canBack, selectedCube, tagSuggestions, cubejsApi,
    highlightSources, onRequestBackToSources, testRunCtrl, canSubmitTestRun, setCanSubmitTestRun,
    kindSwitchPending, onKindSelect,
  } = args;

  const chromeBase = {
    stepNumber,
    totalSteps,
    title: stepTitle,
    subtitle: stepSubtitle,
    canBack,
    onBack: back,
    onContinue: next,
  };

  if (stepId === 'kind') {
    return (
      <StepChrome
        {...chromeBase}
        canBack={false}
        canContinue={true}
        continueLabel="Continue to source"
      >
        <ArtifactKindBody
          selected={draft.artifactKind}
          onSelect={onKindSelect}
          disabled={kindSwitchPending}
        />
      </StepChrome>
    );
  }

  if (stepId === 'source') {
    const continueLabel =
      draft.artifactKind === 'measure' ? 'Continue to operation'
      : draft.artifactKind === 'dimension' ? 'Continue to dim kind'
      : 'Continue to filter';
    return (
      <StepChrome
        {...chromeBase}
        canContinue={draft.sourceCubes.length >= 1}
        continueLabel={continueLabel}
      >
        {loading && <div style={{ color: 'var(--text-muted)' }}>Loading sources…</div>}
        {error && <div style={{ color: 'var(--danger)' }}>Failed to load meta: {error}</div>}
        {meta && (
          <SourceBody
            cubes={meta.cubes}
            selectedNames={draft.sourceCubes}
            onToggle={toggleSource}
            onSetPrimary={setPrimarySource}
            cubeApi={cubejsApi}
            highlight={highlightSources}
          />
        )}
      </StepChrome>
    );
  }

  if (stepId === 'op') {
    const continueLabel = draft.operation === 'count' ? 'Skip column — count is *' : 'Pick column';
    return (
      <StepChrome
        {...chromeBase}
        canContinue={!!draft.operation}
        continueLabel={continueLabel}
        onContinue={() => {
          // Count's slot is optional → skip Step "column" straight to filters.
          if (draft.operation === 'count') {
            setField('inputs', {});
            next(); next();
          } else {
            next();
          }
        }}
      >
        <OperationBody
          cube={selectedCube as any}
          operation={draft.operation}
          sourceCount={draft.sourceCubes.length}
          onRequestBack={onRequestBackToSources}
          onSelect={(op) => {
            // Operation switch clears the inputs map — the new op's slot
            // ids may not match the previous selection.
            if (op !== draft.operation) setField('inputs', {});
            setField('operation', op);
          }}
        />
      </StepChrome>
    );
  }

  if (stepId === 'column') {
    const op = findOp(draft.operation);
    const allRequiredFilled = !op || op.inputs.every((slot) => !slot.required || !!draft.inputs[slot.id]);
    const wizardCubes = (meta?.cubes ?? []).filter((c) => draft.sourceCubes.includes(c.name));
    return (
      <StepChrome
        {...chromeBase}
        canContinue={allRequiredFilled}
        continueLabel="Continue to filters"
      >
        <ColumnBody
          cubes={wizardCubes as any}
          operation={draft.operation}
          inputs={draft.inputs}
          onSelect={(slotId, memberName) => args.setInput(slotId, memberName)}
        />
      </StepChrome>
    );
  }

  if (stepId === 'filters') {
    return (
      <StepChrome
        {...chromeBase}
        canContinue
        continueLabel="Continue to identity"
        extraFooter={
          <button
            onClick={next}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13 }}
            type="button"
          >Skip step</button>
        }
      >
        <FiltersBody
          cube={selectedCube as any}
          tree={draft.filterTree}
          onChange={(nextTree) => setField('filterTree', nextTree)}
        />
      </StepChrome>
    );
  }

  if (stepId === 'identity') {
    const valid = !!draft.name && !!draft.title;
    return (
      <StepChrome
        {...chromeBase}
        canContinue={valid}
        continueLabel="Continue to test run"
      >
        <IdentityBody draft={draft} onField={setField} tagSuggestions={tagSuggestions} />
      </StepChrome>
    );
  }

  if (stepId === 'test-run') {
    const submitLabel =
      draft.artifactKind === 'measure' ? 'Submit metric request'
      : draft.artifactKind === 'dimension' ? 'Submit dimension'
      : 'Submit segment';
    return (
      <StepChrome
        {...chromeBase}
        canContinue={canSubmitTestRun}
        backLabel="Back to identity"
        continueLabel={submitLabel}
        onContinue={() => void testRunCtrl.current?.submit()}
      >
        {draft.artifactKind === 'measure' && (
          <TestRunBody
            draft={draft}
            sourceCube={selectedCube as any}
            cubejsApi={cubejsApi}
            onSubmitted={() => { /* navigation happens inside body */ }}
            controlsRef={testRunCtrl}
            onReadyChange={setCanSubmitTestRun}
          />
        )}
        {draft.artifactKind === 'dimension' && (
          <TestRunDimensionView
            draft={draft}
            sourceCube={selectedCube as any}
            cubejsApi={cubejsApi}
            controlsRef={testRunCtrl}
            onReadyChange={setCanSubmitTestRun}
            onSubmitted={() => { /* navigation happens inside view */ }}
          />
        )}
        {draft.artifactKind === 'segment' && (
          <TestRunSegmentView
            draft={draft}
            sourceCube={selectedCube as any}
            cubejsApi={cubejsApi}
            controlsRef={testRunCtrl}
            onReadyChange={setCanSubmitTestRun}
            onSubmitted={() => { /* navigation happens inside view */ }}
          />
        )}
      </StepChrome>
    );
  }

  if (stepId === 'dim-kind') {
    return (
      <StepChrome
        {...chromeBase}
        canContinue={!!draft.dimKind}
        continueLabel="Continue to builder"
      >
        <DimKindBody
          selected={draft.dimKind}
          onSelect={(k) => {
            // Switching dim-kind invalidates the prior builder shape.
            if (draft.dimKind !== k) setField('dimBuilder', undefined as any);
            setField('dimKind', k);
          }}
        />
      </StepChrome>
    );
  }

  if (stepId === 'builder') {
    // Builder readiness is computed by use-active-step's dimBuilderLooksValid;
    // we re-check the same shape here so Continue stays in sync without re-
    // importing the helper.
    const b = draft.dimBuilder;
    const ready =
      !!b &&
      ((b.kind === 'banding' && !!b.column && b.bands.length > 0 && !!b.elseLabel) ||
        (b.kind === 'time-since' && !!b.timeColumn) ||
        (b.kind === 'passthrough' && !!b.column) ||
        (b.kind === 'boolean' && !!b.predicate));
    return (
      <StepChrome
        {...chromeBase}
        canContinue={ready}
        continueLabel="Continue to identity"
      >
        <DimBuilderBody
          cube={selectedCube as any}
          dimKind={draft.dimKind}
          value={draft.dimBuilder}
          onChange={(next) => setField('dimBuilder', next)}
        />
      </StepChrome>
    );
  }

  if (stepId === 'filter-tree') {
    return (
      <StepChrome
        {...chromeBase}
        canContinue={!isFilterTreeEmpty(draft.filterTree)}
        continueLabel="Continue to identity"
      >
        <SegmentTreeBody
          cube={selectedCube as any}
          tree={draft.filterTree}
          onChange={(nextTree) => setField('filterTree', nextTree)}
        />
      </StepChrome>
    );
  }

  return (
    <StepChrome
      {...chromeBase}
      canContinue={false}
      continueLabel="Continue"
    >
      <div style={{ padding: 32, color: 'var(--text-muted)' }}>
        Step {stepNumber} body lands in a later phase.
      </div>
    </StepChrome>
  );
}
