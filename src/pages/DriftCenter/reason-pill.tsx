/**
 * Shared presentation for a drift root-cause's reason — a semantic pill and the
 * one-line human description. Used by both the left-hand root-cause list and the
 * right-hand resolve pane so the tone/label never drifts between the two views.
 * cube-missing→destructive, member-missing→warning, unparseable→muted.
 */
import styled from 'styled-components';
import type { RootCauseGroup } from './use-drift-center';

export const REASON_LABEL: Record<RootCauseGroup['reason'], string> = {
  'cube-missing': 'cube-missing',
  'member-missing': 'member-missing',
  unparseable: 'unparseable',
};

/** One-line "what's wrong" for a group, shown under its key. */
export function subFor(group: RootCauseGroup): string {
  if (group.kind === 'cube-missing') return 'cube not present in this game’s /meta';
  if (group.kind === 'member-missing') return 'member missing on a present cube';
  return 'reference does not parse as cube.member';
}

export const ReasonPill = styled.span<{ $tone: RootCauseGroup['reason'] | 'affected' }>`
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
