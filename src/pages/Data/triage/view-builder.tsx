/**
 * Triage view D — guided step-by-step model builder. A thin renderer over the
 * shared useOnboardingDraft engine: walks the DA through Cube → Dimensions →
 * Measures → Joins → Preview, with inference defaults pre-filled and confidence
 * shown. YAML is the COMPILED OUTPUT at the final step (preview + validate +
 * stage), never the editing surface. Auto-mapped (high-confidence) fields show
 * as included ✓; only ambiguous calls present accept/skip. Reuses triage-shared
 * primitives + the stepper feel of the metric-composition-wizard.
 */
import { ReactElement, useMemo, useState } from 'react';
import styled from 'styled-components';
import { Boxes, Ruler, Sigma, Link2, FileCode2, Check, X, KeyRound, ArrowRight, ArrowLeft } from 'lucide-react';
import type { UseOnboardingDraftResult, Decision } from '../use-onboarding-draft';
import { ConfidencePill, pct, YamlPane, TriageActionBar, summariseValidation, rationaleTitle } from './triage-shared';
import type { InferredField } from '../../../api/onboarding-client';

const STEPS = [
  { id: 'cube', label: 'Cube', icon: Boxes },
  { id: 'dimensions', label: 'Dimensions', icon: Ruler },
  { id: 'measures', label: 'Measures', icon: Sigma },
  { id: 'joins', label: 'Joins', icon: Link2 },
  { id: 'preview', label: 'Preview', icon: FileCode2 },
] as const;
type StepId = (typeof STEPS)[number]['id'];

const Stepper = styled.div`
  display: flex;
  gap: 6px;
  margin-bottom: 18px;
  flex-wrap: wrap;
`;
const Step = styled.button<{ $active: boolean; $done: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 13px;
  border-radius: var(--radius-pill);
  border: 1px solid ${(p) => (p.$active ? 'transparent' : 'var(--border-card)')};
  background: ${(p) => (p.$active ? 'var(--brand)' : p.$done ? 'var(--success-soft)' : 'var(--bg-card)')};
  color: ${(p) => (p.$active ? 'var(--text-on-brand, #fff)' : p.$done ? 'var(--success-ink)' : 'var(--text-secondary)')};
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
`;
const Panel = styled.div`
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-lg);
  padding: 18px 20px;
`;
const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 0;
  border-bottom: 1px solid var(--border-card);
  &:last-child { border-bottom: none; }
`;
const Name = styled.span`
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
`;
const Type = styled.span`
  font-size: 11px;
  color: var(--text-muted);
`;
const Spacer = styled.span`flex: 1;`;
const Mapped = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--success-ink);
`;
const Btn = styled.button<{ $tone: 'accept' | 'skip'; $on: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 11px;
  border-radius: var(--radius-sm);
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid var(--border-card);
  background: ${(p) => (!p.$on ? 'var(--bg-app)' : p.$tone === 'accept' ? 'var(--success-soft)' : 'var(--destructive-soft)')};
  color: ${(p) => (!p.$on ? 'var(--text-secondary)' : p.$tone === 'accept' ? 'var(--success-ink)' : 'var(--destructive-ink)')};
`;
const Nav = styled.div`
  display: flex;
  gap: 10px;
  margin-top: 16px;
`;
const NavBtn = styled.button<{ $primary?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: var(--radius-sm);
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: ${(p) => (p.$primary ? 'none' : '1px solid var(--border-card)')};
  background: ${(p) => (p.$primary ? 'var(--brand)' : 'var(--bg-card)')};
  color: ${(p) => (p.$primary ? 'var(--text-on-brand, #fff)' : 'var(--text-secondary)')};
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const Hint = styled.p`
  margin: 0 0 12px;
  font-size: 12.5px;
  color: var(--text-muted);
`;
const Empty = styled.p`font-size: 13px; color: var(--text-muted); padding: 8px 0;`;

interface Props {
  state: UseOnboardingDraftResult;
  canWrite: boolean;
}

export function ViewBuilder({ state, canWrite }: Props): ReactElement {
  const [step, setStep] = useState<StepId>('cube');
  const cube = state.draft?.inference?.cubes[0] ?? null;
  const decisionById = useMemo(() => {
    const m = new Map<string, Decision>();
    for (const d of state.decisions) m.set(d.id, d);
    return m;
  }, [state.decisions]);

  if (!cube) return <Empty>Loading model…</Empty>;

  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const fieldsByRole = (roles: InferredField['role'][]) => cube.fields.filter((f) => roles.includes(f.role));

  function fieldRow(f: InferredField): ReactElement {
    const id = `${cube!.name}.${f.column}`;
    const decision = decisionById.get(id);
    return (
      <Row key={id}>
        {f.role === 'primary_key' ? <KeyRound size={13} style={{ color: 'var(--brand)' }} aria-label="primary key" /> : null}
        <Name>{f.column}</Name>
        <Type>{f.dataType}{f.agg ? ` · ${f.agg.toUpperCase()}` : ''}</Type>
        <Spacer />
        {decision ? (
          <>
            <ConfidencePill $low title={rationaleTitle(decision)}>{pct(decision.confidence)}</ConfidencePill>
            <Btn $tone="accept" $on={decision.state === 'accepted'} type="button" disabled={!canWrite}
              onClick={() => state.resolve(id, 'accepted')}><Check size={12} /> Include</Btn>
            <Btn $tone="skip" $on={decision.state === 'rejected'} type="button" disabled={!canWrite}
              onClick={() => state.resolve(id, 'rejected')}><X size={12} /> Skip</Btn>
          </>
        ) : (
          <Mapped><Check size={12} /> auto-mapped</Mapped>
        )}
      </Row>
    );
  }

  function joinRow(): ReactElement[] {
    return cube!.joins.map((j) => {
      const id = `${cube!.name}.join.${j.toCube}`;
      const decision = decisionById.get(id);
      return (
        <Row key={id}>
          <Name>{j.toCube}</Name>
          <Type>{j.relationship} · {j.fromColumn} → {j.toColumn}</Type>
          <Spacer />
          {decision ? (
            <>
              <ConfidencePill $low title={rationaleTitle(decision)}>{pct(decision.confidence)}</ConfidencePill>
              <Btn $tone="accept" $on={decision.state === 'accepted'} type="button" disabled={!canWrite}
                onClick={() => state.resolve(id, 'accepted')}><Check size={12} /> Keep</Btn>
              <Btn $tone="skip" $on={decision.state === 'rejected'} type="button" disabled={!canWrite}
                onClick={() => state.resolve(id, 'rejected')}><X size={12} /> Drop</Btn>
            </>
          ) : (
            <Mapped><Check size={12} /> auto-mapped</Mapped>
          )}
        </Row>
      );
    });
  }

  const validation = summariseValidation(state.validation);

  return (
    <>
      <Stepper role="tablist" aria-label="Model builder steps">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          return (
            <Step key={s.id} type="button" role="tab" aria-selected={step === s.id}
              $active={step === s.id} $done={i < stepIndex} onClick={() => setStep(s.id)}>
              <Icon size={13} /> {i + 1}. {s.label}
            </Step>
          );
        })}
      </Stepper>

      <Panel>
        {step === 'cube' ? (
          <>
            <Hint>The cube’s identity, inferred from the table. The primary key is auto-detected from uniqueness profiling.</Hint>
            <Row><Boxes size={14} style={{ color: 'var(--brand)' }} /><Name>{cube.name}</Name><Type>sql_table: {cube.sqlTable}</Type></Row>
            <Row><KeyRound size={14} style={{ color: 'var(--brand)' }} /><Name>Primary key</Name><Type>{cube.primaryKey || '—'}</Type></Row>
          </>
        ) : step === 'dimensions' ? (
          <>
            <Hint>Descriptive columns. High-confidence ones are auto-mapped; confirm the rest.</Hint>
            {fieldsByRole(['dimension', 'time', 'primary_key']).map(fieldRow)}
          </>
        ) : step === 'measures' ? (
          <>
            <Hint>Numeric columns to aggregate. The suggested aggregation is pre-filled.</Hint>
            {fieldsByRole(['measure']).length ? fieldsByRole(['measure']).map(fieldRow) : <Empty>No measures inferred — Cube adds a default count.</Empty>}
          </>
        ) : step === 'joins' ? (
          <>
            <Hint>Relationships to other cubes (foreign-key candidates from profiling).</Hint>
            {cube.joins.length ? joinRow() : <Empty>No joins inferred for this cube.</Empty>}
          </>
        ) : (
          <>
            <Hint>The compiled YAML — the end result. Validate against live Cube, then stage for approval.</Hint>
            <YamlPane
              yaml={state.yaml}
              fileName={`${cube.name}.yml`}
              footer={
                <TriageActionBar
                  canWrite={canWrite}
                  validating={state.validating}
                  validationLabel={validation.label}
                  validationOk={validation.ok}
                  staging={state.staging}
                  staged={state.staged}
                  openCount={state.openCount}
                  onValidate={state.validate}
                  onStage={state.stageForApproval}
                />
              }
            />
          </>
        )}

        <Nav>
          <NavBtn type="button" disabled={stepIndex === 0} onClick={() => setStep(STEPS[Math.max(0, stepIndex - 1)].id)}>
            <ArrowLeft size={14} /> Back
          </NavBtn>
          {stepIndex < STEPS.length - 1 ? (
            <NavBtn $primary type="button" onClick={() => setStep(STEPS[stepIndex + 1].id)}>
              Next <ArrowRight size={14} />
            </NavBtn>
          ) : null}
          {step !== 'preview' && state.openCount > 0 ? (
            <span style={{ alignSelf: 'center', fontSize: 12, color: 'var(--warning-ink)' }}>
              {state.openCount} decision{state.openCount === 1 ? '' : 's'} still open
            </span>
          ) : null}
        </Nav>
      </Panel>
    </>
  );
}
