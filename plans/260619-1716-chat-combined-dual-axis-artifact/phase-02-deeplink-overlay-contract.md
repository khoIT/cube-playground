---
phase: 2
title: "Deeplink + overlay contract"
status: completed
priority: P1
effort: "0.5d"
dependencies: [1]
---

# Phase 2: Deeplink + overlay contract

## Overview

Carry the overlay query to `/build` **without breaking the existing single-query contract**. The
combined artifact keeps `payload = primary` (a real CubeQuery the old consumer can run) and ships
the overlay on a **sibling** sessionStorage key + a `&combined=1` URL flag. Combined deeplinks force
the session-storage path (never inline `?query=`).

## Requirements

- Functional: clicking "Open in Playground" on a combined card lands `/build` with the primary
  query AND the overlay query retrievable, plus the `combined` flag so Phase 3 seeds overlay mode.
- Non-functional: single-artifact deeplink behaviour byte-unchanged. A combined URL opened by a
  consumer that has NOT yet shipped Phase 3 still runs the primary query (graceful degrade, no
  malformed query) — because `payload`/`?query=` stays a valid single CubeQuery.

## Architecture

- **Forced session-storage (red-team C5):** `chat-service/src/utils/build-chat-deeplink.ts` picks
  inline when `inlineUrl.length <= 8000`; two small queries pass, so a combined artifact would go
  inline and lose `payload`. Add a combined-aware path that forces `via:'session-storage'`, sets
  `payload = primary`, and appends `&combined=1`. `emit-combined-artifact.ts` calls it.
- **Sibling overlay key (red-team C4):** keep the existing key
  `gds-cube:pending-chat-deeplink:<id>` = the single primary CubeQuery (unchanged). Write the
  overlay to a new key `gds-cube:pending-chat-deeplink-overlay:<id>`. The old consumer reads only
  the first key and runs the primary; the Phase-3 consumer additionally reads the overlay key when
  `combined=1`. **Do NOT change the existing payload shape to `{primary,overlay}`** (that was the
  broken plan — it reaches the consumer as a malformed query).
- `src/pages/Chat/components/open-artifact-in-playground.ts`: branch on `artifact.combined` — write
  both keys + navigate to the `&combined=1` URL; non-combined path untouched. The chat-audit
  surface (`DevAudit/turn-artifacts-section`) uses the same shared helper, so both deeplink
  identically.
- **No `CompareSetting` change here (red-team M13):** the overlay is NOT a compare mode. Phase 3
  reads `combined=1` + the overlay key into a dedicated `overlayQuery` builder state. `compare-url-
  codec.ts` is left alone.

## Related Code Files

- Modify: `chat-service/src/utils/build-chat-deeplink.ts` (combined-aware, forced session-storage)
- Modify: `chat-service/src/tools/emit-combined-artifact.ts` (use combined deeplink builder)
- Modify: `src/pages/Chat/components/open-artifact-in-playground.ts` (write sibling overlay key)
- Modify: `src/api/chat-sse-client.ts` (mirror `QueryArtifact.overlay`/`combined` + `dual-axis` ChartType)
- Read: `src/pages/Chat/components/query-artifact-card.tsx`, `src/pages/DevAudit/turn-artifacts-section.tsx`

## Implementation Steps

1. Mirror `overlay`/`combined` + the `dual-axis` ChartType into the FE artifact type
   (`chat-sse-client.ts`) so the card + deeplink compile.
2. `build-chat-deeplink.ts`: combined path → forced session-storage, `payload = primary`, `&combined=1`.
3. `open-artifact-in-playground.ts`: when `combined`, also write the sibling overlay key; else unchanged.
4. Unit-test: combined writes both keys + `combined=1`; single writes one key + no flag; a combined
   URL with NO Phase-3 consumer still yields a runnable primary query.

## Success Criteria

- [ ] Combined card → `/build?…&combined=1`; primary in the existing key, overlay in the sibling key.
- [ ] Single card → unchanged single-CubeQuery payload, no overlay key, no flag.
- [ ] Combined deeplink degrades to primary-only on a pre-Phase-3 consumer (no malformed query).

## Risk Assessment

- **Phase ordering (red-team C4):** ship Phase 3's consumer with this. The sibling-key design makes
  a partial ship safe (degrades to primary), but treat 2+3 as one merge to avoid a half-feature.
- sessionStorage quota: two small CubeQueries (<4KB) — existing try/catch retained.
