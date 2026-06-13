---
id: lakehouse-snapshot-inbox
title: Lakehouse Snapshot Inbox
date: 2026-06-14
kind: new
area: Segments
deepLink: /admin
---
The nightly segment-membership snapshot now has a **live operational view** in the
sys-admin hub's *Segment refreshes* tab.

- Per-segment breakdown — which segments landed, row counts, and skips/errors.
- A **live-run indicator** that streams segments in as they land.
- Owner provenance so you can see whose segment each row belongs to.
- Run-level error surfacing when the lakehouse is unreachable, so a doomed run
  no longer reads as a silent `0/0/0`.

Open the **Segment refreshes** tab to watch tonight's snapshot, or trigger one
manually with *Snapshot now*.
