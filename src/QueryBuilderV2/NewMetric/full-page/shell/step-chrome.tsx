import { ReactNode } from 'react';
import styled from 'styled-components';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { StepIndex, STEP_LABELS } from '../hooks/use-active-step';

const HeaderBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 24px 8px;
  border-bottom: 1px solid var(--border-card);
  background: var(--bg-app);
`;

const TitleGroup = styled.div`
  display: flex;
  flex-direction: column;
`;
const StepNum = styled.div`
  font-size: 11.5px;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--text-muted);
`;
const Title = styled.div`
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
`;
const Sub = styled.div`
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 2px;
`;

const Actions = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
`;

const Body = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
`;

const FooterBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  border-top: 1px solid var(--border-card);
  background: var(--bg-card);
`;

const FootInfo = styled.div`
  font-size: 13px;
  color: var(--text-secondary);
`;

const NavGroup = styled.div`
  display: flex;
  gap: 8px;
`;

const NavBtn = styled.button<{ $primary?: boolean; $disabled?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 36px;
  padding: 0 14px;
  border-radius: 8px;
  font-size: 13.5px;
  font-weight: 500;
  cursor: ${(p) => (p.$disabled ? 'not-allowed' : 'pointer')};
  opacity: ${(p) => (p.$disabled ? 0.5 : 1)};
  border: 1px solid ${(p) => (p.$primary ? 'var(--brand)' : 'var(--border-card)')};
  background: ${(p) => (p.$primary ? 'var(--brand)' : 'var(--bg-card)')};
  color: ${(p) => (p.$primary ? 'var(--text-on-brand)' : 'var(--text-primary)')};
  &:hover { background: ${(p) => (p.$primary ? 'var(--brand-hover)' : 'var(--bg-muted)')}; }
`;

export type StepChromeProps = {
  step: StepIndex;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  backLabel?: string;
  continueLabel?: string;
  canBack?: boolean;
  canContinue: boolean;
  onBack: () => void;
  onContinue: () => void;
  extraFooter?: ReactNode;
};

export function StepChrome(p: StepChromeProps) {
  const lbl = STEP_LABELS[p.step];
  return (
    <>
      <HeaderBar>
        <TitleGroup>
          <StepNum>Step {p.step} of 6</StepNum>
          <Title>{lbl.name}</Title>
          <Sub>{p.subtitle ?? lbl.sub}</Sub>
        </TitleGroup>
        <Actions>{p.actions}</Actions>
      </HeaderBar>
      <Body>{p.children}</Body>
      <FooterBar>
        <FootInfo>Step {p.step} of 6 · {lbl.name}</FootInfo>
        <NavGroup>
          {p.extraFooter}
          <NavBtn
            $disabled={!(p.canBack ?? true)}
            onClick={() => (p.canBack ?? true) && p.onBack()}
          >
            <ChevronLeft size={14} /> {p.backLabel ?? 'Back'}
          </NavBtn>
          <NavBtn
            $primary
            $disabled={!p.canContinue}
            onClick={() => p.canContinue && p.onContinue()}
          >
            {p.continueLabel ?? 'Continue'} <ChevronRight size={14} />
          </NavBtn>
        </NavGroup>
      </FooterBar>
    </>
  );
}
