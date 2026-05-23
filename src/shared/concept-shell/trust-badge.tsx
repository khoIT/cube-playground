/**
 * TrustBadge — five canonical trust tiers used across business-metric,
 * measure, dimension, and segment cards.
 *
 * Default prominence is medium (per plan open Q3). Pass `size="sm"` for
 * compact card variants.
 */

import styled from 'styled-components';

import type { BusinessMetricTrust } from '../../pages/Catalog/metrics-tab/business-metric-types';

const STYLES: Record<
  BusinessMetricTrust,
  { label: string; bg: string; fg: string; border: string }
> = {
  certified: {
    label: 'Certified',
    bg: 'rgba(16, 185, 129, 0.12)',
    fg: '#059669',
    border: 'rgba(16, 185, 129, 0.32)',
  },
  beta: {
    label: 'Beta',
    bg: 'rgba(63, 141, 255, 0.12)',
    fg: '#1d4ed8',
    border: 'rgba(63, 141, 255, 0.32)',
  },
  draft: {
    label: 'Draft',
    bg: 'rgba(115, 115, 115, 0.10)',
    fg: '#525252',
    border: 'rgba(115, 115, 115, 0.28)',
  },
  deprecated: {
    label: 'Deprecated',
    bg: 'rgba(245, 158, 11, 0.12)',
    fg: '#b45309',
    border: 'rgba(245, 158, 11, 0.32)',
  },
  orphaned: {
    label: 'Orphaned',
    bg: 'rgba(239, 68, 68, 0.10)',
    fg: '#b91c1c',
    border: 'rgba(239, 68, 68, 0.28)',
  },
};

const Chip = styled.span<{
  $bg: string;
  $fg: string;
  $border: string;
  $size: 'sm' | 'md';
}>`
  display: inline-flex;
  align-items: center;
  height: ${(p) => (p.$size === 'sm' ? '18px' : '22px')};
  padding: 0 ${(p) => (p.$size === 'sm' ? '6px' : '8px')};
  border: 1px solid ${(p) => p.$border};
  border-radius: 999px;
  background: ${(p) => p.$bg};
  color: ${(p) => p.$fg};
  font-size: ${(p) => (p.$size === 'sm' ? '10px' : '11px')};
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  white-space: nowrap;
`;

interface TrustBadgeProps {
  trust: BusinessMetricTrust;
  size?: 'sm' | 'md';
}

export function TrustBadge({ trust, size = 'md' }: TrustBadgeProps) {
  const s = STYLES[trust];
  return (
    <Chip
      $bg={s.bg}
      $fg={s.fg}
      $border={s.border}
      $size={size}
      title={`Trust: ${s.label}`}
      data-trust={trust}
    >
      {s.label}
    </Chip>
  );
}
