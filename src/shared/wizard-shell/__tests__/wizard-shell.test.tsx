/**
 * Behavioral tests for WizardShell — keep these focused on the shell's
 * contract (step rendering, footer disabled/submitting states), not the
 * styling.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WizardShell } from '../wizard-shell';

const STEPS = [
  { id: 1, label: 'Type' },
  { id: 2, label: 'Source' },
  { id: 3, label: 'Metadata' },
];

function noop() {
  /* */
}

describe('WizardShell', () => {
  it('renders steps with active + complete markers', () => {
    render(
      <WizardShell
        title="Compose"
        steps={STEPS}
        activeStepId={2}
        onCancel={noop}
        onBack={noop}
        onNext={noop}
        isLastStep={false}
      >
        <div>body</div>
      </WizardShell>,
    );
    expect(screen.getByText(/Compose/)).toBeTruthy();
    expect(screen.getByText(/1\. Type/)).toBeTruthy();
    expect(screen.getByText(/2\. Source/)).toBeTruthy();
    expect(screen.getByText(/3\. Metadata/)).toBeTruthy();
    expect(screen.getByText(/body/)).toBeTruthy();
  });

  it('shows Next on non-last step', () => {
    render(
      <WizardShell
        title="x"
        steps={STEPS}
        activeStepId={1}
        onCancel={noop}
        onBack={noop}
        onNext={noop}
        isLastStep={false}
      >
        <div />
      </WizardShell>,
    );
    expect(screen.getByText(/Next/)).toBeTruthy();
  });

  it('shows submitLabel on last step + becomes Saving… while submitting', () => {
    const { rerender } = render(
      <WizardShell
        title="x"
        steps={STEPS}
        activeStepId={3}
        onCancel={noop}
        onBack={noop}
        onNext={noop}
        isLastStep
        submitLabel="Create metric"
      >
        <div />
      </WizardShell>,
    );
    expect(screen.getByText('Create metric')).toBeTruthy();

    rerender(
      <WizardShell
        title="x"
        steps={STEPS}
        activeStepId={3}
        onCancel={noop}
        onBack={noop}
        onNext={noop}
        isLastStep
        submitLabel="Create metric"
        submitting
      >
        <div />
      </WizardShell>,
    );
    expect(screen.getByText('Saving…')).toBeTruthy();
  });

  it('disables Next when nextDisabled true; clicking does not call onNext', () => {
    const onNext = vi.fn();
    render(
      <WizardShell
        title="x"
        steps={STEPS}
        activeStepId={1}
        onCancel={noop}
        onBack={noop}
        onNext={onNext}
        isLastStep={false}
        nextDisabled
      >
        <div />
      </WizardShell>,
    );
    const btn = screen.getByText(/Next/);
    fireEvent.click(btn);
    expect(onNext).not.toHaveBeenCalled();
  });

  it('fires onBack / onCancel / onNext when their buttons are clicked', () => {
    const onCancel = vi.fn();
    const onBack = vi.fn();
    const onNext = vi.fn();
    render(
      <WizardShell
        title="x"
        steps={STEPS}
        activeStepId={2}
        onCancel={onCancel}
        onBack={onBack}
        onNext={onNext}
        isLastStep={false}
      >
        <div />
      </WizardShell>,
    );
    fireEvent.click(screen.getByText('Cancel'));
    fireEvent.click(screen.getByText('Back'));
    fireEvent.click(screen.getByText(/Next/));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});
