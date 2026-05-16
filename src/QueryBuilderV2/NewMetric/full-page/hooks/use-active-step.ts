import { useMemo, useState } from 'react';
import type { NewMetricDraftV2 } from '../../types';
import { findOp } from '../steps/step-2-operation/operations';

function hasAllRequiredInputs(draft: NewMetricDraftV2): boolean {
  const op = findOp(draft.operation);
  if (!op) return false;
  return op.inputs.every((slot) => !slot.required || !!draft.inputs[slot.id]);
}

export type StepIndex = 1 | 2 | 3 | 4 | 5 | 6;

export const STEP_LABELS: Record<StepIndex, { name: string; sub?: string }> = {
  1: { name: 'Source' },
  2: { name: 'Operation', sub: 'Aggregation type' },
  3: { name: 'Column', sub: 'Field to measure' },
  4: { name: 'Filters', sub: 'Narrow rows (optional)' },
  5: { name: 'Identity', sub: 'Name & format' },
  6: { name: 'Test run', sub: 'Run on real data' },
};

/**
 * Active-step manager. Returns current step + navigation helpers.
 *
 * Derives the highest "completable" step from the draft so users can navigate
 * back to a fully-filled prior step even after a hard reload.
 */
export function useActiveStep(draft: NewMetricDraftV2): {
  step: StepIndex;
  setStep: (s: StepIndex) => void;
  canGoTo: (s: StepIndex) => boolean;
  next: () => void;
  back: () => void;
} {
  const [step, setStep] = useState<StepIndex>(() => deriveInitialStep(draft));

  const canGoTo = useMemo(() => {
    return (target: StepIndex) => {
      if (target === 1) return true;
      if (target >= 2 && draft.sourceCubes.length < 1) return false;
      if (target >= 3 && !draft.operation) return false;
      if (target >= 4 && !hasAllRequiredInputs(draft)) return false;
      if (target >= 6 && (!draft.name || !draft.title)) return false;
      return true;
    };
  }, [draft]);

  function next() {
    setStep((s) => (s < 6 ? ((s + 1) as StepIndex) : s));
  }
  function back() {
    setStep((s) => (s > 1 ? ((s - 1) as StepIndex) : s));
  }

  return { step, setStep, canGoTo, next, back };
}

function deriveInitialStep(draft: NewMetricDraftV2): StepIndex {
  if (draft.sourceCubes.length === 0) return 1;
  if (!draft.operation) return 2;
  if (!hasAllRequiredInputs(draft)) return 3;
  if (!draft.name || !draft.title) return 5;
  return 6;
}
