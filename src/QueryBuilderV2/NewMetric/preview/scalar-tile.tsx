import styled from 'styled-components';

const Tile = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 16px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-card);
`;

const Label = styled.div`
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;

const Value = styled.div<{ $sign: 'positive' | 'negative' | 'neutral' }>`
  font-family: var(--font-sans);
  font-size: 36px;
  font-weight: 600;
  line-height: 1.1;
  color: ${(p) =>
    p.$sign === 'negative'
      ? 'var(--danger)'
      : 'var(--text-primary)'};
`;

interface ScalarTileProps {
  label: string;
  value: number | null;
}

function format(value: number): string {
  if (Number.isFinite(value)) {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
  }
  return String(value);
}

export function ScalarTile({ label, value }: ScalarTileProps) {
  const display = value == null ? '—' : format(value);
  const sign: 'positive' | 'negative' | 'neutral' =
    value == null ? 'neutral' : value < 0 ? 'negative' : 'positive';
  return (
    <Tile>
      <Label>{label}</Label>
      <Value $sign={sign}>{display}</Value>
    </Tile>
  );
}
