/**
 * AnnotationOverlay — renders annotation markers inside a recharts cartesian chart.
 *
 * Usage: place inside a recharts LineChart / AreaChart / ComposedChart alongside
 * other child elements. Pass the chart's date-string category domain so this
 * component can match annotation starts_at (YYYY-MM-DD) to the right tick.
 *
 * Only renders elements for annotations whose starts_at exists in categoryDomain
 * (or is within range when the domain spans the date). Point events become a
 * styled ReferenceLine; ranged events (ends_at set) become a translucent
 * ReferenceArea.
 *
 * Colors come exclusively from semantic CSS custom properties — no raw hex.
 */

import React from 'react';
import { ReferenceLine, ReferenceArea } from 'recharts';
import type { ChartAnnotation, AnnotationType } from '../../api/chart-annotations';

// ── Type → semantic token mapping ───────────────────────────────────────────

interface TypeStyle {
  /** Stroke / fill token — semantic ink or brand variant */
  color: string;
  /** Translucent fill for ReferenceArea */
  fill: string;
  /** Short label shown in the reference-line tooltip / label */
  label: string;
}

const TYPE_STYLES: Record<AnnotationType, TypeStyle> = {
  patch:    { color: 'var(--info-ink)',        fill: 'var(--info-soft)',        label: 'P' },
  event:    { color: 'var(--success-ink)',     fill: 'var(--success-soft)',     label: 'E' },
  campaign: { color: 'var(--brand)',           fill: 'var(--brand)',            label: 'C' },
  incident: { color: 'var(--destructive-ink)', fill: 'var(--destructive-soft)', label: '!' },
};

// ── Props ────────────────────────────────────────────────────────────────────

export interface AnnotationOverlayProps {
  annotations: ChartAnnotation[];
  /** The set of x-axis category values the chart renders (date strings). */
  categoryDomain: string[];
  /** Called when the user clicks a reference line / area label. */
  onAnnotationClick?: (annotation: ChartAnnotation) => void;
}

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Returns an array of recharts ReferenceLine / ReferenceArea elements.
 * Must be spread as children inside a cartesian recharts chart component.
 *
 * recharts uses React.Children.map internally, so returning an array of
 * elements (not a Fragment) is the correct contract for child injection.
 */
export function AnnotationOverlay({
  annotations,
  categoryDomain,
  onAnnotationClick,
}: AnnotationOverlayProps): React.ReactElement[] {
  const domainSet = new Set(categoryDomain);

  const elements: React.ReactElement[] = [];

  for (const ann of annotations) {
    const style = TYPE_STYLES[ann.type] ?? TYPE_STYLES.event;

    // Find the closest matching category value. The chart axis uses the exact
    // date strings from Cube (YYYY-MM-DD or ISO with T). Match by prefix so
    // "2024-04-07" hits "2024-04-07T00:00:00.000" if that's what the data has.
    const startX = resolveX(ann.starts_at, domainSet, categoryDomain);
    if (startX === null) continue;

    if (ann.ends_at) {
      const endX = resolveX(ann.ends_at, domainSet, categoryDomain);
      const effectiveEnd = endX ?? startX;

      elements.push(
        <ReferenceArea
          key={`ann-area-${ann.id}`}
          x1={startX}
          x2={effectiveEnd}
          fill={style.fill}
          fillOpacity={0.35}
          stroke={style.color}
          strokeOpacity={0.6}
          strokeWidth={1}
          label={{
            value: `${style.label} ${ann.title}`,
            position: 'insideTopLeft',
            fontSize: 10,
            fill: style.color,
          }}
          onClick={() => onAnnotationClick?.(ann)}
          style={{ cursor: onAnnotationClick ? 'pointer' : undefined }}
        />,
      );
    } else {
      elements.push(
        <ReferenceLine
          key={`ann-line-${ann.id}`}
          x={startX}
          stroke={style.color}
          strokeWidth={1.5}
          strokeDasharray="4 3"
          label={{
            value: `${style.label} ${ann.title}`,
            position: 'insideTopRight',
            fontSize: 10,
            fill: style.color,
          }}
          onClick={() => onAnnotationClick?.(ann)}
          style={{ cursor: onAnnotationClick ? 'pointer' : undefined }}
        />,
      );
    }
  }

  return elements;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolves an annotation date (YYYY-MM-DD) to the chart's category axis value.
 * Tries exact match first, then prefix match (ISO datetime strings), then finds
 * the nearest earlier category value so the line lands on-screen even when the
 * exact date is a gap in a sparse series.
 */
function resolveX(
  date: string,
  domainSet: Set<string>,
  categoryDomain: string[],
): string | null {
  if (categoryDomain.length === 0) return null;

  // Exact match
  if (domainSet.has(date)) return date;

  // Prefix match — axis uses full ISO strings like "2024-04-07T00:00:00.000"
  const prefixed = categoryDomain.find((v) => v.startsWith(date));
  if (prefixed) return prefixed;

  // Nearest earlier value (so lines outside the visible window are suppressed)
  const earlier = categoryDomain.filter((v) => v.slice(0, 10) <= date);
  return earlier.length > 0 ? earlier[earlier.length - 1] : null;
}
