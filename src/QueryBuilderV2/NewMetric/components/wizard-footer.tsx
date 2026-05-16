import styled from 'styled-components';
import { Button } from '@cube-dev/ui-kit';
import { WizardStep } from '../hooks/use-wizard-navigation';

const Row = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 24px;
  border-top: 1px solid var(--border-card);
  background: var(--bg-card);
`;

const Left = styled.div`
  margin-right: auto;
`;

interface WizardFooterProps {
  currentStep: WizardStep;
  canGoBack: boolean;
  canGoNext: boolean;
  isDefineDisabled: boolean;
  defineLabel: string;
  onCancel: () => void;
  onBack: () => void;
  onNext: () => void;
  onDefine: () => void;
}

/**
 * Cancel + Back + Next/Define footer. Steps 1–2 show Next; step 3 shows
 * Define (the primary CTA). Cancel is always on the left.
 */
export function WizardFooter({
  currentStep,
  canGoBack,
  canGoNext,
  isDefineDisabled,
  defineLabel,
  onCancel,
  onBack,
  onNext,
  onDefine,
}: WizardFooterProps) {
  const isLastStep = currentStep === 3;
  return (
    <Row>
      <Left>
        <Button type="secondary" onPress={onCancel}>
          Cancel
        </Button>
      </Left>

      <Button type="secondary" isDisabled={!canGoBack} onPress={onBack}>
        Back
      </Button>

      {isLastStep ? (
        <Button type="primary" isDisabled={isDefineDisabled} onPress={onDefine}>
          {defineLabel}
        </Button>
      ) : (
        <Button type="primary" isDisabled={!canGoNext} onPress={onNext}>
          Next
        </Button>
      )}
    </Row>
  );
}
