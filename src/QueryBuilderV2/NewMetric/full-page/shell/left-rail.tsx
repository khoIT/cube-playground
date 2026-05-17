import styled, { css } from 'styled-components';
import { Check, HelpCircle, Save, X } from 'lucide-react';
import { StepIndex, STEP_LABELS } from '../hooks/use-active-step';

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 18px;
  height: 100%;
`;

const HeroBlock = styled.div`
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border-card);
`;

const HeroLabel = styled.div`
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 6px;
`;

const HeroTitle = styled.div`
  font-family: var(--font-mono);
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.01em;
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const HeroSub = styled.div`
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--text-muted);
  margin-top: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const StepsLabel = styled.div`
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
`;

const Steps = styled.ol`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const Row = styled.button<{ $active: boolean; $reachable: boolean }>`
  appearance: none;
  display: flex;
  gap: 12px;
  align-items: center;
  width: 100%;
  background: transparent;
  border: 1px solid transparent;
  padding: 10px 12px;
  border-radius: 12px;
  cursor: ${(p) => (p.$reachable ? 'pointer' : 'not-allowed')};
  opacity: ${(p) => (p.$reachable ? 1 : 0.55)};
  text-align: left;
  transition: border-color 120ms, background-color 120ms, box-shadow 120ms;

  &:hover {
    background: ${(p) => (p.$reachable ? 'var(--bg-card)' : 'transparent')};
  }

  ${(p) =>
    p.$active &&
    css`
      border-color: var(--orange-200);
      background: var(--bg-card);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
    `}
`;

const Badge = styled.span<{ $tone: 'done' | 'active' | 'pending' }>`
  flex: none;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 700;

  ${(p) => {
    if (p.$tone === 'done') {
      return css`
        background: var(--brand);
        color: #fff;
        border: 1px solid var(--brand);
      `;
    }
    if (p.$tone === 'active') {
      return css`
        background: var(--brand-soft);
        color: var(--brand);
        border: 1px solid var(--orange-200);
      `;
    }
    return css`
      background: transparent;
      color: var(--text-muted);
      border: 1px solid var(--border-card);
    `;
  }}
`;

const StepBody = styled.div`
  flex: 1;
  min-width: 0;
`;

const Name = styled.div`
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-primary);
`;

const Sub = styled.div`
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--text-muted);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

// Footer holds the wizard's top-level actions (save / help / discard).
// Pushed to the bottom of the rail via `margin-top: auto` so the rail can
// grow with the step list while keeping the destructive Discard action far
// from the step nav.
const Footer = styled.div`
  margin-top: auto;
  padding-top: 16px;
  border-top: 1px solid var(--border-card);
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const FooterBtn = styled.button<{ $variant?: 'danger' }>`
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid var(--border-card);
  background: var(--bg-card);
  color: var(--text-secondary);
  transition: background-color 120ms, color 120ms, border-color 120ms;

  &:hover {
    background: var(--bg-muted);
  }

  ${(p) =>
    p.$variant === 'danger' &&
    css`
      color: var(--danger);
      border-color: rgba(239, 68, 68, 0.3);
    `}
`;

export type LeftRailProps = {
  step: StepIndex;
  setStep: (s: StepIndex) => void;
  canGoTo: (s: StepIndex) => boolean;
  summaries: Partial<Record<StepIndex, string>>;
  doneFlags: Record<StepIndex, boolean>;
  metricName: string;
  isAutoName: boolean;
  onSaveDraft: () => void;
  onDiscard: () => void;
};

export function LeftRail({
  step,
  setStep,
  canGoTo,
  summaries,
  doneFlags,
  metricName,
  isAutoName,
  onSaveDraft,
  onDiscard,
}: LeftRailProps) {
  return (
    <Wrap>
      <HeroBlock>
        <HeroLabel>Defining</HeroLabel>
        <HeroTitle title={metricName}>{metricName}</HeroTitle>
        <HeroSub title={metricName}>
          {metricName}
          {isAutoName ? ' (auto)' : ''}
        </HeroSub>
      </HeroBlock>

      <StepsLabel>Steps</StepsLabel>
      <Steps>
        {([1, 2, 3, 4, 5, 6] as StepIndex[]).map((i) => {
          const lbl = STEP_LABELS[i];
          const active = i === step;
          const reachable = canGoTo(i);
          const done = doneFlags[i];
          const tone: 'done' | 'active' | 'pending' = done ? 'done' : active ? 'active' : 'pending';
          const subtext = summaries[i] ?? lbl.sub;
          return (
            <li key={i}>
              <Row
                $active={active}
                $reachable={reachable}
                disabled={!reachable}
                onClick={() => reachable && setStep(i)}
              >
                <Badge $tone={tone}>{done ? <Check size={14} strokeWidth={3} /> : i}</Badge>
                <StepBody>
                  <Name>{lbl.name}</Name>
                  <Sub>{subtext}</Sub>
                </StepBody>
              </Row>
            </li>
          );
        })}
      </Steps>

      <Footer>
        <FooterBtn onClick={onSaveDraft} title="Save draft">
          <Save size={14} /> Save draft
        </FooterBtn>
        <FooterBtn type="button" title="Help">
          <HelpCircle size={14} /> Help
        </FooterBtn>
        <FooterBtn $variant="danger" onClick={onDiscard} title="Discard">
          <X size={14} /> Discard
        </FooterBtn>
      </Footer>
    </Wrap>
  );
}
