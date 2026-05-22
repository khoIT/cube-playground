/**
 * Two-line sparkline used in the editor live-preview card: shows the saved
 * segment's recent size trend (dim) overlaid with the projected estimates
 * as the user edits the predicate (brand).
 *
 * Both series share a common y-scale so visual heights are comparable even
 * when the saved trend has tiny vs huge values relative to the projection.
 */

import type { ReactElement } from 'react';

interface Props {
  /** Past sizes for the currently saved segment (oldest → newest). */
  saved: number[];
  /** Live projection ring buffer as predicate is edited (oldest → newest). */
  projected: number[];
  height?: number;
  savedColor?: string;
  projectedColor?: string;
}

export function DualSparkline({
  saved,
  projected,
  height = 36,
  savedColor = 'var(--text-muted)',
  projectedColor = 'var(--brand)',
}: Props): ReactElement | null {
  const hasSaved = saved.length > 1;
  const hasProjected = projected.length > 1;
  if (!hasSaved && !hasProjected) return null;

  const all = [...saved, ...projected];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const range = max - min || 1;
  const width = 200;

  const path = (data: number[]): string => {
    if (data.length < 2) return '';
    const step = width / (data.length - 1);
    return data
      .map((v, i) => {
        const x = i * step;
        const y = height - ((v - min) / range) * (height - 4) - 2;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  };

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Saved vs projected size trend"
    >
      {hasSaved && (
        <path
          d={path(saved)}
          stroke={savedColor}
          strokeWidth={1.25}
          strokeDasharray="3 3"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {hasProjected && (
        <path
          d={path(projected)}
          stroke={projectedColor}
          strokeWidth={1.75}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
