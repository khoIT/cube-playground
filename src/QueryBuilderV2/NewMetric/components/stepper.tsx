import { Fragment } from 'react';
import styled from 'styled-components';
import { Check } from 'lucide-react';
import { WizardStep } from '../hooks/use-wizard-navigation';

export interface StepperItem {
  id: WizardStep;
  label: string;
}

interface StepperProps {
  steps: StepperItem[];
  current: WizardStep;
  isStepValid: (step: WizardStep) => boolean;
  onStepClick: (step: WizardStep) => void;
}

const Row = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px 24px;
`;

const Item = styled.button<{ $active: boolean; $done: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  background: transparent;
  border: 0;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
  color: ${(p) =>
    p.$active
      ? 'var(--brand)'
      : p.$done
        ? 'var(--text-primary)'
        : 'var(--text-muted)'};

  &:hover {
    background: var(--bg-muted);
  }
`;

const Circle = styled.span<{ $active: boolean; $done: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  font-size: 12px;
  font-weight: 600;
  background: ${(p) =>
    p.$active || p.$done ? 'var(--brand)' : 'transparent'};
  color: ${(p) =>
    p.$active || p.$done ? 'var(--text-on-brand)' : 'var(--text-muted)'};
  border: 1px solid
    ${(p) => (p.$active || p.$done ? 'var(--brand)' : 'var(--border-strong)')};
`;

const Label = styled.span`
  font-size: 13px;
  font-weight: 500;
`;

const Connector = styled.span<{ $done: boolean }>`
  width: 32px;
  height: 1px;
  background: ${(p) =>
    p.$done ? 'var(--brand)' : 'var(--border-strong)'};
`;

export function Stepper({ steps, current, isStepValid, onStepClick }: StepperProps) {
  return (
    <Row role="navigation" aria-label="Wizard steps">
      {steps.map((step, idx) => {
        const isActive = step.id === current;
        const isDone = step.id < current;
        const reachable = step.id <= current || isStepValid(current);
        return (
          <Fragment key={step.id}>
            <Item
              type="button"
              $active={isActive}
              $done={isDone}
              aria-current={isActive ? 'step' : undefined}
              disabled={!reachable}
              onClick={() => onStepClick(step.id)}
            >
              <Circle $active={isActive} $done={isDone}>
                {isDone ? <Check size={14} strokeWidth={2.5} /> : step.id}
              </Circle>
              <Label>{step.label}</Label>
            </Item>
            {idx < steps.length - 1 && <Connector $done={isDone} />}
          </Fragment>
        );
      })}
    </Row>
  );
}
