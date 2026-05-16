import styled from 'styled-components';
import { Check } from 'lucide-react';
import { StepIndex, STEP_LABELS } from '../hooks/use-active-step';
import { ValidationCard, ValidationItem } from './validation-card';

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
`;

const Hero = styled.div`
  padding: 12px;
  background: linear-gradient(135deg, var(--brand-soft), var(--bg-card));
  border: 1px solid var(--border-card);
  border-radius: 12px;
  margin-bottom: 16px;
`;

const HeroTitle = styled.div`
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary);
`;
const HeroSub = styled.div`
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
`;

const Steps = styled.ol`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const Row = styled.button<{ $active: boolean; $reachable: boolean }>`
  display: flex;
  gap: 10px;
  align-items: flex-start;
  width: 100%;
  background: ${(p) => (p.$active ? 'var(--brand-soft)' : 'transparent')};
  border: 1px solid ${(p) => (p.$active ? 'var(--brand)' : 'transparent')};
  padding: 8px 10px;
  border-radius: 10px;
  cursor: ${(p) => (p.$reachable ? 'pointer' : 'not-allowed')};
  opacity: ${(p) => (p.$reachable ? 1 : 0.5)};
  text-align: left;
  &:hover { background: ${(p) => (p.$active ? 'var(--brand-soft)' : 'var(--bg-muted)')}; }
`;

const Badge = styled.span<{ $done: boolean }>`
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: ${(p) => (p.$done ? 'var(--success)' : 'var(--bg-muted)')};
  color: ${(p) => (p.$done ? 'white' : 'var(--text-secondary)')};
  border-radius: 50%;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
`;

const Name = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
`;
const Sub = styled.div`
  font-size: 11.5px;
  color: var(--text-muted);
  margin-top: 1px;
`;

export type LeftRailProps = {
  step: StepIndex;
  setStep: (s: StepIndex) => void;
  canGoTo: (s: StepIndex) => boolean;
  summaries: Partial<Record<StepIndex, string>>;
  doneFlags: Record<StepIndex, boolean>;
  validation: ValidationItem[];
};

export function LeftRail({ step, setStep, canGoTo, summaries, doneFlags, validation }: LeftRailProps) {
  return (
    <Wrap>
      <Hero>
        <HeroTitle>New metric</HeroTitle>
        <HeroSub>6-step flow · auto-saved to this tab</HeroSub>
      </Hero>
      <Steps>
        {([1, 2, 3, 4, 5, 6] as StepIndex[]).map((i) => {
          const lbl = STEP_LABELS[i];
          const active = i === step;
          const reachable = canGoTo(i);
          const done = doneFlags[i];
          return (
            <li key={i}>
              <Row
                $active={active}
                $reachable={reachable}
                disabled={!reachable}
                onClick={() => reachable && setStep(i)}
              >
                <Badge $done={done}>{done ? <Check size={12} /> : i}</Badge>
                <div>
                  <Name>{lbl.name}</Name>
                  <Sub>{summaries[i] ?? lbl.sub}</Sub>
                </div>
              </Row>
            </li>
          );
        })}
      </Steps>
      <ValidationCard items={validation} />
    </Wrap>
  );
}
