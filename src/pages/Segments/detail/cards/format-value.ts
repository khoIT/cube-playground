/** Shared formatters used by KPI + chart cards. */

import type { FormatId } from '../../presets/types';

export function formatValue(value: unknown, format: FormatId | undefined): string {
  if (value == null) return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);

  switch (format) {
    case 'percent':
      return `${(n * 100).toFixed(1)}%`;
    case 'currency':
      return n.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
    case 'duration':
      return `${n.toFixed(0)}s`;
    case 'compact':
      if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
      if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
      return String(Math.round(n));
    case 'number':
    default:
      return n.toLocaleString();
  }
}
