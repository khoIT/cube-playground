import { ReactNode } from 'react';
import styled, { css } from 'styled-components';
import { Check } from 'lucide-react';

const Card = styled.button<{ $selected: boolean; $disabled: boolean }>`
  appearance: none;
  text-align: left;
  background: ${(p) => (p.$selected ? 'var(--brand-soft)' : 'var(--bg-card)')};
  border: 1px solid ${(p) => (p.$selected ? 'var(--brand)' : 'var(--border-card)')};
  border-radius: 10px;
  padding: 14px 16px;
  cursor: ${(p) => (p.$disabled ? 'not-allowed' : 'pointer')};
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  transition: border-color 120ms, background-color 120ms;
  ${(p) => !p.$disabled && css`&:hover { border-color: var(--brand); }`}
`;

const Head = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const IconBox = styled.div<{ $selected: boolean }>`
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: ${(p) => (p.$selected ? 'var(--brand)' : 'var(--bg-muted)')};
  color: ${(p) => (p.$selected ? 'var(--text-on-brand)' : 'var(--text-secondary)')};
`;

const Title = styled.div`
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-primary);
`;

const Tagline = styled.div`
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.4;
`;

const Example = styled.div`
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
  background: var(--bg-muted);
  border-radius: 5px;
  padding: 5px 7px;
`;

const Dot = styled.span`
  flex: none;
  margin-left: auto;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--brand);
  color: var(--text-on-brand);
  display: inline-flex;
  align-items: center;
  justify-content: center;
`;

export type DimKindCardProps = {
  selected: boolean;
  disabled?: boolean;
  icon: ReactNode;
  title: string;
  tagline: string;
  example: string;
  onSelect: () => void;
};

export function DimKindCard({ selected, disabled = false, icon, title, tagline, example, onSelect }: DimKindCardProps) {
  return (
    <Card
      type="button"
      role="radio"
      aria-checked={selected}
      aria-disabled={disabled}
      $selected={selected}
      $disabled={disabled}
      onClick={() => !disabled && onSelect()}
    >
      <Head>
        <IconBox $selected={selected}>{icon}</IconBox>
        <Title>{title}</Title>
        {selected && <Dot><Check size={10} strokeWidth={3} /></Dot>}
      </Head>
      <Tagline>{tagline}</Tagline>
      <Example>{example}</Example>
    </Card>
  );
}
