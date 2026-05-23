/**
 * TierBadge — 1–6 importance tier shown as a small numbered pill.
 * T1 metrics are the headline KPIs; T6 are operational details.
 */

import styled from 'styled-components';

const Badge = styled.span<{ $tier: number }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  background: ${(p) =>
    p.$tier <= 1
      ? 'var(--brand, #f05a22)'
      : p.$tier <= 2
      ? '#3f8dff'
      : p.$tier <= 3
      ? '#059669'
      : '#737373'};
  color: white;
  font-size: 11px;
  font-weight: 700;
  font-family: var(--font-mono, monospace);
`;

export function TierBadge({ tier }: { tier: number }) {
  const clamped = Math.max(1, Math.min(6, tier | 0));
  return <Badge $tier={clamped} title={`Tier ${clamped}`} data-tier={clamped}>T{clamped}</Badge>;
}
