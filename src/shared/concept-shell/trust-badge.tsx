/**
 * TrustBadge — three canonical trust tiers used across business-metric,
 * measure, dimension, and segment cards.
 *
 * Default prominence is medium. Pass `size="sm"` for compact card variants.
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
    fg: 'var(--cat-green-ink)',
    border: 'rgba(16, 185, 129, 0.32)',
  },
  draft: {
    label: 'Draft',
    bg: 'rgba(115, 115, 115, 0.10)',
    fg: 'var(--cat-grey-ink)',
    border: 'rgba(115, 115, 115, 0.28)',
  },
  deprecated: {
    label: 'Deprecated',
    bg: 'rgba(245, 158, 11, 0.12)',
    fg: 'var(--cat-amber-ink)',
    border: 'rgba(245, 158, 11, 0.32)',
  },
};

// Shared chip styling. Renders as a <span> by default (read-only badge) or
// as a <button> when `onClick` is provided (interactive filter chip).
const chipStyles = `
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  white-space: nowrap;
`;

const Chip = styled.span<{
  $bg: string;
  $fg: string;
  $border: string;
  $size: 'sm' | 'md';
  $dim: boolean;
}>`
  ${chipStyles}
  height: ${(p) => (p.$size === 'sm' ? '18px' : '22px')};
  padding: 0 ${(p) => (p.$size === 'sm' ? '6px' : '8px')};
  border: 1px solid ${(p) => p.$border};
  background: ${(p) => p.$bg};
  color: ${(p) => p.$fg};
  font-size: ${(p) => (p.$size === 'sm' ? '10px' : '11px')};
  opacity: ${(p) => (p.$dim ? 0.45 : 1)};
`;

const ChipButton = styled.button<{
  $bg: string;
  $fg: string;
  $border: string;
  $size: 'sm' | 'md';
  $dim: boolean;
}>`
  ${chipStyles}
  height: ${(p) => (p.$size === 'sm' ? '18px' : '22px')};
  padding: 0 ${(p) => (p.$size === 'sm' ? '6px' : '8px')};
  border: 1px solid ${(p) => p.$border};
  background: ${(p) => p.$bg};
  color: ${(p) => p.$fg};
  font-size: ${(p) => (p.$size === 'sm' ? '10px' : '11px')};
  opacity: ${(p) => (p.$dim ? 0.45 : 1)};
  cursor: pointer;
  font-family: inherit;
  &:hover { opacity: ${(p) => (p.$dim ? 0.7 : 1)}; }
  &:focus-visible { outline: 2px solid ${(p) => p.$border}; outline-offset: 2px; }
`;

interface TrustBadgeProps {
  trust: BusinessMetricTrust;
  size?: 'sm' | 'md';
  /** When set, renders as an interactive button (filter chip). */
  onClick?: () => void;
  /** Visual state for filter use: false → dimmed unselected; true/undefined → full color. */
  selected?: boolean;
}

export function TrustBadge({
  trust,
  size = 'md',
  onClick,
  selected,
}: TrustBadgeProps) {
  const s = STYLES[trust];
  const dim = onClick !== undefined && selected === false;
  const common = {
    $bg: s.bg,
    $fg: s.fg,
    $border: s.border,
    $size: size,
    $dim: dim,
    title: `Trust: ${s.label}`,
    'data-trust': trust,
  } as const;
  if (onClick !== undefined) {
    return (
      <ChipButton
        {...common}
        type="button"
        onClick={onClick}
        aria-pressed={selected ?? true}
      >
        {s.label}
      </ChipButton>
    );
  }
  return <Chip {...common}>{s.label}</Chip>;
}
