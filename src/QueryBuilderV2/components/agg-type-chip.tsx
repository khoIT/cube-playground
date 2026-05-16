import styled from 'styled-components';

interface AggTypeChipProps {
  aggType?: string;
}

const Chip = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 6px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  border-radius: var(--pill-mono-radius);
  background: var(--pill-mono-bg);
  color: var(--text-secondary);
`;

const SYMBOLS: Record<string, { symbol: string; label: string }> = {
  sum: { symbol: 'Σ', label: 'sum' },
  count: { symbol: 'Cnt', label: 'count' },
  countDistinct: { symbol: '≈ Cnt-D', label: 'count distinct' },
  countDistinctApprox: { symbol: '≈ Cnt-D', label: 'count distinct approx' },
  avg: { symbol: 'μ', label: 'avg' },
  min: { symbol: '↓', label: 'min' },
  max: { symbol: '↑', label: 'max' },
  number: { symbol: 'ƒx', label: 'computed' },
};

export function AggTypeChip({ aggType }: AggTypeChipProps) {
  if (!aggType) return null;
  const cfg = SYMBOLS[aggType] ?? { symbol: aggType, label: aggType };
  return (
    <Chip title={cfg.label} aria-label={`aggregation: ${cfg.label}`}>
      {cfg.symbol}
    </Chip>
  );
}
