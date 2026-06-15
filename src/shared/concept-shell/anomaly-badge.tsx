/**
 * AnomalyBadge — clickable chip showing the anomaly state for a metric.
 * 4 states: none (renders null), low (yellow), high (red), trend (purple).
 *
 * `onClick` stops propagation so clicks inside a card don't navigate to the
 * detail page when the badge is the intended target.
 */

import { TrendingDown, TrendingUp, Sparkles } from 'lucide-react';
import { MouseEvent } from 'react';
import styled from 'styled-components';

import type {
  BusinessMetricAnomaly,
  BusinessMetricAnomalyState,
} from '../../pages/Catalog/metrics-tab/business-metric-types';

const STYLES: Record<
  Exclude<BusinessMetricAnomalyState, 'none'>,
  { label: string; bg: string; fg: string }
> = {
  low:   { label: 'Anomaly · low',   bg: 'rgba(245,158,11,0.14)', fg: 'var(--cat-amber-ink)' },
  high:  { label: 'Anomaly · high',  bg: 'rgba(239,68,68,0.14)',  fg: 'var(--cat-red-ink)' },
  trend: { label: 'Trend shift',     bg: 'rgba(168,85,247,0.14)', fg: 'var(--cat-purple-ink)' },
};

const Chip = styled.button<{ $bg: string; $fg: string }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 8px;
  border: 1px solid ${(p) => p.$fg + '33'};
  border-radius: 999px;
  background: ${(p) => p.$bg};
  color: ${(p) => p.$fg};
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  font-family: var(--font-sans);

  &:hover { filter: brightness(0.96); }
`;

function fmtDelta(deltaPct: number | undefined): string {
  if (deltaPct === undefined) return '';
  const sign = deltaPct >= 0 ? '+' : '';
  return ` ${sign}${deltaPct.toFixed(1)}%`;
}

function IconFor({ state }: { state: 'low' | 'high' | 'trend' }) {
  if (state === 'high') return <TrendingDown size={11} strokeWidth={2.5} />;
  if (state === 'low') return <TrendingDown size={11} strokeWidth={2.5} />;
  return <Sparkles size={11} strokeWidth={2.5} />;
}

interface AnomalyBadgeProps {
  anomaly: BusinessMetricAnomaly | undefined;
  onClick?: () => void;
}

export function AnomalyBadge({ anomaly, onClick }: AnomalyBadgeProps) {
  if (!anomaly || anomaly.state === 'none') return null;
  const s = STYLES[anomaly.state];
  const handle = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onClick?.();
  };
  return (
    <Chip
      type="button"
      $bg={s.bg}
      $fg={s.fg}
      onClick={handle}
      title={s.label}
      data-anomaly-state={anomaly.state}
    >
      <IconFor state={anomaly.state} />
      {s.label}
      {fmtDelta(anomaly.deltaPct)}
    </Chip>
  );
}
