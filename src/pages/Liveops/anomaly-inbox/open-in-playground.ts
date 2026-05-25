/**
 * Builds the hash-router URL that deep-links the Playground with a metric
 * pre-seeded and a 14-day dateRange centered on the anomaly's ts.
 *
 * URL format: /build?query=<URLencoded-JSON>
 * (Playground reads `params.get('query')` as raw JSON — see QueryBuilderContainer.)
 */

import type { AnomalyRow } from './use-anomalies';

interface PlaygroundQuery {
  measures: string[];
  timeDimensions: Array<{
    dimension: string;
    granularity: string;
    dateRange: [string, string];
  }>;
}

/**
 * Returns the date range [start, end] as YYYY-MM-DD strings,
 * spanning 7 days before and 6 days after the anchor date (14 total).
 */
function buildDateRange(anchorTs: string): [string, string] {
  const anchor = new Date(anchorTs.slice(0, 10) + 'T00:00:00Z');
  const start = new Date(anchor);
  start.setUTCDate(anchor.getUTCDate() - 7);
  const end = new Date(anchor);
  end.setUTCDate(anchor.getUTCDate() + 6);
  return [
    start.toISOString().slice(0, 10),
    end.toISOString().slice(0, 10),
  ];
}

/**
 * Infers the time dimension from the metric name using known cube conventions:
 *   active_daily.*             → active_daily.log_date
 *   user_recharge_daily.*      → user_recharge_daily.log_date
 * Falls back to <cubeName>.ts for unknown cubes.
 */
function inferTimeDim(metric: string): string {
  const cube = metric.split('.')[0];
  const known: Record<string, string> = {
    active_daily: 'active_daily.log_date',
    user_recharge_daily: 'user_recharge_daily.log_date',
  };
  return known[cube] ?? `${cube}.ts`;
}

export function buildPlaygroundUrl(anomaly: AnomalyRow): string {
  const dateRange = buildDateRange(anomaly.ts);
  const timeDim = inferTimeDim(anomaly.metric);

  const query: PlaygroundQuery = {
    measures: [anomaly.metric],
    timeDimensions: [
      {
        dimension: timeDim,
        granularity: 'day',
        dateRange,
      },
    ],
  };

  // Playground is served under the hash router at /build
  return `/build?query=${encodeURIComponent(JSON.stringify(query))}`;
}
