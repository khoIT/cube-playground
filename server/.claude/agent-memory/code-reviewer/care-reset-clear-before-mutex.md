---
name: care-reset-clear-before-mutex
description: POST /api/care/cases/reset runs clearCases (DELETE) before acquiring the sweep mutex, so a 409-busy resweep still wiped the data
metadata:
  type: project
---

`POST /api/care/cases/reset?game&resweep=true` (`server/src/routes/care-cases.ts`) calls `clearCases(game, workspace.id)` UNCONDITIONALLY, then enters the `executeSweep` try/catch. If a sweep is in-flight, `executeSweep` throws `SweepBusyError` → route returns 409 — but the DELETE already committed. So a "busy" response is misleading: the wipe happened, only the repopulate didn't.

**Why:** order is wipe-then-resweep, and the mutex lives inside `executeSweep`, not around `clearCases`. For a demo reset this is mostly acceptable (data was meant to be wiped), but the 409 reads as "nothing happened" → operator may retry on an already-empty ledger.

**How to apply:** if hardening, either (a) check `isSweepInFlight(workspace.id, game)` BEFORE `clearCases` and 409 early, or (b) document that 409 means "wiped, resweep skipped". The route test asserts the 409 status but NOT that rows survived/were deleted on that path — a coverage gap. Reads (`listCases`, `aggregateCaseCounts`, activity route) are game-scoped only (no workspace filter); `clearCases` is correctly scoped to BOTH game+workspace, so it can only ever delete fewer rows, never cross-tenant. Relates to [[prefix-workspace-meta-is-union]].
