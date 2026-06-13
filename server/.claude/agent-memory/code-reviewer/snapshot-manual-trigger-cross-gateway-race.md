---
name: snapshot-manual-trigger-cross-gateway-race
description: Manual lakehouse snapshot trigger relies on per-process `running` flag; two gateways can interleave DELETE->INSERT on the same Trino partition, duplicating uids for that date
metadata:
  type: project
---

`triggerManualSnapshot` (server/src/jobs/snapshot-segment-membership.ts) deliberately bypasses
SEGMENT_SNAPSHOT_ENABLED + alreadyRanToday; only guard is the in-process `running` boolean.
Snapshot writers are idempotent DELETE->INSERT per (date, game, segment) — but only SERIALLY.

**Why:** SQLite heartbeat + `running` flag are per-instance; the lakehouse
(stag_iceberg.khoitn.segment_membership_daily) is SHARED. If the prod cron run and a manual
trigger from another gateway overlap (A-DELETE, B-DELETE, A-INSERT, B-INSERT) the partition
gets ~2x rows for affected segments. No error surfaces — only an inflated post-INSERT count.
Duplicates persist for that date until someone re-runs it serially.

**How to apply:** when reviewing anything that adds a new writer/trigger path to the
segment-snapshot lakehouse tables, check for cross-instance coordination (Trino-side
already-running probe, or operator confirm when latestLanded == today). Per-process mutexes
do not protect shared Trino state. Related corrected pattern: guard-before-DELETE is done
right here (unlike [[care-reset-clear-before-mutex]]).
