---
phase: 2
title: "YAML sweep (trust only)"
status: completed
priority: P1
effort: "20m"
dependencies: [1]
---

<!-- Updated: scope revised — keep `tier` field on the data model; only sweep `trust` values. -->

# Phase 2: YAML sweep (trust only)

## Overview

Rewrite all 57 preset YAMLs so they match the collapsed enum. Single Python pass + Zod re-validation. After this phase, `loadAll` succeeds end-to-end with the new types from Phase 1. **`tier:` lines are preserved** — they stay on the data model as a curation signal for future surfaces (see plan Non-Goals).

## Requirements

- Functional:
  - For every `server/src/presets/business-metrics/*.yml`:
    - If `trust: beta` → `trust: draft`.
    - If `trust: orphaned` → `trust: draft`.
    - `trust: certified | draft | deprecated` → unchanged.
  - **`tier:` lines preserved as-is.**
  - Zod `tier` field stays in `business-metric.ts`.
- Non-functional:
  - Diff is mechanical (one-line swap). Reviewers can eyeball 57 files quickly.
  - No other YAML fields touched.

## Architecture

YAML edit via a small Python script in the existing skills venv. Idempotent — running twice is a no-op.

## Related Code Files

- Modify: `server/src/presets/business-metrics/*.yml` (all 57).
- Read for context: `server/src/types/business-metric.ts` to confirm `tier` Zod field stays.
- Read for context: `server/src/services/business-metrics-loader.ts` to confirm `loadAll` accepts the new trust values.

## Implementation Steps

1. Write a one-shot Python migration script (kept inline in the implementation commit, no permanent file):
   ```python
   import re, glob
   ROOT = 'server/src/presets/business-metrics'
   for path in glob.glob(f'{ROOT}/*.yml'):
       lines = open(path).read().splitlines()
       out = [re.sub(r'^trust:\s*(beta|orphaned)\s*$', 'trust: draft', line) for line in lines]
       open(path, 'w').write('\n'.join(out) + '\n')
   ```
2. Run it from repo root: `python3 phase-02-sweep.py` (script is a tmp file, removed after).
3. Verify with `rg -c "^trust: (beta|orphaned)" server/src/presets/business-metrics/*.yml` → no matches.
4. Verify with `rg -c "^tier:" server/src/presets/business-metrics/*.yml` → still returns 57 (tier preserved).
5. Run `npm run test --workspace server` to confirm loader + schema accept the new trust set.

## Success Criteria

- [x] `rg "^trust: (beta|orphaned)" server/src/presets/business-metrics/*.yml` returns nothing.
- [x] `rg "^tier:" server/src/presets/business-metrics/*.yml` returns 57 matches (preserved).
- [x] Loader `loadAll` returns 57 parsed metrics with no trust-related skips.
- [x] `check-metric-drift.ts` still parses + runs (will still report 45 unresolved refs — that's expected and addressed by Phase 3 at the trust-resolver layer, not by editing YAMLs).

## Risk Assessment

- Risk: `beta` is also used in other YAML fields (e.g. description text). Mitigation: regex anchored to `^trust:` start of line.
