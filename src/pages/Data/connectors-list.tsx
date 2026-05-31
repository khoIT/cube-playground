/**
 * Connector cards for the Data hub. Each card: a square mono badge, label +
 * catalog/meta line, a status dot, and a chevron into the connector detail. A
 * dashed "+ Add connector" card and a status legend sit below. Styling is all
 * design tokens; mirrors the card shape used on Dashboards/index.tsx.
 */
import { ReactElement } from 'react';
import styled from 'styled-components';
import { ChevronRight, Plus } from 'lucide-react';
import type { Connector } from '../../api/onboarding-client';

export type ConnectorStatus = 'synced' | 'syncing' | 'stale' | 'error';

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;
const Card = styled.button`
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  text-align: left;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-lg);
  padding: 16px 20px;
  cursor: pointer;
  font-family: var(--font-sans);
  transition: box-shadow 0.15s ease;
  &:hover {
    box-shadow: var(--shadow-sm);
  }
`;
const Badge = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border-radius: var(--radius-md);
  background: var(--brand-soft);
  color: var(--brand);
  font-size: 13px;
  font-weight: 700;
`;
const Title = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
`;
const Meta = styled.div`
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 2px;
`;
const Dot = styled.span<{ $status: ConnectorStatus }>`
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  flex-shrink: 0;
  background: ${(p) =>
    p.$status === 'synced'
      ? 'var(--positive)'
      : p.$status === 'syncing'
        ? 'var(--info-ink)'
        : p.$status === 'stale'
          ? 'var(--warning-ink)'
          : 'var(--destructive-ink)'};
`;
const AddCard = styled.button`
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  text-align: left;
  background: transparent;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-lg);
  padding: 16px 20px;
  cursor: pointer;
  font-family: var(--font-sans);
  transition: border-color 0.15s ease, background 0.15s ease;
  &:hover {
    border-color: var(--brand);
    background: var(--bg-muted);
  }
`;
const AddBadge = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border-radius: var(--radius-md);
  background: var(--bg-muted);
  color: var(--text-muted);
`;
const Legend = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 16px;
  font-size: 12px;
  color: var(--text-muted);
`;
const LegendItem = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
`;

function initials(label: string): string {
  const cleaned = label.replace(/[^A-Za-z0-9 ]/g, ' ').trim();
  const word = cleaned.split(/\s+/)[0] ?? label;
  return (word.slice(0, 2) || '?').replace(/^./, (c) => c.toUpperCase());
}

interface Props {
  connectors: Connector[];
  onOpen: (id: string) => void;
  onAdd: () => void;
}

export function ConnectorsList({ connectors, onOpen, onAdd }: Props): ReactElement {
  return (
    <>
      <List>
        {connectors.map((c) => {
          const status: ConnectorStatus = c.configured ? 'synced' : 'stale';
          return (
            <Card key={c.id} type="button" onClick={() => onOpen(c.id)}>
              <Badge aria-hidden>{initials(c.label)}</Badge>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Title>{c.label}</Title>
                <Meta>
                  {c.readOnly
                    ? `${c.catalog} catalog · read-only worked example`
                    : `${c.catalog} catalog${c.host ? ` · ${c.host}` : ''}`}
                </Meta>
              </div>
              <Dot $status={status} title={status} aria-hidden />
              <ChevronRight size={16} style={{ color: 'var(--text-muted)' }} aria-hidden />
            </Card>
          );
        })}

        <AddCard type="button" onClick={onAdd}>
          <AddBadge aria-hidden>
            <Plus size={18} />
          </AddBadge>
          <div>
            <Title>Add a connector</Title>
            <Meta>BigQuery, Snowflake, Postgres, 85+ sources…</Meta>
          </div>
        </AddCard>
      </List>

      <Legend>
        <LegendItem>
          <Dot $status="synced" aria-hidden /> synced
        </LegendItem>
        <LegendItem>
          <Dot $status="syncing" aria-hidden /> syncing
        </LegendItem>
        <LegendItem>
          <Dot $status="stale" aria-hidden /> stale
        </LegendItem>
        <LegendItem>
          <Dot $status="error" aria-hidden /> error
        </LegendItem>
      </Legend>
    </>
  );
}
