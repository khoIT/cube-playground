/**
 * One root-cause group: a collapsible card showing the missing cube/member,
 * the affected metrics (each with a mark-N/A toggle), and a repoint form.
 * Reason → semantic pill: cube-missing→destructive, member-missing→warning,
 * unparseable→muted; affected-count→info.
 */
import { ReactElement, useState } from 'react';
import styled from 'styled-components';
import { ChevronRight } from 'lucide-react';
import type { RootCauseGroup, MetaMember } from './use-drift-center';
import { RepointRefForm } from './repoint-ref-form';
import { MarkNaToggle } from './mark-na-toggle';

const MAX_VISIBLE_METRICS = 12;

const Card = styled.section`
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-lg);
  margin-bottom: 10px;
  overflow: hidden;
  &:hover { box-shadow: var(--shadow-sm); }
`;
const Head = styled.button`
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 12px 14px;
  background: var(--bg-card);
  border: none;
  cursor: pointer;
  text-align: left;
`;
const Caret = styled(ChevronRight)<{ $open: boolean }>`
  color: var(--text-muted);
  transition: transform 150ms ease;
  transform: rotate(${(p) => (p.$open ? 90 : 0)}deg);
  flex-shrink: 0;
`;
const Key = styled.span`
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--text-primary);
  font-weight: 500;
`;
const Sub = styled.span`
  font-size: 12px;
  color: var(--text-muted);
`;
const Right = styled.div`
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
`;
const Pill = styled.span<{ $tone: 'cube-missing' | 'member-missing' | 'unparseable' | 'affected' }>`
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 9px;
  border-radius: var(--radius-pill);
  font-family: var(--font-sans);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  background: ${(p) =>
    p.$tone === 'cube-missing' ? 'var(--destructive-soft)'
    : p.$tone === 'member-missing' ? 'var(--warning-soft)'
    : p.$tone === 'affected' ? 'var(--info-soft)'
    : 'var(--bg-muted)'};
  color: ${(p) =>
    p.$tone === 'cube-missing' ? 'var(--destructive-ink)'
    : p.$tone === 'member-missing' ? 'var(--warning-ink)'
    : p.$tone === 'affected' ? 'var(--info-ink)'
    : 'var(--text-muted)'};
`;
const Body = styled.div`
  border-top: 1px solid var(--border-card);
  padding: 12px 14px 14px;
  background: var(--bg-app);
`;
const FieldLabel = styled.p`
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  margin: 0 0 6px;
`;
const Metrics = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 14px;
`;
const MetricRow = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 26px;
  padding: 0 8px 0 10px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-pill);
  font-size: 12px;
  color: var(--text-secondary);
  & code { font-family: var(--font-mono); font-size: 11px; color: var(--text-primary); }
`;
const More = styled.span`
  color: var(--text-muted);
  font-size: 12px;
  align-self: center;
`;

const REASON_LABEL: Record<RootCauseGroup['reason'], string> = {
  'cube-missing': 'cube-missing',
  'member-missing': 'member-missing',
  unparseable: 'unparseable',
};

function subFor(group: RootCauseGroup): string {
  if (group.kind === 'cube-missing') return 'cube not present in this game’s /meta';
  if (group.kind === 'member-missing') return 'member missing on a present cube';
  return 'reference does not parse as cube.member';
}

interface Props {
  group: RootCauseGroup;
  canWrite: boolean;
  members: MetaMember[];
  membersLoading: boolean;
  onRepoint: (metricId: string, from: string, to: string) => Promise<void>;
  onMarkNa: (metricId: string, applicable: boolean) => Promise<void>;
  defaultOpen?: boolean;
}

export function DriftGroupCard({
  group,
  canWrite,
  members,
  membersLoading,
  onRepoint,
  onMarkNa,
  defaultOpen = false,
}: Props): ReactElement {
  const [open, setOpen] = useState(defaultOpen);
  const visible = group.affectedMetricIds.slice(0, MAX_VISIBLE_METRICS);
  const extra = group.affectedMetricIds.length - visible.length;

  return (
    <Card>
      <Head type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Caret size={16} $open={open} aria-hidden />
        <Key>{group.key}</Key>
        <Sub>{subFor(group)}</Sub>
        <Right>
          <Pill $tone="affected">
            {group.affectedCount} metric{group.affectedCount === 1 ? '' : 's'}
          </Pill>
          <Pill $tone={group.reason}>{REASON_LABEL[group.reason]}</Pill>
        </Right>
      </Head>
      {open ? (
        <Body>
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
        </Body>
      ) : null}
    </Card>
  );
}
