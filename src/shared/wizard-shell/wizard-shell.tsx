/**
 * WizardShell — Compass-styled wizard chrome (header / pill steps / body /
 * footer). Used by lightweight, consumer-facing wizards such as the metric
 * composition wizard.
 *
 * Heavyweight author-side wizards (e.g. `NewMetricPage` with cube source /
 * SQL preview / cohort filter trees) keep their own `Shell + LeftRail +
 * RightRail + StepChrome` because the rail-preview pattern requires
 * different layout primitives. Pick this shell when steps are short and
 * the surface is consumer-facing; pick `NewMetricPage`'s shell when each
 * step needs a live preview rail.
 */

import type { ReactNode } from 'react';
import styled from 'styled-components';

export interface WizardStep {
  /** Stable id used for keys + active-step matching. */
  id: number | string;
  /** Pill label rendered in the header step strip. */
  label: string;
}

export interface WizardShellProps {
  title: string;
  breadcrumb?: ReactNode;
  steps: ReadonlyArray<WizardStep>;
  activeStepId: WizardStep['id'];
  /** Step body. */
  children: ReactNode;
  /** Optional banner below body (errors, hints). */
  banner?: ReactNode;

  // Footer navigation
  onCancel: () => void;
  onBack: () => void;
  onNext: () => void;
  /** When true, replaces "Next" with the primary submit action. */
  isLastStep: boolean;
  /** Disabled state for Back (typically true on first step). */
  backDisabled?: boolean;
  /** Disabled state for Next/Submit (validation gate). */
  nextDisabled?: boolean;
  /** Optional tooltip for Next/Submit when disabled. */
  nextDisabledHint?: string;
  /** Label override for the submit action on the last step. */
  submitLabel?: string;
  /** Submitting flag toggles the submit button into a busy state. */
  submitting?: boolean;
}

const Page = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-app);
`;

const Header = styled.header`
  padding: 18px 24px 12px;
  border-bottom: 1px solid var(--border-card);
  background: var(--bg-card);
  display: flex;
  align-items: baseline;
  gap: 12px;
`;

const Title = styled.h1`
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  color: var(--text-primary);
`;

const Breadcrumb = styled.span`
  font-size: 12px;
  color: var(--text-muted);

  a {
    color: var(--brand);
    text-decoration: none;
  }
`;

const Steps = styled.div`
  display: flex;
  gap: 8px;
  padding: 12px 24px;
  border-bottom: 1px solid var(--border-card);
`;

const Step = styled.span<{ $active: boolean; $complete: boolean }>`
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 12px;
  background: ${(p) =>
    p.$active
      ? 'var(--brand)'
      : p.$complete
      ? 'rgba(240,90,34,0.10)'
      : 'transparent'};
  color: ${(p) =>
    p.$active
      ? 'white'
      : p.$complete
      ? 'var(--brand)'
      : 'var(--text-muted)'};
  border: 1px solid
    ${(p) =>
      p.$active
        ? 'var(--brand)'
        : 'var(--border-card)'};
`;

const Body = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  max-width: 720px;
  width: 100%;
  align-self: center;
`;

const Footer = styled.footer`
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 24px;
  border-top: 1px solid var(--border-card);
  background: var(--bg-card);
`;

const NavGroup = styled.div`
  display: flex;
  gap: 8px;
`;

const Btn = styled.button<{ $primary?: boolean }>`
  height: 36px;
  padding: 0 16px;
  border: 1px solid
    ${(p) => (p.$primary ? 'var(--brand)' : 'var(--border-card)')};
  border-radius: 6px;
  background: ${(p) => (p.$primary ? 'var(--brand)' : 'transparent')};
  color: ${(p) => (p.$primary ? 'white' : 'var(--text-primary)')};
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`;

export function WizardShell({
  title,
  breadcrumb,
  steps,
  activeStepId,
  children,
  banner,
  onCancel,
  onBack,
  onNext,
  isLastStep,
  backDisabled = false,
  nextDisabled = false,
  nextDisabledHint,
  submitLabel = 'Submit',
  submitting = false,
}: WizardShellProps) {
  const activeIndex = steps.findIndex((s) => s.id === activeStepId);

  return (
    <Page>
      <Header>
        {breadcrumb && <Breadcrumb>{breadcrumb}</Breadcrumb>}
        <Title>{title}</Title>
      </Header>
      <Steps>
        {steps.map((s, i) => (
          <Step key={s.id} $active={i === activeIndex} $complete={i < activeIndex}>
            {i + 1}. {s.label}
          </Step>
        ))}
      </Steps>
      <Body>
        {children}
        {banner}
      </Body>
      <Footer>
        <Btn type="button" onClick={onCancel}>
          Cancel
        </Btn>
        <NavGroup>
          <Btn type="button" onClick={onBack} disabled={backDisabled}>
            Back
          </Btn>
          {isLastStep ? (
            <Btn
              type="button"
              $primary
              onClick={onNext}
              disabled={nextDisabled || submitting}
              title={nextDisabled ? nextDisabledHint : undefined}
            >
              {submitting ? 'Saving…' : submitLabel}
            </Btn>
          ) : (
            <Btn
              type="button"
              $primary
              onClick={onNext}
              disabled={nextDisabled}
              title={nextDisabled ? nextDisabledHint : undefined}
            >
              Next →
            </Btn>
          )}
        </NavGroup>
      </Footer>
    </Page>
  );
}
