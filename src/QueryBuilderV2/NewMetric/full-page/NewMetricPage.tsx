import { useEffect, useMemo, useState } from 'react';
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
import { computeAutoMetricName } from './hooks/compute-auto-metric-name';
import { OperationDetailRail } from './steps/step-2-operation/operation-detail-rail';
import { ColumnBody } from './steps/step-3-column/column-body';
import { ColumnHealthRail } from './steps/step-3-column/column-health-rail';
import { FiltersBody } from './steps/step-4-filters/filters-body';
import { IdentityBody } from './steps/step-5-identity/identity-body';
import { YamlPreviewRail } from './steps/step-5-identity/yaml-preview-rail';
import { TestRunBody } from './steps/step-6-test-run/test-run-body';

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
  const { draft, setField, clearPersisted } = draftState;
  const { step, setStep, canGoTo, next, back } = useActiveStep(draft);

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
      if (!draft.sourceCube) setField('sourceCube', cubeParam);
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

  const selectedCube = draft.sourceCube && meta
    ? meta.cubes.find((c) => c.name === draft.sourceCube) ?? null
    : null;

  // doneFlags drive the LeftRail badges/chips. We mark a step done as soon as
  // its choice has been recorded in the draft (mirrors the Stitch walkthrough,
  // where prior steps stay ticked when the user navigates back). Step 4
  // (Filters) is optional, so it stays untouched until the user moves past it.
  const doneFlags: Record<StepIndex, boolean> = {
    1: !!draft.sourceCube,
    2: !!draft.operation,
    3: draft.operation === 'count' || !!draft.ofMember,
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
  const columnLeaf = draft.ofMember
    ? draft.ofMember.includes('.')
      ? draft.ofMember.split('.').slice(-1)[0]
      : draft.ofMember
    : null;

  const summaries: Partial<Record<StepIndex, string>> = {
    // Subtext for Source is the cube/view identifier itself (e.g. `mf_users`),
    // not the humanized title — matches the Stitch walkthrough.
    1: draft.sourceCube ?? 'Pick a cube or view',
    2: draft.operation ? opLabel : 'Aggregation type',
    3: columnLeaf ?? (draft.operation === 'count' ? 'count is *' : 'Field to measure'),
    4: 'Where clause',
    5: draft.name || 'Name & format',
    6: 'Verify shape',
  };

  function handleDiscard() {
    Modal.confirm({
      title: 'Discard new metric?',
      content: 'Your in-progress draft will be cleared.',
      okText: 'Discard',
      okType: 'danger',
      cancelText: 'Keep editing',
      onOk: () => {
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
      main={renderStep({ step, draft, meta, loading, error, setField, next, back, selectedCube, tagSuggestions, cubejsApi })}
      rightRail={<RightRail title={`Step ${step} preview`}>
        {step === 1 && <SourcePreviewRail cube={selectedCube} />}
        {step === 2 && <OperationDetailRail cube={selectedCube} operation={draft.operation} />}
        {step === 3 && <ColumnHealthRail cube={selectedCube} column={draft.ofMember} operation={draft.operation} cubeApi={cubejsApi} />}
        {step === 4 && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Cohort funnel arrives in a follow-up. The compiled SQL preview is in the main panel.</div>}
        {step === 5 && <YamlPreviewRail draft={draft} sourceCube={selectedCube} />}
        {step > 5 && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Step {step} preview not implemented yet — coming in later phases.</div>}
      </RightRail>}
    />
  );
}

function renderStep(args: {
  step: StepIndex;
  draft: ReturnType<typeof useNewMetricDraft>['draft'];
  meta: ReturnType<typeof useNewMetricMeta>['meta'];
  loading: boolean;
  error: string | null;
  setField: ReturnType<typeof useNewMetricDraft>['setField'];
  next: () => void;
  back: () => void;
  selectedCube: ReturnType<typeof useNewMetricMeta>['meta'] extends infer T
    ? T extends { cubes: Array<infer C> } ? C | null : null
    : null;
  tagSuggestions: string[];
  cubejsApi: ReturnType<typeof useNewMetricMeta>['cubejsApi'];
}) {
  const { step, draft, meta, loading, error, setField, next, back, selectedCube, tagSuggestions, cubejsApi } = args;

  if (step === 1) {
    return (
      <StepChrome
        step={1}
        canBack={false}
        canContinue={!!draft.sourceCube}
        continueLabel="Continue to operation"
        onBack={back}
        onContinue={next}
      >
        {loading && <div style={{ color: 'var(--text-muted)' }}>Loading sources…</div>}
        {error && <div style={{ color: 'var(--danger)' }}>Failed to load meta: {error}</div>}
        {meta && (
          <SourceBody
            cubes={meta.cubes}
            selectedName={draft.sourceCube}
            onSelect={(name) => setField('sourceCube', name)}
            cubeApi={cubejsApi}
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
    return (
      <StepChrome
        step={3}
        canContinue={!!draft.ofMember}
        continueLabel="Continue to filters"
        onBack={back}
        onContinue={next}
      >
        <ColumnBody
          cube={selectedCube as any}
          operation={draft.operation}
          column={draft.ofMember}
          onSelect={(col) => setField('ofMember', col)}
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
          // When operation changes invalidate previously-picked column.
          // Skip column step entirely for count.
          if (draft.operation === 'count') {
            setField('ofMember', null);
            next(); next(); // Step 4 (filters)
          } else {
            next();
          }
        }}
      >
        <OperationBody
          cube={selectedCube as any}
          operation={draft.operation}
          onSelect={(op) => {
            if (op !== draft.operation) setField('ofMember', null);
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
