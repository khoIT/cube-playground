/**
 * MetricCompositionWizard — `/catalog/metric/new`. Lean 4-step wizard that
 * writes a draft `business-metrics/<id>.yml` via the existing POST endpoint.
 * Submit flow:
 *   1. Validate full draft.
 *   2. POST /api/business-metrics.
 *   3. Invalidate the in-memory registry cache.
 *   4. Navigate to /catalog/metric/<id>.
 *
 * WizardShell extraction (per phase doc R4) is deferred — the existing
 * NewMetricPage chrome is a different aesthetic from Compass; merging
 * needs a separate UX pass. Until then both wizards live independently.
 */

import { useMemo, useState } from 'react';
import { Link, useHistory } from 'react-router-dom';
import styled from 'styled-components';

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

const Page = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-app);
`;

const Header = styled.header`
  padding: 18px 24px 12px;
  border-bottom: 1px solid var(--border-card, #e5e5e5);
  background: var(--bg-card, #ffffff);
  display: flex;
  align-items: baseline;
  gap: 12px;
`;

const Title = styled.h1`
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  color: var(--text-primary, #171717);
`;

const Breadcrumb = styled.span`
  font-size: 12px;
  color: var(--text-muted, #737373);

  a {
    color: var(--brand, #f05a22);
    text-decoration: none;
  }
`;

const Steps = styled.div`
  display: flex;
  gap: 8px;
  padding: 12px 24px;
  border-bottom: 1px solid var(--border-card, #e5e5e5);
`;

const Step = styled.span<{ $active: boolean; $complete: boolean }>`
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 12px;
  background: ${(p) =>
    p.$active
      ? 'var(--brand, #f05a22)'
      : p.$complete
      ? 'rgba(240,90,34,0.10)'
      : 'transparent'};
  color: ${(p) =>
    p.$active
      ? 'white'
      : p.$complete
      ? 'var(--brand, #f05a22)'
      : 'var(--text-muted, #737373)'};
  border: 1px solid
    ${(p) =>
      p.$active
        ? 'var(--brand, #f05a22)'
        : 'var(--border-card, #e5e5e5)'};
`;

const Body = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  max-width: 720px;
  width: 100%;
  align-self: center;
`;

const Footer = styled.footer`
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 24px;
  border-top: 1px solid var(--border-card, #e5e5e5);
  background: var(--bg-card, #ffffff);
`;

const Btn = styled.button<{ $primary?: boolean }>`
  height: 36px;
  padding: 0 16px;
  border: 1px solid
    ${(p) => (p.$primary ? 'var(--brand, #f05a22)' : 'var(--border-card, #e5e5e5)')};
  border-radius: 6px;
  background: ${(p) => (p.$primary ? 'var(--brand, #f05a22)' : 'transparent')};
  color: ${(p) => (p.$primary ? 'white' : 'var(--text-primary, #171717)')};
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`;

const Status = styled.div<{ $kind: 'error' | 'info' }>`
  padding: 8px 12px;
  margin-top: 12px;
  border-radius: 6px;
  background: ${(p) =>
    p.$kind === 'error' ? 'rgba(239,68,68,0.10)' : 'rgba(16,185,129,0.10)'};
  color: ${(p) => (p.$kind === 'error' ? '#b91c1c' : '#059669')};
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

  const handleNext = () => {
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

  return (
    <Page>
      <Header>
        <Breadcrumb>
          <Link to="/catalog">Catalog</Link> · Metrics · New
        </Breadcrumb>
        <Title>Compose a metric</Title>
      </Header>
      <Steps>
        {stepOrder.map((s, i) => (
          <Step key={s} $active={i === stepIndex} $complete={i < stepIndex}>
            {i + 1}. {STEP_LABEL[s]}
          </Step>
        ))}
      </Steps>
      <Body>
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
        {serverError && <Status $kind="error">Submit failed: {serverError}</Status>}
      </Body>
      <Footer>
        <Btn onClick={() => history.push('/catalog')}>Cancel</Btn>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn onClick={handleBack} disabled={stepIndex === 0}>
            Back
          </Btn>
          {isLastStep ? (
            <Btn
              $primary
              onClick={handleSubmit}
              disabled={!validation.ok || submitting}
              title={!validation.ok ? validation.allErrors.join('; ') : undefined}
            >
              {submitting ? 'Saving…' : 'Create metric'}
            </Btn>
          ) : (
            <Btn $primary onClick={handleNext} disabled={currentErrors.length > 0}>
              Next →
            </Btn>
          )}
        </div>
      </Footer>
    </Page>
  );
}
