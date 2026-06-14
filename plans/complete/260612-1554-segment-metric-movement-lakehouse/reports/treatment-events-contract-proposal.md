# Treatment Events — Lakehouse Contract Proposal

> Input for the external-team meeting on treatment sync-back. PROPOSAL ONLY —
> table is NOT created yet; external team owns the write path. Requirements
> (identity namespace, timestamp precision, variant column) are non-negotiable;
> names/extra columns are negotiable.

## Why this contract

cube-playground lands full daily segment membership into the shared lakehouse
(`stag_iceberg.khoitn.segment_membership_daily` + `_delta`, nightly). Closing the
experimentation loop needs ONE more fact: **who was actually treated, when, with
what**. With both tables in the same catalog+schema, every readout is a single-catalog
join — no cross-system reconciliation.

## Proposed DDL (Trino Iceberg)

```sql
CREATE TABLE IF NOT EXISTS stag_iceberg.khoitn.treatment_events (
  event_date  DATE,          -- GMT+7 calendar date of exposure (partition key)
  game_id     VARCHAR,       -- canonical game id, MUST match segment_membership_daily.game_id values
                             -- (e.g. 'cfm_vn', 'jus_vn', 'ballistar')
  campaign_id VARCHAR,       -- stable campaign/experiment identifier (taxonomy: external team)
  uid         VARCHAR,       -- member id — MUST be in the SAME identity namespace as
                             -- segment_membership_daily.uid for that game (see below)
  variant     VARCHAR,       -- 'treatment' | 'control' | named arm; enables holdout readouts
  channel     VARCHAR,       -- delivery surface: 'cs_call' | 'ingame_mail' | 'push' | 'sms' | ...
  treated_at  TIMESTAMP(6),  -- exact exposure instant (NOT a date) — disambiguates
                             -- exposure-vs-entry ordering in entry-cohort readouts
  source      VARCHAR        -- producing system, for lineage/debug
) WITH (
  partitioning = ARRAY['event_date', 'game_id'],
  format       = 'PARQUET'
);
```

Conventions mirror the membership tables (same catalog/schema, DATE partition
first, PARQUET; see `server/src/lakehouse/segment-membership-ddl.sql`).

## Column semantics

| Column | Semantics | Non-negotiable? |
|---|---|---|
| `event_date` | GMT+7 date of `treated_at`. Producers MUST derive it from `treated_at` in GMT+7, not UTC — membership snapshots are GMT+7-day aligned. | YES (alignment) |
| `game_id` | Same vocabulary as membership `game_id`. | YES |
| `campaign_id` | One id per campaign/experiment; re-used across days of the same campaign. Taxonomy = external team's open item. | name negotiable |
| `uid` | **Identity namespace per game = whatever `segment_membership_daily.uid` carries for that game** (the segment's resolved identity dimension — see Phase 2 mart-eligibility matrix for per-game namespace notes; e.g. cfm has a vopenid-vs-std namespace split). If the delivery system only has another id, the external team must bridge BEFORE landing rows. | YES |
| `variant` | `'treatment'`/`'control'` minimum; named arms allowed. Control rows are what make holdout readouts possible — please land them even though "nothing was delivered". | YES |
| `channel` | Free vocabulary, but stable per source. | negotiable |
| `treated_at` | TIMESTAMP(6), actual exposure (delivered, not scheduled). | YES (timestamp, not date) |
| `source` | e.g. `'cs-console'`, `'campaign-tool-x'`. | negotiable |

## Example readout joins

Treated vs untreated members of a segment, daily revenue (marts per Phase 2 matrix):

```sql
-- members of segment S on day D, split by treatment exposure on/before D
SELECT m.snapshot_date,
       CASE WHEN t.uid IS NOT NULL THEN 'treated' ELSE 'untreated' END AS arm,
       count(distinct m.uid) AS members
FROM stag_iceberg.khoitn.segment_membership_daily m
LEFT JOIN (SELECT DISTINCT game_id, uid
             FROM stag_iceberg.khoitn.treatment_events
            WHERE campaign_id = 'CAMPAIGN' AND variant = 'treatment') t
       ON t.game_id = m.game_id AND t.uid = m.uid
WHERE m.game_id = 'cfm_vn' AND m.segment_id = 'SEGMENT'
GROUP BY 1, 2 ORDER BY 1;
```

Entry-cohort × treatment (did we treat people after they entered?):

```sql
SELECT e.snapshot_date AS entry_date, t.variant, count(distinct e.uid) AS members
FROM stag_iceberg.khoitn.segment_membership_delta e
JOIN stag_iceberg.khoitn.treatment_events t
  ON t.game_id = e.game_id AND t.uid = e.uid
 AND t.treated_at >= CAST(e.snapshot_date AS timestamp)   -- exposure after entry
WHERE e.change = 'entered' AND e.game_id = 'cfm_vn' AND e.segment_id = 'SEGMENT'
  AND t.campaign_id = 'CAMPAIGN'
GROUP BY 1, 2 ORDER BY 1;
```

Per-campaign reach by day/channel:

```sql
SELECT event_date, channel, variant, count(distinct uid) AS reached
FROM stag_iceberg.khoitn.treatment_events
WHERE campaign_id = 'CAMPAIGN' AND game_id = 'cfm_vn'
GROUP BY 1, 2, 3 ORDER BY 1;
```

## Open items for the external team

1. **campaign_id taxonomy** — who mints ids, format, where the registry lives.
2. **Dedup policy** — same uid treated twice in one campaign: two rows (event log,
   preferred) or one (latest-wins)? Proposal assumes event log; readouts use
   `DISTINCT uid`.
3. **Delivery failures** — land failed/bounced sends? If yes add a `status`
   column; if no, document that rows mean *delivered*.
4. **Control-arm rows** — confirm the assigning system can emit control rows at
   assignment time (treated_at = assignment instant for controls).
5. **Backfill** — expectations for landing historical campaigns; partition spec
   supports it (DELETE partition slice → INSERT, same idempotency pattern we use).
6. **Write cadence** — streaming vs daily batch; daily batch by T+1 06:00 GMT+7 is
   sufficient for readouts aligned with the nightly membership snapshot.

## Unresolved questions

- Per-game uid namespace table pending Phase 2 mart-eligibility matrix completion (in flight) — attach it before the meeting.
- Does the external team's delivery system retain exposure timestamps at second precision or only dates? If only dates, `treated_at` degrades to midnight + flag — entry-ordering readouts weaken.
