import { useCallback, useState } from 'react';
import { ValidationResult, NewMetricDraft } from '../types';

export type WizardStep = 1 | 2 | 3;

/**
 * Per-step gating: which `NewMetricDraft` fields must be free of validation
 * errors before the user can advance past that step.
 *
 * Step 3 has no required validation gate of its own — Live Preview (P5) drives
 * its UX. The wizard's hard `isValid` check still runs at Define time.
 */
const STEP_FIELDS: Record<WizardStep, (keyof NewMetricDraft)[]> = {
  1: ['sourceCube', 'operation', 'ofMember', 'ofMemberB'],
  2: ['name', 'title'],
  3: [],
};

export interface UseWizardNavigationReturn {
  currentStep: WizardStep;
  canGoBack: boolean;
  canGoNext: boolean;
  goNext: () => void;
  goBack: () => void;
  gotoStep: (step: WizardStep) => void;
  isStepValid: (step: WizardStep) => boolean;
}

/**
 * Step state + per-step validity derived from a full validation result.
 *
 * `canGoNext` blocks Next when the current step has unresolved errors on any
 * of its gating fields. `gotoStep` allows jumping to any *valid* step (used by
 * Stepper number clicks); jumping backwards is always allowed.
 */
export function useWizardNavigation(
  validation: ValidationResult,
): UseWizardNavigationReturn {
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);

  const isStepValid = useCallback(
    (step: WizardStep) => {
      const errors = validation.errors;
      const requiredFields = STEP_FIELDS[step];
      return requiredFields.every((field) => !errors[field]);
    },
    [validation.errors],
  );

  const canGoBack = currentStep > 1;
  const canGoNext = currentStep < 3 && isStepValid(currentStep);

  const goNext = useCallback(() => {
    setCurrentStep((step) => {
      if (step === 3) return step;
      const next = (step + 1) as WizardStep;
      return isStepValid(step) ? next : step;
    });
  }, [isStepValid]);

  const goBack = useCallback(() => {
    setCurrentStep((step) => (step === 1 ? step : ((step - 1) as WizardStep)));
  }, []);

  const gotoStep = useCallback(
    (step: WizardStep) => {
      // Backwards navigation: always allowed.
      // Forwards: only if every intermediate step is valid.
      setCurrentStep((current) => {
        if (step <= current) return step;
        for (let s = current; s < step; s++) {
          if (!isStepValid(s as WizardStep)) return current;
        }
        return step;
      });
    },
    [isStepValid],
  );

  return {
    currentStep,
    canGoBack,
    canGoNext,
    goNext,
    goBack,
    gotoStep,
    isStepValid,
  };
}
