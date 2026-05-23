/**
 * FreshnessChip — three-state chip showing pre-aggregation / refresh freshness.
 * v1 derives state from a numeric "hours since last refresh" or string label.
 */

import styled from 'styled-components';

export type FreshnessState = 'fresh' | 'stale' | 'unknown';

const STYLES: Record<FreshnessState, { label: string; bg: string; fg: string }> = {
  fresh:   { label: 'Fresh',   bg: 'rgba(16,185,129,0.10)', fg: '#059669' },
  stale:   { label: 'Stale',   bg: 'rgba(245,158,11,0.12)', fg: '#b45309' },
  unknown: { label: 'Unknown', bg: 'rgba(115,115,115,0.08)', fg: '#525252' },
};

const Chip = styled.span<{ $bg: string; $fg: string }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: ${(p) => p.$bg};
  color: ${(p) => p.$fg};
  font-size: 11px;
  font-weight: 500;
`;

const Dot = styled.span<{ $fg: string }>`
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: ${(p) => p.$fg};
`;

interface FreshnessChipProps {
  state: FreshnessState;
  label?: string;
}

export function FreshnessChip({ state, label }: FreshnessChipProps) {
  const s = STYLES[state];
  return (
    <Chip $bg={s.bg} $fg={s.fg} data-freshness={state} title={label ?? s.label}>
      <Dot $fg={s.fg} />
      {label ?? s.label}
    </Chip>
  );
}
