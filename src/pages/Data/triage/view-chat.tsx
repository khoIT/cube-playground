/**
 * Triage view C (conversational): the same decisions rendered as an agent
 * thread. Each open decision is an "agent" turn with inline accept/reject
 * chips; resolved ones collapse to a confirmation line. Right column is the
 * shared live YAML pane. Thin renderer over useOnboardingDraft — resolving here
 * mutates the same shared state as views A and B.
 */
import { ReactElement } from 'react';
import styled from 'styled-components';
import { Bot } from 'lucide-react';
import type { UseOnboardingDraftResult, Decision } from '../use-onboarding-draft';
import { AskAgentBox } from './ask-agent-box';
import { YamlPane, TriageActionBar, pct, rationaleTitle, summariseValidation } from './triage-shared';

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
const Thread = styled.div`
  display: flex;
  flex-direction: column;
  gap: 14px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-lg);
  padding: 16px;
`;
const Turn = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;
const Who = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
`;
const Bubble = styled.div`
  background: var(--bg-muted);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-primary);
`;
const Chips = styled.div`
  display: flex;
  gap: 8px;
  margin-top: 4px;
`;
const Chip = styled.button<{ $tone: 'accept' | 'reject' }>`
  background: ${(p) => (p.$tone === 'accept' ? 'var(--success-ink)' : 'transparent')};
  color: ${(p) => (p.$tone === 'accept' ? 'var(--text-on-brand)' : 'var(--destructive-ink)')};
  border: 1px solid ${(p) => (p.$tone === 'accept' ? 'transparent' : 'var(--destructive-soft)')};
  border-radius: var(--radius-sm);
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 600;
  padding: 6px 12px;
  cursor: pointer;
`;
const Resolved = styled.div`
  font-size: 12.5px;
  color: var(--success-ink);
`;

function bubbleText(d: Decision): string {
  if (d.kind === 'join') return `${d.title} — ${d.detail}. ${pct(d.confidence)} confident.`;
  if (d.field?.role === 'measure')
    return `${d.field.column} looks like a measure. Aggregate as ${(d.field.agg ?? 'SUM').toUpperCase()}? (${pct(d.confidence)} confident)`;
  return `${d.title} ${d.detail}. (${pct(d.confidence)} confident)`;
}

interface Props {
  state: UseOnboardingDraftResult;
  canWrite: boolean;
}

export function ViewChat({ state, canWrite }: Props): ReactElement {
  const { label: validationLabel, ok: validationOk } = summariseValidation(state.validation);

  const open = state.decisions.filter((d) => d.state === 'open');
  const resolved = state.decisions.filter((d) => d.state !== 'open');

  return (
    <Grid>
      <Col>
        <ColHead>
          <Bot size={15} style={{ color: 'var(--brand)' }} aria-hidden />
          Onboarding agent
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
            {open.length} to confirm
          </span>
        </ColHead>

        <Thread>
          <Turn>
            <Who>
              <Bot size={12} /> Agent
            </Who>
            <Bubble>
              Profiled {state.draft?.inference?.cubes.length ?? 0} cube
              {(state.draft?.inference?.cubes.length ?? 0) === 1 ? '' : 's'} · {state.autoMappedCount} fields
              auto-mapped. {open.length} call{open.length === 1 ? '' : 's'} I’m unsure about — let’s clear them.
            </Bubble>
          </Turn>

          {resolved.map((d) => (
            <Turn key={d.id}>
              <Who>
                <Bot size={12} /> Agent
              </Who>
              <Resolved>
                ✓ {d.title} → {d.state}
              </Resolved>
            </Turn>
          ))}

          {open.map((d) => (
            <Turn key={d.id}>
              <Who>
                <Bot size={12} /> Agent
              </Who>
              <Bubble title={rationaleTitle(d)}>{bubbleText(d)}</Bubble>
              {canWrite ? (
                <Chips>
                  <Chip type="button" $tone="accept" onClick={() => state.resolve(d.id, 'accepted')}>
                    {d.kind === 'join' ? 'Confirm join' : 'Yes'}
                  </Chip>
                  <Chip type="button" $tone="reject" onClick={() => state.resolve(d.id, 'rejected')}>
                    {d.kind === 'join' ? 'Not a join' : 'No'}
                  </Chip>
                </Chips>
              ) : null}
            </Turn>
          ))}
        </Thread>

        <AskAgentBox placeholder="Reply to the agent…" submitLabel="Send" />
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
