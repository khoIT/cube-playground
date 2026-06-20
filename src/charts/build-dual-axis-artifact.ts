/**
 * build-dual-axis-artifact — assemble a dual-axis ChartArtifact from a primary
 * query's rows + an independently-loaded overlay query's rows, aligned on the
 * date value. Feeds the shared AssistantChartSection renderer (bars = primary /
 * left axis, line = overlay / right axis). Pure — no React, no Cube SDK.
 *
 * Returns null when the two series can't form a usable overlay (missing
 * measure/time-dim, or no overlapping dates) so the caller falls back to the
 * normal single-series center chart.
 */

import type { Query } from '@cubejs-client/core';
import type { ChartArtifact, ChartColumn } from '../api/chat-sse-client';
import { mergeOnDateValue, resolveRowKey, MERGED_DATE_KEY, type CubeRow } from './merge-on-date-value';

/** First dated time dimension on a query (the combined contract guarantees one). */
function datedTimeDim(query: Query): { dimension: string; granularity?: string } | null {
  const td = (query.timeDimensions ?? []).find((t) => t.dateRange !== undefined) ?? (query.timeDimensions ?? [])[0];
  if (!td?.dimension) return null;
  return { dimension: td.dimension, granularity: td.granularity };
}

/** "active_daily.paying_dau" → "Paying dau". Last-resort axis/legend label. */
function humanise(member: string): string {
  const leaf = member.includes('.') ? member.slice(member.lastIndexOf('.') + 1) : member;
  const words = leaf.replace(/[_-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : member;
}

export interface BuildDualAxisParams {
  primaryQuery: Query;
  primaryRows: CubeRow[];
  overlayQuery: Query;
  overlayRows: CubeRow[];
  title?: string;
  /** Optional /meta-backed label resolver; falls back to humanising the ref. */
  labelFor?: (member: string) => string | undefined;
}

export function buildDualAxisArtifact(params: BuildDualAxisParams): ChartArtifact | null {
  const { primaryQuery, primaryRows, overlayQuery, overlayRows, title, labelFor } = params;

  const pMeasure = (primaryQuery.measures ?? [])[0];
  const oMeasure = (overlayQuery.measures ?? [])[0];
  const pTime = datedTimeDim(primaryQuery);
  const oTime = datedTimeDim(overlayQuery);
  if (!pMeasure || !oMeasure || !pTime || !oTime) return null;

  const valueKey = resolveRowKey(primaryRows, pMeasure);
  const seriesKey = resolveRowKey(overlayRows, oMeasure);

  const merged = mergeOnDateValue(
    { rows: primaryRows, dateKey: resolveRowKey(primaryRows, pTime.dimension, pTime.granularity), valueKey },
    { rows: overlayRows, dateKey: resolveRowKey(overlayRows, oTime.dimension, oTime.granularity), valueKey: seriesKey },
  );
  if (merged.length === 0) return null;

  const label = (m: string) => labelFor?.(m) ?? humanise(m);
  const columns: ChartColumn[] = [
    { key: MERGED_DATE_KEY, label: label(pTime.dimension), dataType: 'time', kind: 'timeDimension' },
    { key: valueKey, label: label(pMeasure), dataType: 'number', kind: 'measure' },
    { key: seriesKey, label: label(oMeasure), dataType: 'number', kind: 'measure' },
  ];

  return {
    id: 'overlay-dual-axis',
    spec: {
      type: 'dual-axis',
      title: title ?? label(pMeasure),
      data: merged,
      encoding: { category: MERGED_DATE_KEY, value: valueKey, series: seriesKey },
    },
    truncated: false,
    originalRowCount: merged.length,
    columns,
  };
}
