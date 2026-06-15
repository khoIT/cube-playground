/**
 * MetricCompositionWizard — `/catalog/metric/new`. Lean 4-step wizard that
 * writes a draft `business-metrics/<id>.yml` via the existing POST endpoint.
 * Submit flow:
 *   1. Validate full draft.
 *   2. POST /api/business-metrics.
 *   3. Invalidate the in-memory registry cache.
 *   4. Navigate to /catalog/metric/<id>.
 *
 * Chrome (header + step pills + footer Cancel/Back/Next/Submit) is provided
 * by `WizardShell` in `src/shared/wizard-shell/`. The legacy `NewMetricPage`
 * keeps its richer rail-preview shell — see the WizardShell docstring for
 * the picker rationale.
 */

import { useMemo, useState } from 'react';
import { Link, useHistory } from 'react-router-dom';
import styled from 'styled-components';

import {
  WizardShell,
  type WizardStep,
} from '../../../shared/wizard-shell/wizard-shell';
import { useConcepts } from '../data-model-tab/use-concepts';
import { __resetBusinessMetricsCache } from '../metrics-tab/use-business-metrics';
import {
  draftToYamlPayload,
  validateDraft,
} from './composition-draft-types';
import {
  StepDenominator,
  StepMetadata,
  StepNumerator,
  StepType,
} from './composition-steps';
import { useCompositionDraft } from './use-composition-draft';

const ErrorStatus = styled.div`
  padding: 8px 12px;
  margin-top: 12px;
  border-radius: 6px;
  background: rgba(239, 68, 68, 0.1);
  color: var(--cat-red-ink);
  font-size: 12px;
`;

const STEPS_FOR_MEASURE = [1, 2, 4] as const;
const STEPS_FOR_RATIO = [1, 2, 3, 4] as const;

const STEP_LABEL: Record<number, string> = {
  1: 'Type',
  2: 'Source / Numerator',
  3: 'Denominator',
  4: 'Metadata',
};

export function MetricCompositionWizard() {
  const { draft, setField, reset } = useCompositionDraft();
  const { concepts } = useConcepts();
  const history = useHistory();
  const [stepIndex, setStepIndex] = useState(0);
  const [query, setQuery] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const stepOrder =
    draft.formulaKind === 'ratio' ? STEPS_FOR_RATIO : STEPS_FOR_MEASURE;
  const currentStep = stepOrder[stepIndex];

  const validation = useMemo(() => validateDraft(draft), [draft]);
  const currentErrors = validation.byStep[currentStep] ?? [];
  const isLastStep = stepIndex === stepOrder.length - 1;

  const wizardSteps: WizardStep[] = stepOrder.map((s) => ({
    id: s,
    label: STEP_LABEL[s],
  }));

  const handleNext = () => {
    if (isLastStep) {
      void handleSubmit();
      return;
    }
    if (currentErrors.length > 0) return;
    setQuery('');
    setStepIndex((i) => Math.min(i + 1, stepOrder.length - 1));
  };

  const handleBack = () => {
    setQuery('');
    setStepIndex((i) => Math.max(i - 1, 0));
  };

  const handleSubmit = async () => {
    if (!validation.ok) return;
    setSubmitting(true);
    setServerError(null);
    try {
      const resp = await fetch('/api/business-metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draftToYamlPayload(draft)),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`HTTP ${resp.status}: ${text}`);
      }
      __resetBusinessMetricsCache();
      reset();
      history.push(`/catalog/metric/${draft.id}`);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const nextDisabled = isLastStep
    ? !validation.ok
    : currentErrors.length > 0;
  const nextDisabledHint = isLastStep && !validation.ok
    ? validation.allErrors.join('; ')
    : undefined;

  return (
    <WizardShell
      title="Compose a metric"
      breadcrumb={
        <>
          <Link to="/catalog">Catalog</Link> · Metrics · New
        </>
      }
      steps={wizardSteps}
      activeStepId={currentStep}
      onCancel={() => history.push('/catalog')}
      onBack={handleBack}
      onNext={handleNext}
      isLastStep={isLastStep}
      backDisabled={stepIndex === 0}
      nextDisabled={nextDisabled}
      nextDisabledHint={nextDisabledHint}
      submitLabel="Create metric"
      submitting={submitting}
      banner={serverError && <ErrorStatus>Submit failed: {serverError}</ErrorStatus>}
    >
      {currentStep === 1 && (
        <StepType draft={draft} setField={setField} errors={currentErrors} />
      )}
      {currentStep === 2 && (
        <StepNumerator
          draft={draft}
          setField={setField}
          errors={currentErrors}
          concepts={concepts}
          query={query}
          onQueryChange={setQuery}
        />
      )}
      {currentStep === 3 && (
        <StepDenominator
          draft={draft}
          setField={setField}
          errors={currentErrors}
          concepts={concepts}
          query={query}
          onQueryChange={setQuery}
        />
      )}
      {currentStep === 4 && (
        <StepMetadata
          draft={draft}
          setField={setField}
          errors={currentErrors}
        />
      )}
    </WizardShell>
  );
}
