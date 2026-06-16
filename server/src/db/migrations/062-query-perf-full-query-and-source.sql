-- Add the verbatim query + originating-artifact source to query_perf.
--
-- PII POSTURE CHANGE (deliberate, admin-only): `query_full` stores the COMPLETE
-- Cube query as sent — including filter VALUES, dateRange bounds, and any UID
-- list. This is a conscious reversal of the names-only gate FOR THIS ADMIN TABLE
-- ONLY: it lets an admin see and reproduce the exact slow/failed query when
-- triaging. Exposure is bounded by (a) admin-only read routes, (b) the 30-day
-- retention prune. The `activity_events` spine remains names-only (unchanged) —
-- `query_shape` here is still the names-only projection used by the classifier.
--
-- `source` is the sanitized originating route (from the browser Referer path,
-- e.g. /dashboards/123, /segments/45, /playground) — an app path, not PII.
-- Server-to-server callers (no Referer) are NULL → shown as "api".

ALTER TABLE query_perf ADD COLUMN query_full TEXT;
ALTER TABLE query_perf ADD COLUMN source     TEXT;
