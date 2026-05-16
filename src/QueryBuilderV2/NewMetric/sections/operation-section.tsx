import { Space, Text } from '@cube-dev/ui-kit';
import styled from 'styled-components';
import { NewMetricDraft, Operation } from '../types';

interface OperationSectionProps {
  draft: NewMetricDraft;
  setField: <K extends keyof NewMetricDraft>(field: K, value: NewMetricDraft[K]) => void;
}

const OPERATIONS: { value: Operation; label: string; description: string }[] = [
  { value: 'sum',           label: 'Sum',            description: 'Total of a numeric column' },
  { value: 'count',         label: 'Count',          description: 'Number of rows' },
  { value: 'countDistinct', label: 'Count distinct', description: 'Unique values of a column' },
  { value: 'avg',           label: 'Average',        description: 'Mean of a numeric column' },
  { value: 'min',           label: 'Minimum',        description: 'Smallest value' },
  { value: 'max',           label: 'Maximum',        description: 'Largest value' },
  { value: 'ratio',         label: 'Ratio',          description: 'Divide one measure by another' },
];

const OperationGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 8px;
`;

const OperationCard = styled.label<{ $selected: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid ${(p) => (p.$selected ? 'var(--brand)' : 'var(--border-card)')};
  border-radius: 8px;
  background: ${(p) => (p.$selected ? 'var(--brand-soft)' : 'var(--bg-card)')};
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;

  &:hover {
    border-color: ${(p) => (p.$selected ? 'var(--brand)' : 'var(--border-strong)')};
  }

  input { position: absolute; opacity: 0; pointer-events: none; }
`;

const CardLabel = styled.span`
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
`;

const CardDescription = styled.span`
  font-family: var(--font-sans);
  font-size: 11.5px;
  color: var(--text-muted);
`;

export function OperationSection({ draft, setField }: OperationSectionProps) {
  return (
    <Space direction="vertical" gap="1x">
      <Text>Operation</Text>
      <OperationGrid>
        {OPERATIONS.map(({ value, label, description }) => (
          <OperationCard key={value} $selected={draft.operation === value}>
            <input
              type="radio"
              name="operation"
              value={value}
              checked={draft.operation === value}
              onChange={() => setField('operation', value)}
            />
            <CardLabel>{label}</CardLabel>
            <CardDescription>{description}</CardDescription>
          </OperationCard>
        ))}
      </OperationGrid>
    </Space>
  );
}
