/**
 * Phase 08 — audit/edit-history view for a business metric. Renders the
 * append-only stream returned by `GET /api/business-metrics/:id/history` as a
 * timeline of "actor → action" rows.
 *
 * Layout follows the broader Catalog detail style: tokens-driven typography,
 * brand-soft pills for action labels, and a graceful empty state when no
 * mutations have occurred yet (the common case post-migration).
 */
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import {
  useBusinessMetricHistory,
  type AuditAction,
  type ActorKind,
  type AuditEntry,
} from './use-business-metric-history';

interface Props {
  metricId: string;
}

const Wrap = styled.section`
  padding: 24px 24px 32px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  font-family: var(--font-sans);
`;

const HeaderRow = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
`;

const Heading = styled.h2`
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
`;

const SubHint = styled.span`
  color: var(--text-muted);
  font-size: 12px;
`;

const List = styled.ol`
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const Row = styled.li`
  display: grid;
  grid-template-columns: 132px 120px 1fr 90px;
  align-items: start;
  gap: 16px;
  padding: 12px 14px;
  border: 1px solid var(--border-card);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: 12.5px;
`;

const Ts = styled.span`
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
`;

const Reason = styled.span`
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
`;

const ActionPill = styled.span<{ $tone: 'create' | 'update' | 'trust' | 'delete' }>`
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 10px;
  border-radius: var(--radius-pill);
  font-size: 11px;
  font-weight: 600;
  background: ${(p) =>
    p.$tone === 'create'
      ? 'var(--success-soft)'
      : p.$tone === 'trust'
        ? 'var(--info-soft)'
        : p.$tone === 'delete'
          ? 'var(--destructive-soft)'
          : 'var(--muted-soft)'};
  color: ${(p) =>
    p.$tone === 'create'
      ? 'var(--success-ink)'
      : p.$tone === 'trust'
        ? 'var(--info-ink)'
        : p.$tone === 'delete'
          ? 'var(--destructive-ink)'
          : 'var(--muted-ink)'};
`;

const Actor = styled.span<{ $kind: ActorKind }>`
  font-weight: 500;
  color: ${(p) => (p.$kind === 'agent' ? 'var(--brand)' : 'var(--text-primary)')};
`;

const Empty = styled.p`
  margin: 0;
  padding: 22px 12px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
`;

function tonePill(action: AuditAction): 'create' | 'update' | 'trust' | 'delete' {
  if (action === 'create') return 'create';
  if (action === 'trust_change') return 'trust';
  if (action === 'delete') return 'delete';
  return 'update';
}

function formatTs(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return new Date(ts).toISOString();
  }
}

function actorLabel(entry: AuditEntry): string {
  if (entry.actorKind === 'agent') return entry.actorId ?? 'agent';
  if (entry.actorKind === 'system') return 'system';
  return entry.actorId ?? 'user';
}

function reasonSummary(entry: AuditEntry): string {
  if (entry.reason) return entry.reason;
  if (entry.action === 'trust_change' && entry.oldValueJson && entry.newValueJson) {
    try {
      const oldVal = JSON.parse(entry.oldValueJson) as Record<string, unknown>;
      const newVal = JSON.parse(entry.newValueJson) as Record<string, unknown>;
      const oldT = oldVal['trust'] ?? oldVal['old_trust'];
      const newT = newVal['trust'] ?? newVal['new_trust'];
      if (oldT != null && newT != null) return `${oldT} → ${newT}`;
    } catch {
      // fall through to empty reason
    }
  }
  return '—';
}

export function TabActivity({ metricId }: Props) {
  const { t } = useTranslation();
  const { entries, loading, error } = useBusinessMetricHistory(metricId);

  return (
    <Wrap data-testid="metric-history-tab">
      <HeaderRow>
        <Heading>
          {t('catalog.metricDetail.history.title', { defaultValue: 'Edit history' })}
        </Heading>
        <SubHint>
          {t('catalog.metricDetail.history.count', {
            defaultValue: '{{n}} entr{{plural}}',
            n: entries.length,
            plural: entries.length === 1 ? 'y' : 'ies',
          })}
        </SubHint>
      </HeaderRow>

      {loading ? (
        <Empty data-testid="metric-history-loading">
          {t('common.loading', { defaultValue: 'Loading…' })}
        </Empty>
      ) : error ? (
        <Empty data-testid="metric-history-error">
          {t('catalog.metricDetail.history.error', {
            defaultValue: 'Could not load history ({{detail}}).',
            detail: error,
          })}
        </Empty>
      ) : entries.length === 0 ? (
        <Empty data-testid="metric-history-empty">
          {t('catalog.metricDetail.history.empty', {
            defaultValue: 'No changes recorded yet. Edits made from this UI or by the chat agent will appear here.',
          })}
        </Empty>
      ) : (
        <List>
          {entries.map((entry) => (
            <Row key={entry.id} data-testid="metric-history-row">
              <Ts>{formatTs(entry.ts)}</Ts>
              <ActionPill $tone={tonePill(entry.action)}>{entry.action}</ActionPill>
              <Reason>{reasonSummary(entry)}</Reason>
              <Actor $kind={entry.actorKind}>{actorLabel(entry)}</Actor>
            </Row>
          ))}
        </List>
      )}
    </Wrap>
  );
}
