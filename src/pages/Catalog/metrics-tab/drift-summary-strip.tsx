/**
 * DriftSummaryStrip — single-line catalog header showing
 * "X of Y metrics resolvable for {game}" with a shortcut to filter the
 * catalog down to the broken set.
 *
 * Renders nothing while drift is loading and on error (keeps the header
 * stable — drift is informational, not blocking).
 */

import styled from 'styled-components';

import { useMetricDrift } from './use-metric-drift';

const Strip = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 16px;
  font-size: 12px;
  color: var(--text-secondary, #525252);
  border-bottom: 1px dashed var(--border-card, #e5e5e5);
  background: rgba(0, 0, 0, 0.02);
`;

const Count = styled.span`
  font-weight: 600;
  color: var(--text-primary, #171717);
`;

const Action = styled.button`
  border: 0;
  background: transparent;
  padding: 0;
  font-size: 12px;
  color: var(--brand, #f05a22);
  cursor: pointer;
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;

  &:hover { color: var(--brand-pressed, #f54a00); }
`;

interface Props {
  gameId: string | null | undefined;
  gameLabel?: string;
  onViewDrafts?: (brokenIds: string[]) => void;
}

export function DriftSummaryStrip({ gameId, gameLabel, onViewDrafts }: Props) {
  const { drift, loading, error } = useMetricDrift(gameId);

  if (!gameId || loading || error || !drift) return null;
  if (drift.total === 0) return null;

  const brokenCount = drift.broken.length;
  return (
    <Strip>
      <span>
        <Count>{drift.resolvable}</Count> of <Count>{drift.total}</Count> metrics
        resolvable for <Count>{gameLabel ?? gameId}</Count>
      </span>
      {brokenCount > 0 && onViewDrafts && (
        <Action
          type="button"
          onClick={() => onViewDrafts(drift.broken.map((b) => b.id))}
        >
          View {brokenCount} draft{brokenCount === 1 ? '' : 's'}
        </Action>
      )}
    </Strip>
  );
}
