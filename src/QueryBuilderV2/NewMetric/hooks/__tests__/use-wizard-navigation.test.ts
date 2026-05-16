import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWizardNavigation } from '../use-wizard-navigation';
import { ValidationResult } from '../../types';

function v(errors: ValidationResult['errors'] = {}): ValidationResult {
  return { isValid: Object.keys(errors).length === 0, errors };
}

describe('useWizardNavigation()', () => {
  it('starts at step 1 with back disabled', () => {
    const { result } = renderHook(() => useWizardNavigation(v()));
    expect(result.current.currentStep).toBe(1);
    expect(result.current.canGoBack).toBe(false);
  });

  it('canGoNext=false on step 1 when sourceCube error present', () => {
    const { result } = renderHook(() =>
      useWizardNavigation(v({ sourceCube: 'Required' })),
    );
    expect(result.current.canGoNext).toBe(false);
  });

  it('canGoNext=true on step 1 when define fields clean', () => {
    const { result } = renderHook(() =>
      useWizardNavigation(v({ name: 'Required', title: 'Required' })),
    );
    // Step-1 fields (sourceCube/operation/ofMember/ofMemberB) have no errors.
    // Step-2 errors (name/title) do NOT block step 1's Next.
    expect(result.current.canGoNext).toBe(true);
  });

  it('goNext advances when current step is valid', () => {
    const { result } = renderHook(() => useWizardNavigation(v()));
    act(() => result.current.goNext());
    expect(result.current.currentStep).toBe(2);
  });

  it('goNext does NOT advance when current step has errors', () => {
    const { result } = renderHook(() =>
      useWizardNavigation(v({ ofMember: 'Required' })),
    );
    act(() => result.current.goNext());
    expect(result.current.currentStep).toBe(1);
  });

  it('goBack returns to previous step', () => {
    const { result } = renderHook(() => useWizardNavigation(v()));
    act(() => result.current.goNext());
    act(() => result.current.goNext());
    expect(result.current.currentStep).toBe(3);
    act(() => result.current.goBack());
    expect(result.current.currentStep).toBe(2);
  });

  it('gotoStep allows backward jump unconditionally', () => {
    const { result } = renderHook(() => useWizardNavigation(v()));
    act(() => result.current.goNext());
    act(() => result.current.goNext());
    act(() => result.current.gotoStep(1));
    expect(result.current.currentStep).toBe(1);
  });

  it('gotoStep forward blocked when intermediate step invalid', () => {
    const { result } = renderHook(() =>
      useWizardNavigation(v({ sourceCube: 'Required' })),
    );
    act(() => result.current.gotoStep(3));
    expect(result.current.currentStep).toBe(1);
  });

  it('isStepValid reflects per-step gating fields', () => {
    const { result } = renderHook(() =>
      useWizardNavigation(v({ name: 'Required' })),
    );
    expect(result.current.isStepValid(1)).toBe(true);
    expect(result.current.isStepValid(2)).toBe(false);
    expect(result.current.isStepValid(3)).toBe(true);
  });

  it('step 3 has no required fields — always valid for navigation', () => {
    const { result } = renderHook(() =>
      useWizardNavigation(v({ ofMember: 'X', name: 'Y', title: 'Z' })),
    );
    expect(result.current.isStepValid(3)).toBe(true);
  });
});
