import styled from 'styled-components';
import { Check, Circle } from 'lucide-react';

const Card = styled.div`
  margin-top: 16px;
  padding: 12px;
  background: var(--bg-muted);
  border-radius: 12px;
  border: 1px solid var(--border-card);
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 8px;
`;

const Item = styled.div<{ $done: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  padding: 4px 0;
  color: ${(p) => (p.$done ? 'var(--text-primary)' : 'var(--text-muted)')};
`;

export type ValidationItem = { label: string; done: boolean };

export function ValidationCard({ items }: { items: ValidationItem[] }) {
  const passed = items.filter((i) => i.done).length;
  return (
    <Card>
      <Header>
        <span>Validation</span>
        <span style={{ color: passed === items.length ? 'var(--success)' : 'var(--text-secondary)' }}>
          {passed}/{items.length}
        </span>
      </Header>
      {items.map((i) => (
        <Item key={i.label} $done={i.done}>
          {i.done ? <Check size={14} color="var(--success)" /> : <Circle size={14} />}
          <span>{i.label}</span>
        </Item>
      ))}
    </Card>
  );
}
