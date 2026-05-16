# yaml-splice Orphaned Top-Level `measures:` Bug

**Date**: 2026-05-16 17:00
**Severity**: High (silent corruption of schema YAML, broken wizard)
**Component**: `vite-plugins/yaml-splice.ts` + schema-write handler
**Status**: Resolved

## What Happened

The "Define new metric" wizard reported `Save failed (500) — model-dir-not-configured` (env var fix), then after configuring the env var, reported the metric was written but Cube had not acknowledged the change within 15s. Investigation revealed the write *was* landing — at the wrong YAML location. `yaml-splice` was creating a brand-new top-level `measures:` key alongside `cubes:` instead of splicing into `cubes[*].measures`. Cube parsed the file, kept the original 13 measures unchanged, and silently ignored the orphan top-level key.

## The Brutal Truth

The bug shipped with the wizard because the tests *also* assumed the wrong YAML shape. Test fixtures used flat single-cube documents (`name: Orders` at top level); real Cube schemas use `cubes: [...]` arrays. The fixture mismatch meant 16 green tests covered a code path the production files never hit. Tests that don't mirror real data shape can pass forever while the feature silently corrupts every save.

## Technical Details

**The file Cube serves:**

```yaml
cubes:                  # top-level array
  - name: mf_users      # cube entry
    measures:           # ← measures lives INSIDE the cube
      - name: existing_one
    dimensions: …
```

**What the splice produced:**

```yaml
cubes:
  - name: mf_users
    measures:
      - …13 original measures, unchanged…
measures:               # ← orphan top-level key, Cube silently ignores
  - name: asd
    type: count_distinct
    sql: '{mf_users}.campaign_id'
```

The root cause is `yaml-splice.ts:75`:
```ts
if (!Object.prototype.hasOwnProperty.call(doc, 'measures')) {
  measures = [];   // ← runs every time on real schemas, because top-level
                   //    `measures` doesn't exist; it's nested inside cubes[].
}
// ...
const updated = { ...doc, measures: [...measures, patch] };
```

The function checked the *document root* for `measures`, found none (because it's nested inside `cubes[0]`), and merged a fresh top-level key. Cube's schema compiler recognizes `cubes:`, not orphan `measures:`.

**Why it stayed hidden:**

- Test fixtures (`SAMPLE_YAML_WITH_MEASURES` and `SAMPLE_YAML_WITHOUT_MEASURES`) put `name: Orders` + `measures: […]` at the document root — Cube *does* accept this single-cube flat form, but real schemas use the array form.
- All 16 tests exercised the flat shape only. The structural assumption was untested against the production data shape.
- The wizard UI surfaces `Save failed (15s)` as a hot-reload timeout warning ("Cube has not acknowledged the change") rather than a schema-write failure. The error message blamed Cube; the bug was in our code.

## What We Tried

1. Confirmed the YAML write landed: `grep "asd" mf_users.yml` → 3 hits at lines 268–271.
2. Confirmed Cube `/meta` still shows 13 measures (no `asd`). Not a hot-reload timing issue.
3. Read `mf_users.yml` head + tail → spotted `measures:` at column 0, *outside* the `cubes:` array. Bug visible by eye.
4. Read `yaml-splice.ts:75-94` → confirmed the top-level-key assumption.
5. Restored `mf_users.yml` from the `.bak` left by the atomic write.
6. Rewrote splice to detect document shape (`cubes:` array vs. flat) and drill into the named cube's `measures`. Added `cubeName` parameter (the handler already had it; just needed plumbing).
7. Updated `schema-write-handler.ts:108` to pass `cubeName` through.
8. Rewrote test file with new fixtures for `cubes:` array shape; added regression tests including explicit "no top-level `measures:` created" invariant. 25/25 tests pass.

## Root Cause Analysis

1. **Test fixtures didn't mirror production shape.** The flat-single-cube form is a valid Cube YAML shape, but it's not the form this codebase's schemas use. Tests should have one fixture matching each shape Cube accepts AND being explicit which one the real files use. Lesson: when the schema/data format has multiple legal shapes, every supported shape needs a fixture, with at least one of them sourced from a real file.

2. **The splice's `doc.hasOwnProperty('measures')` check was structurally wrong.** It treated the document as if the measure list lived at the root. Cube schemas can have `cubes: [...]`, in which case the root has *no* `measures:` key by design. The fix is to identify the target cube node first, then operate on its `measures`.

3. **Comment loss is a separate latent bug.** `js-yaml.dump()` strips all YAML comments. The user's real schemas have substantial comments (disabled pre-agg blocks, design notes, performance rationales). Every successful wizard save will obliterate these. Not fixed in this pass — would require switching to `yaml` v2's `Document` API or doing string-based line splicing.

## Lessons Learned

1. **"Cube didn't reload" can mean "your code wrote nonsense and Cube silently ignored it."** Hot-reload timeouts in dev tools should branch into two diagnostics: (a) was the file actually changed, (b) does the changed content parse to something Cube recognizes. Today's wizard reports only the timeout; the timeout was a *symptom* of malformed output, not slow file-watching.

2. **Schema-shape assumptions must be encoded in tests.** YAML libraries are permissive — they'll accept duplicate top-level keys, sibling siblings, orphan blocks, whatever. The first round of tests passed because the fixture happened to match the simpler shape. A schema-write feature should test against a real-file-derived fixture from day one.

3. **The `cubeName` was *already* a handler parameter.** The handler had `cubeName` from line 78 and passed it to `resolveTargetPath()` (to find the file) but not to `splice()` (to find the cube within the file). Inconsistent use of an available identifier — splice was operating without the most relevant context. Lesson: when adding a function that mutates a parent structure, audit whether existing context (cube name, file path, request id) should flow through.

4. **Atomic-write + `.bak` saved recovery.** `schema-file-ops.ts` writes `.bak` before the rename, so reverting to pre-bug state was `cp foo.yml.bak foo.yml`. The atomic-write design earned its keep today.

5. **Don't trust YAML round-trips for files with comments.** `js-yaml.dump()` discards all comments and reformats. For schema files that humans curate (and these do — there are commented-out pre-aggregation designs in `mf_users.yml`), this is destructive on every save. The current code is silently lossy and will need a comment-preserving rewrite before the wizard ships to anyone who reads their YAML.

## Next Steps

- [ ] Restart Cube container so it re-reads the restored `mf_users.yml` (CubeStore `ECONNRESET` errors in container logs are a separate unhealthy state).
- [ ] Test the wizard end-to-end: write a real measure to `mf_users`, confirm it lands inside the cube's `measures:` array AND appears in `/cubejs-api/v1/meta` within 15s.
- [ ] Plan a comment-preserving splice (switch to `yaml` v2's `Document` API or do string-based line splicing). Required before wizard ships.
- [ ] Add a "verify with real fixture" line to the wizard plan's test phase: every shape Cube accepts must have a fixture, with one sourced from the actual schema repo.
- [ ] Improve the wizard's error UX: map server-side reason codes (`model-dir-not-configured`, `meta-not-acknowledged`, etc.) to human guidance. Today's user saw the raw protocol string.

**Unresolved:** Whether other code in `vite-plugins/` (e.g. `schema-file-ops.ts`, `meta-poll.ts`) makes similar shape assumptions. Not audited this pass — only the splice was confirmed broken.
