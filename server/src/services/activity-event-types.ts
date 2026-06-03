/**
 * Closed vocabulary for the activity telemetry spine.
 *
 * `query_run`, `segment_op`, and `feature_open` are wired now; `export` and
 * `workspace_switch` are reserved for the next slice (aggregation + wider
 * instrumentation). The store validates `event_type` against this list on
 * write so a typo'd emit point fails loud instead of polluting aggregates.
 */

export const ACTIVITY_EVENT_TYPES = [
  'query_run',
  'segment_op',
  'feature_open',
  'export',
  'workspace_switch',
] as const;

export type ActivityEventType = (typeof ACTIVITY_EVENT_TYPES)[number];

export function isActivityEventType(value: string): value is ActivityEventType {
  return (ACTIVITY_EVENT_TYPES as readonly string[]).includes(value);
}
