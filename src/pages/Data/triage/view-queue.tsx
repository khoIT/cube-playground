/**
 * Triage view A (default): decision queue + live YAML. Left column lists the
 * low-confidence calls as resolvable cards (accept / reject, with a per-field
 * rationale tooltip) plus a collapsed "auto-mapped" disclosure for the
 * high-confidence inferences; the ask-agent box sits at the bottom. Right
 * column is the shared live YAML pane with the validate/stage action bar.
 * Pure presentation over useOnboardingDraft — A works standalone.
 */
import { ReactElement } from 'react';
import styled from 'styled-components';
import { AlertTriangle, Check, X } from 'lucide-react';
import { Collapsible } from '../../Settings/coverage-ui';
import type { UseOnboardingDraftResult, Decision } from '../use-onboarding-draft';
import { AskAgentBox } from './ask-agent-box';
import { ConfidencePill, YamlPane, TriageActionBar, pct, rationaleTitle, summariseValidation } from './triage-shared';

const Grid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
  align-items: start;
  @media (max-width: 920px) {
    grid-template-columns: 1fr;
  }
`;
const Col = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;
const ColHead = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
`;
const Card = styled.div<{ $resolved: boolean }>`
  background: var(--bg-card);
  border: 1px solid ${(p) => (p.$resolved ? 'var(--success-soft)' : 'var(--border-card)')};
  border-radius: var(--radius-lg);
  padding: 14px 16px;
  opacity: ${(p) => (p.$resolved ? 0.7 : 1)};
`;
const CardTop = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
`;
const Title = styled.div`
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-primary);
`;
const Detail = styled.div`
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 4px;
`;
const Btns = styled.div`
  display: flex;
  gap: 8px;
  margin-top: 12px;
`;
const AcceptBtn = styled.button<{ $on: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: ${(p) => (p.$on ? 'var(--success-ink)' : 'var(--success-soft)')};
  color: ${(p) => (p.$on ? 'var(--text-on-brand)' : 'var(--success-ink)')};
  border: none;
  border-radius: var(--radius-sm);
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 600;
  padding: 6px 12px;
  cursor: pointer;
`;
const RejectBtn = styled.button<{ $on: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: ${(p) => (p.$on ? 'var(--destructive-ink)' : 'transparent')};
  color: ${(p) => (p.$on ? 'var(--text-on-brand)' : 'var(--destructive-ink)')};
  border: 1px solid ${(p) => (p.$on ? 'transparent' : 'var(--destructive-soft)')};
  border-radius: var(--radius-sm);
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 600;
  padding: 6px 12px;
  cursor: pointer;
`;
const AutoRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 0;
  font-size: 12px;
  border-bottom: 1px solid var(--border-card);
  &:last-child {
    border-bottom: none;
  }
`;
const Mono = styled.code`
  font-family: var(--font-mono, monospace);
  color: var(--text-secondary);
`;

function acceptLabel(d: Decision): string {
  if (d.kind === 'join') return 'Confirm join';
  if (d.field?.role === 'measure') return `Use ${(d.field.agg ?? 'sum').toUpperCase()}`;
  return 'Accept';
}
function rejectLabel(d: Decision): string {
  if (d.kind === 'join') return 'Not a join';
  if (d.field?.role === 'measure') return 'Not a measure';
  return 'Ignore';
}

interface Props {
  state: UseOnboardingDraftResult;
  canWrite: boolean;
}

export function ViewQueue({ state, canWrite }: Props): ReactElement {
  const open = state.decisions.filter((d) => d.state === 'open');
  const resolved = state.decisions.filter((d) => d.state !== 'open');

  const { label: validationLabel, ok: validationOk } = summariseValidation(state.validation);

  return (
    <Grid>
      <Col>
        <ColHead>
          <AlertTriangle size={15} style={{ color: 'var(--warning-ink)' }} aria-hidden />
          Needs your call
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>{open.length} open</span>
        </ColHead>

        {open.length === 0 ? (
          <Card $resolved>
            <Title>All decisions resolved.</Title>
            <Detail>Every ambiguous call has an answer — validate, then stage for approval.</Detail>
          </Card>
        ) : null}

        {open.map((d) => (
          <Card key={d.id} $resolved={false}>
            <CardTop>
              <Title title={rationaleTitle(d)}>{d.title}</Title>
              <ConfidencePill $low title={d.rationale}>
                {pct(d.confidence)} confident
              </ConfidencePill>
            </CardTop>
            <Detail title={d.rationale}>{d.detail}</Detail>
            {canWrite ? (
              <Btns>
                <AcceptBtn type="button" $on={false} onClick={() => state.resolve(d.id, 'accepted')}>
                  <Check size={13} /> {acceptLabel(d)}
                </AcceptBtn>
                <RejectBtn type="button" $on={false} onClick={() => state.resolve(d.id, 'rejected')}>
                  <X size={13} /> {rejectLabel(d)}
                </RejectBtn>
              </Btns>
            ) : null}
          </Card>
        ))}

        {resolved.map((d) => (
          <Card key={d.id} $resolved>
            <CardTop>
              <Title>{d.title}</Title>
              <ConfidencePill $low={false}>{d.state === 'accepted' ? 'accepted' : 'rejected'}</ConfidencePill>
            </CardTop>
            {canWrite ? (
              <Btns>
                <RejectBtn type="button" $on={false} onClick={() => state.resolve(d.id, 'open')}>
                  Reopen
                </RejectBtn>
              </Btns>
            ) : null}
          </Card>
        ))}

        <Collapsible title="Auto-mapped fields" meta={<span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{state.autoMappedCount} · click to audit</span>}>
          {state.draft?.inference?.cubes.flatMap((c) =>
            c.fields
              .filter((f) => f.role === 'primary_key' || f.confidence >= 0.8)
              .map((f) => (
                <AutoRow key={`${c.name}.${f.column}`}>
                  <Mono>{`${c.name}.${f.column}`}</Mono>
                  <span style={{ color: 'var(--text-muted)' }} title={f.rationale}>
                    {f.role} · {pct(f.confidence)}
                  </span>
                </AutoRow>
              )),
          )}
        </Collapsible>

        <AskAgentBox />
      </Col>

      <YamlPane
        yaml={state.yaml}
        fileName={state.draft ? `${state.draft.cubeName}.yml` : 'model.yml'}
        footer={
          <TriageActionBar
            canWrite={canWrite}
            validating={state.validating}
            validationLabel={validationLabel}
            validationOk={validationOk}
            staging={state.staging}
            staged={state.staged}
            openCount={state.openCount}
            onValidate={() => void state.validate()}
            onStage={() => void state.stageForApproval()}
          />
        }
      />
    </Grid>
  );
}
