-- Enrich public_pull_audit for per-page paginated pulls + failure visibility.
--
-- Today the audit captures STREAM pulls only — the paginated JSON/csv_paged branch
-- writes no row, and the table lacks the columns needed to observe consumption
-- (latency, which snapshot a page served, http status, page position). These
-- columns make each authenticated page request its own observable event so a
-- segment owner can see how a served contract is actually consumed.
--
-- Scope is AUTHENTICATED pulls only: every row still has a real key_id +
-- segment_id, so the existing NOT NULL constraints stay intact. Failed-AUTH
-- (401/403, no resolved key) deliberately does NOT land here — it goes to the
-- structured logger. Keeping failed-auth out of the table avoids an
-- unauthenticated token-spray write-DoS, a NOT-NULL violation on key_id, and
-- leaking presented key bytes into a queryable table.

ALTER TABLE public_pull_audit ADD COLUMN page_index INTEGER;   -- NULL = stream/whole pull; 0..N = paged
ALTER TABLE public_pull_audit ADD COLUMN page_id TEXT;         -- opaque page token echoed for the request
ALTER TABLE public_pull_audit ADD COLUMN latency_ms INTEGER;   -- server time to build the page/stream chunk
ALTER TABLE public_pull_audit ADD COLUMN snapshot_ts TEXT;     -- the pinned snapshot the page served from
ALTER TABLE public_pull_audit ADD COLUMN http_status INTEGER;
-- Authenticated failures only: 'no_snapshot' | 'rate_limited' | 'bad_fields'.
ALTER TABLE public_pull_audit ADD COLUMN error_code TEXT;
-- Schema discriminator. Pre-enrichment rows have no value; the consumption rollup
-- counts only 'v2' rows for rate/latency/freshness so old rows aren't miscounted
-- as failures or as zero-latency.
ALTER TABLE public_pull_audit ADD COLUMN audit_schema TEXT;

-- Per-segment consumption rollup scans by (segment, time).
CREATE INDEX IF NOT EXISTS idx_public_pull_audit_segment_started
  ON public_pull_audit (segment_id, started_at);
