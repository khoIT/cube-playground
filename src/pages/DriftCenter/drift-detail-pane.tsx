/**
 * Right pane of the Drift Center master–detail layout: the resolve surface for
 * the one root-cause group selected on the left. Shows the affected metrics
 * (each with a mark-N/A toggle) and the repoint form. Write actions are gated by
 * `canWrite` (UX-only; the server enforces too). Renders an empty placeholder
 * when nothing is selected (e.g. the last group was just resolved).
 */
import { ReactElement } from 'react';
import styled from 'styled-components';
import { AlertTriangle } from 'lucide-react';
import type { RootCauseGroup, MetaMember } from './use-drift-center';
import { ReasonPill, REASON_LABEL, subFor } from './reason-pill';
import { RepointRefForm } from './repoint-ref-form';
import { MarkNaToggle } from './mark-na-toggle';

const MAX_VISIBLE_METRICS = 24;

const Pane = styled.section`
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-lg);
  padding: 18px 20px;
  min-height: 320px;
`;
const Head = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
`;
const Key = styled.h2`
  margin: 0;
  font-family: var(--font-mono);
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
`;
const Sub = styled.span`
  font-size: 12.5px;
  color: var(--text-muted);
`;
const Pills = styled.div`
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
`;
const FieldLabel = styled.p`
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  margin: 22px 0 8px;
`;
const Metrics = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`;
const MetricRow = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  padding: 0 9px 0 11px;
  background: var(--bg-app);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-pill);
  font-size: 12px;
  color: var(--text-secondary);
  & code { font-family: var(--font-mono); font-size: 11.5px; color: var(--text-primary); }
`;
const More = styled.span`
  align-self: center;
  font-size: 12px;
  color: var(--text-muted);
`;
const Empty = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 320px;
  color: var(--text-muted);
  text-align: center;
`;

interface Props {
  group: RootCauseGroup | null;
  canWrite: boolean;
  members: MetaMember[];
  membersLoading: boolean;
  onRepoint: (metricId: string, from: string, to: string) => Promise<void>;
  onMarkNa: (metricId: string, applicable: boolean) => Promise<void>;
}

export function DriftDetailPane({
  group,
  canWrite,
  members,
  membersLoading,
  onRepoint,
  onMarkNa,
}: Props): ReactElement {
  if (!group) {
    return (
      <Pane>
        <Empty>
          <AlertTriangle size={22} style={{ color: 'var(--text-muted)' }} aria-hidden />
          <span style={{ fontSize: 13 }}>Select a root cause on the left to resolve it.</span>
        </Empty>
      </Pane>
    );
  }

  const visible = group.affectedMetricIds.slice(0, MAX_VISIBLE_METRICS);
  const extra = group.affectedMetricIds.length - visible.length;

  return (
    <Pane>
      <Head>
        <Key>{group.key}</Key>
        <Sub>{subFor(group)}</Sub>
        <Pills>
          <ReasonPill $tone="affected">
            {group.affectedCount} metric{group.affectedCount === 1 ? '' : 's'}
          </ReasonPill>
          <ReasonPill $tone={group.reason}>{REASON_LABEL[group.reason]}</ReasonPill>
        </Pills>
      </Head>

      <FieldLabel>Affected metrics</FieldLabel>
      <Metrics>
        {visible.map((id) => (
          <MetricRow key={id}>
            <code>{id}</code>
            {canWrite ? <MarkNaToggle metricId={id} onMarkNa={onMarkNa} /> : null}
          </MetricRow>
        ))}
        {extra > 0 ? <More>+{extra} more</More> : null}
      </Metrics>

      {canWrite ? (
        <>
          <FieldLabel>Repoint a reference</FieldLabel>
          <RepointRefForm
            items={group.items}
            members={members}
            membersLoading={membersLoading}
            onRepoint={onRepoint}
          />
        </>
      ) : null}
    </Pane>
  );
}
