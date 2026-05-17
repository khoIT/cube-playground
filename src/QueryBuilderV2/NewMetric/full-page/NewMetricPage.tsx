import { useEffect, useMemo, useRef, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { Modal, notification } from 'antd';
import { useNewMetricMeta } from '../hooks/use-new-metric-meta';
import { useNewMetricDraft } from '../hooks/use-new-metric-draft';
import { useActiveStep, StepIndex } from './hooks/use-active-step';
import { Shell } from './shell/shell';
import { TopBar } from './shell/top-bar';
import { LeftRail } from './shell/left-rail';
import { RightRail } from './shell/right-rail';
import { StepChrome } from './shell/step-chrome';
import { SourceBody } from './steps/step-1-source/source-body';
import { SourcePreviewRail } from './steps/step-1-source/source-preview-rail';
import { OperationBody } from './steps/step-2-operation/operation-body';
import { computeAutoMetricName, computeAutoMetricTitle } from './hooks/compute-auto-metric-name';
import { findOp, primarySlotIdFor } from './steps/step-2-operation/operations';
import { OperationDetailRail } from './steps/step-2-operation/operation-detail-rail';
import { ColumnBody } from './steps/step-3-column/column-body';
import { ColumnHealthRail } from './steps/step-3-column/column-health-rail';
import { FiltersBody } from './steps/step-4-filters/filters-body';
import { IdentityBody } from './steps/step-5-identity/identity-body';
import { YamlPreviewRail } from './steps/step-5-identity/yaml-preview-rail';
import { TestRunBody } from './steps/step-6-test-run/test-run-body';
import { discardAllPending, sweepStale } from './steps/step-6-test-run/pending-writes';

/**
 * Route component for `/metrics/new`. Mounts the full-page 6-step wizard
 * shell behind `?v=2`. When `?v=2` is absent we render a fallback message —
 * the legacy modal entry point stays accessible from the header button.
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

  const draftState = useNewMetricDraft({ reachableNames });
  const { draft, setField, setInput, toggleSource, setPrimarySource, clearPersisted } = draftState;
  const { step, setStep, canGoTo, next, back } = useActiveStep(draft);

  // Transient pulse flag for Step 1's source picker, raised when the user
  // clicks a source-gated op card in Step 2.
  const [highlightSources, setHighlightSources] = useState(false);
  function pulseSourcesAndBack() {
    setHighlightSources(true);
    back();
    window.setTimeout(() => setHighlightSources(false), 1500);
  }

  // Live auto-fill of name + title from operation/column picks. Each field
  // stays "auto-controlled" while it's empty or still equals the last value
  // this effect wrote; the first manual edit by the user breaks the link and
  // we stop overwriting them.
  const lastAutoNameRef = useRef('');
  const lastAutoTitleRef = useRef('');
  useEffect(() => {
    if (draft.sourceCubes.length === 0 || !draft.operation) return;

    const autoName = computeAutoMetricName(draft);
    if (autoName && autoName !== 'untitled_metric') {
      const nameIsAuto = !draft.name || draft.name === lastAutoNameRef.current;
      if (nameIsAuto && draft.name !== autoName) setField('name', autoName);
      lastAutoNameRef.current = autoName;
    }

    const autoTitle = computeAutoMetricTitle(draft);
    if (autoTitle) {
      const titleIsAuto = !draft.title || draft.title === lastAutoTitleRef.current;
      if (titleIsAuto && draft.title !== autoTitle) setField('title', autoTitle);
      lastAutoTitleRef.current = autoTitle;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.sourceCubes, draft.operation, draft.inputs]);

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
        <h2>New Metric (full-page v2)</h2>
        <p style={{ color: 'var(--text-muted)' }}>
          Append <code>?v=2</code> to this URL to open the full-page wizard.
          The legacy modal is still available from the header.
        </p>
      </div>
    );
  }

  // `primaryCube` powers downstream step rails / summaries. Additional selected
  // cubes (for cross-cube ratio) live in `selectedCubes`.
  const primaryCubeName = draft.sourceCubes[0] ?? null;
  const selectedCube = primaryCubeName && meta
    ? meta.cubes.find((c) => c.name === primaryCubeName) ?? null
    : null;
  const selectedCubes = useMemo(() => {
    if (!meta) return [];
    const byName = new Map(meta.cubes.map((c) => [c.name, c]));
    return draft.sourceCubes
      .map((n) => byName.get(n))
      .filter((c): c is NonNullable<typeof c> => Boolean(c));
  }, [meta, draft.sourceCubes]);

  // doneFlags drive the LeftRail badges/chips. We mark a step done as soon as
  // its choice has been recorded in the draft (mirrors the Stitch walkthrough,
  // where prior steps stay ticked when the user navigates back). Step 4
  // (Filters) is optional, so it stays untouched until the user moves past it.
  // A step is "done" once every required slot for the active op is filled.
  // `count` is the exception: its single slot is optional, so the step
  // counts as done the moment the user moves past it.
  const opDef = findOp(draft.operation);
  const allRequiredSlotsFilled = !!opDef && opDef.inputs.every((s) => !s.required || !!draft.inputs[s.id]);

  const doneFlags: Record<StepIndex, boolean> = {
    1: draft.sourceCubes.length >= 1,
    2: !!draft.operation,
    3: draft.operation === 'count' || allRequiredSlotsFilled,
    4: step > 4,
    5: !!draft.name && !!draft.title,
    6: false,
  };

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

  const summaries: Partial<Record<StepIndex, string>> = {
    1: sourceSummary,
    2: draft.operation ? opLabel : 'Aggregation type',
    3: columnLeaf ?? (draft.operation === 'count' ? 'count is *' : 'Field to measure'),
    4: 'Where clause',
    5: draft.name || 'Name & format',
    6: 'Verify shape',
  };

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

  return (
    <Shell
      topBar={<TopBar onSaveDraft={handleSaveDraft} onDiscard={handleDiscard} />}
      leftRail={
        <LeftRail
          step={step}
          setStep={setStep}
          canGoTo={canGoTo}
          summaries={summaries}
          doneFlags={doneFlags}
          metricName={metricName}
          isAutoName={isAutoName}
        />
      }
      main={renderStep({ step, draft, meta, loading, error, setField, setInput, toggleSource, setPrimarySource, next, back, selectedCube, tagSuggestions, cubejsApi, highlightSources, onRequestBackToSources: pulseSourcesAndBack })}
      rightRail={(() => {
        const rail = rightRailMeta({ step, selectedCube, operation: draft.operation, column: primarySlotValue });
        return (
          <RightRail title={rail.title} subtitle={rail.subtitle}>
            {step === 1 && <SourcePreviewRail cube={selectedCube} />}
            {step === 2 && <OperationDetailRail cube={selectedCube} operation={draft.operation} />}
            {step === 3 && <ColumnHealthRail cube={selectedCube} column={primarySlotValue} operation={draft.operation} cubeApi={cubejsApi} />}
            {step === 4 && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Cohort funnel arrives in a follow-up. The compiled SQL preview is in the main panel.</div>}
            {step === 5 && <YamlPreviewRail draft={draft} sourceCube={selectedCube} />}
            {step > 5 && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Step {step} preview not implemented yet — coming in later phases.</div>}
          </RightRail>
        );
      })()}
    />
  );
}

function rightRailMeta(args: {
  step: StepIndex;
  selectedCube: { name: string; title?: string } | null;
  operation: string | null;
  column: string | null;
}): { title: string; subtitle?: string } {
  const { step, selectedCube, operation, column } = args;
  if (step === 1) {
    return selectedCube
      ? { title: 'Selected source', subtitle: selectedCube.name }
      : { title: 'Source preview', subtitle: 'Pick a source to inspect its schema' };
  }
  if (step === 2) {
    return operation
      ? { title: 'Operation', subtitle: operation }
      : { title: 'Operation preview', subtitle: 'Pick an aggregation to see its formula' };
  }
  if (step === 3) {
    return column
      ? { title: 'Column health', subtitle: column }
      : { title: 'Column preview', subtitle: 'Pick a column to inspect distribution' };
  }
  if (step === 4) return { title: 'Filters preview', subtitle: 'Cohort impact' };
  if (step === 5) return { title: 'YAML preview', subtitle: selectedCube?.name };
  return { title: `Step ${step} preview` };
}

function renderStep(args: {
  step: StepIndex;
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
  selectedCube: ReturnType<typeof useNewMetricMeta>['meta'] extends infer T
    ? T extends { cubes: Array<infer C> } ? C | null : null
    : null;
  tagSuggestions: string[];
  cubejsApi: ReturnType<typeof useNewMetricMeta>['cubejsApi'];
  highlightSources: boolean;
  onRequestBackToSources: () => void;
}) {
  const { step, draft, meta, loading, error, setField, toggleSource, setPrimarySource, next, back, selectedCube, tagSuggestions, cubejsApi, highlightSources, onRequestBackToSources } = args;

  if (step === 1) {
    return (
      <StepChrome
        step={1}
        canBack={false}
        canContinue={draft.sourceCubes.length >= 1}
        continueLabel="Continue to operation"
        onBack={back}
        onContinue={next}
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

  if (step === 6) {
    return (
      <StepChrome
        step={6}
        canContinue={false}
        backLabel="Back to identity"
        onBack={back}
        onContinue={() => { /* handled inside TestRunBody */ }}
      >
        <TestRunBody
          draft={draft}
          sourceCube={selectedCube as any}
          cubejsApi={cubejsApi}
          onSubmitted={() => { /* navigation happens inside body */ }}
        />
      </StepChrome>
    );
  }

  if (step === 5) {
    const valid = !!draft.name && !!draft.title;
    return (
      <StepChrome
        step={5}
        canContinue={valid}
        continueLabel="Continue to test run"
        onBack={back}
        onContinue={next}
      >
        <IdentityBody draft={draft} onField={setField} tagSuggestions={tagSuggestions} />
      </StepChrome>
    );
  }

  if (step === 4) {
    return (
      <StepChrome
        step={4}
        canContinue
        continueLabel="Continue to identity"
        onBack={back}
        onContinue={next}
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
          onChange={(next) => setField('filterTree', next)}
        />
      </StepChrome>
    );
  }

  if (step === 3) {
    const op = findOp(draft.operation);
    const allRequiredFilled = !op || op.inputs.every((slot) => !slot.required || !!draft.inputs[slot.id]);
    const wizardCubes = (meta?.cubes ?? []).filter((c) => draft.sourceCubes.includes(c.name));
    return (
      <StepChrome
        step={3}
        canContinue={allRequiredFilled}
        continueLabel="Continue to filters"
        onBack={back}
        onContinue={next}
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

  if (step === 2) {
    const continueLabel = draft.operation === 'count' ? 'Skip column — count is *' : 'Pick column';
    return (
      <StepChrome
        step={2}
        canContinue={!!draft.operation}
        continueLabel={continueLabel}
        onBack={back}
        onContinue={() => {
          // Count's slot is optional → skip Step 3 straight to filters.
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

  return (
    <StepChrome
      step={step}
      canContinue={false}
      continueLabel="Continue"
      onBack={back}
      onContinue={next}
    >
      <div style={{ padding: 32, color: 'var(--text-muted)' }}>
        Step {step} body lands in a later phase.
      </div>
    </StepChrome>
  );
}
