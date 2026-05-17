import { ReactNode } from 'react';
import styled, { css } from 'styled-components';
import { Check } from 'lucide-react';

const Card = styled.button<{ $selected: boolean; $disabled: boolean }>`
  appearance: none;
  text-align: left;
  background: ${(p) => (p.$selected ? 'var(--brand-soft)' : 'var(--bg-card)')};
  border: 1px solid ${(p) => (p.$selected ? 'var(--brand)' : 'var(--border-card)')};
  border-radius: 12px;
  padding: 16px 18px;
  cursor: ${(p) => (p.$disabled ? 'not-allowed' : 'pointer')};
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  transition: border-color 120ms, background-color 120ms, box-shadow 120ms;

  &:hover {
    ${(p) =>
      !p.$disabled &&
      css`
        border-color: var(--brand);
      `}
  }

  ${(p) =>
    p.$selected &&
    css`
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
    `}
`;

const Head = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
`;

const IconBox = styled.div<{ $selected: boolean }>`
  flex: none;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: ${(p) => (p.$selected ? 'var(--brand)' : 'var(--bg-muted)')};
  color: ${(p) => (p.$selected ? 'var(--text-on-brand)' : 'var(--text-secondary)')};
`;

const Title = styled.div`
  font-size: 14.5px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const SelectedDot = styled.span`
  flex: none;
  margin-left: auto;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--brand);
  color: var(--text-on-brand);
  display: inline-flex;
  align-items: center;
  justify-content: center;
`;

const Tagline = styled.div`
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.45;
`;

const Example = styled.div`
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--text-muted);
  background: var(--bg-muted);
  border-radius: 6px;
  padding: 6px 8px;
`;

export type ArtifactKindCardProps = {
  selected: boolean;
  disabled?: boolean;
  icon: ReactNode;
  title: string;
  tagline: string;
  example?: string;
  onSelect: () => void;
};

export function ArtifactKindCard({
  selected,
  disabled = false,
  icon,
  title,
  tagline,
  example,
  onSelect,
}: ArtifactKindCardProps) {
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
        {selected && (
          <SelectedDot>
            <Check size={11} strokeWidth={3} />
          </SelectedDot>
        )}
      </Head>
      <Tagline>{tagline}</Tagline>
      {example && <Example>{example}</Example>}
    </Card>
  );
}
