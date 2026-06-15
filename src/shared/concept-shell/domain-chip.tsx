/**
 * DomainChip — colours the 7 business-metric domains for grid-at-a-glance
 * scanning. Colours sit at low-saturation so they read as labels, not alerts.
 */

import styled from 'styled-components';

import type { BusinessMetricDomain } from '../../pages/Catalog/metrics-tab/business-metric-types';

const STYLES: Record<BusinessMetricDomain, { label: string; bg: string; fg: string }> = {
  revenue:     { label: 'Revenue',     bg: 'rgba(16,185,129,0.10)', fg: 'var(--success-ink)' },
  engagement:  { label: 'Engagement',  bg: 'rgba(63,141,255,0.10)', fg: 'var(--info-ink)' },
  acquisition: { label: 'Acquisition', bg: 'rgba(168,85,247,0.10)', fg: 'var(--cat-purple-ink)' },
  retention:   { label: 'Retention',   bg: 'rgba(20,184,166,0.10)', fg: 'var(--cat-teal-ink)' },
  payments:    { label: 'Payments',    bg: 'rgba(217,119,6,0.10)',  fg: 'var(--warning-ink)' },
  concurrency: { label: 'Concurrency', bg: 'rgba(99,102,241,0.10)', fg: 'var(--cat-indigo-ink)' },
  marketing:   { label: 'Marketing',   bg: 'rgba(236,72,153,0.10)', fg: 'var(--cat-rose-ink)' },
};

const Chip = styled.span<{ $bg: string; $fg: string }>`
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  border-radius: 6px;
  background: ${(p) => p.$bg};
  color: ${(p) => p.$fg};
  font-size: 11px;
  font-weight: 500;
`;

interface DomainChipProps {
  domain: BusinessMetricDomain;
}

export function DomainChip({ domain }: DomainChipProps) {
  const s = STYLES[domain];
  return (
    <Chip $bg={s.bg} $fg={s.fg} data-domain={domain}>
      {s.label}
    </Chip>
  );
}
