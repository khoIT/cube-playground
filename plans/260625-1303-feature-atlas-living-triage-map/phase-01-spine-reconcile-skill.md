---
phase: 1
title: "Spine + reconcile skill"
status: pending
priority: P1
effort: "1-2d"
dependencies: []
---

# Phase 1: Spine + reconcile skill

## Overview

Define the `atlas.yaml` schema (source of truth), build the `/atlas reconcile` ritual that drafts node updates from git + plans/ + MEMORY.md, and run the first whole-app seed harvest (~60 feature nodes). Deliverable is a populated, committed, human- and agent-readable spine. No UI yet — the YAML is already usable (greppable) and is the foundation both later phases render.

## Requirements

- Functional:
  - `src/feature-atlas/atlas.yaml` schema: `version`, `reconciledAt`, `surfaces[] → features[] → directions[]` per the agreed shape.
  - `scripts/atlas-reconcile.mjs`: pure Node helper that, given the current `atlas.yaml`, emits a **proposed diff** (no auto-write) from: `git log` since `reconciledAt`, `plans/` (new dirs, `status:` frontmatter, `complete/` moves), `MEMORY.md` entries.
  - `.claude/skills/atlas/SKILL.md`: drives the ritual — runs the helper, presents the diff, lets the user approve/edit/drop per item, then writes `atlas.yaml` + bumps `reconciledAt`.
  - Auto-draft **conservatively** (confirmed): directions only from explicit plan §Upcoming / §Next-steps; drawbacks only from explicit memory caveats / known-issues. Skip speculative inference. All are *drafts the user curates*, never silently committed; user adds the rest by hand.
  - First run = seed: harvest all current surfaces/features (~60 nodes) into `atlas.yaml`.
- Non-functional:
  - Helper is deterministic, read-only on the repo, side-effect-free (proposes; the skill writes). No network.
  - Schema validated (lightweight) so a malformed `atlas.yaml` fails loudly, not silently in the renderer.

## Architecture

```
atlas.yaml  ──read──►  scripts/atlas-reconcile.mjs  ──proposes diff──►  /atlas skill (SKILL.md)
   ▲                       │  signals harvested:                            │
   └───────write/curate────┘  - git log --since=reconciledAt               │ user approve/edit/drop
                              - plans/*/plan.md frontmatter (status)        │
                              - plans/complete/ membership (→ shipped)      ▼
                              - plans/*/phase-*.md §Upcoming/§Next steps   write atlas.yaml + reconciledAt
                              - MEMORY.md one-liners + memory bodies
```

`atlas.yaml` schema (canonical — keep in sync with brainstorm report):

```yaml
version: 1
reconciledAt: 2026-06-25
surfaces:
  - id: liveops                     # kebab, stable
    label: LiveOps
    features:
      - id: liveops-diagnostics     # globally-unique kebab; deps reference these
        label: Diagnostics sub-hub
        status: shipped             # idea | planned | in-flight | shipped | deprecated
        health: partial            # healthy | partial | at-risk | stale
        summary: Delta decomp · event timeline · lifecycle flow
        drawbacks:
          - Lifecycle state cards empty — no history table upstream
        directions:                 # rendered later as dashed leaf nodes
          - { label: Sankey drilldown on lifecycle, effort: M }
          - { label: Auto-create alert-rule from anomaly, effort: S }
        deps: [cs-ticket-join]       # other feature ids
        links:
          plans:  [plans/260624-0104-liveops-monitoring-center]
          code:   [src/pages/Liveops]
          memory: [liveops-monitoring-center-built]
        lastTouched: 2026-06-24      # harvested from git (P1 best-effort; auto in P4)
```

`status`/`health` derivation in P1 = best-effort heuristic + user curation:
- `in-flight` → `shipped` when plan dir moved to `plans/complete/`.
- `health: stale` candidate = `shipped` + no git touch of `links.code` in N days.
- `health: at-risk` candidate = open drawbacks present.

## Related Code Files

<!-- Updated: Validation Session 1 — atlas.yaml home = src/ (Vite glob can't reach docs/); surfaces=6; YAML; conservative draft -->
- Create: `src/feature-atlas/atlas.yaml` (seeded by first reconcile)
- Create: `docs/feature-atlas/README.md` (one-line pointer to the canonical `src/` file, for docs discoverability)
- Create: `scripts/atlas-reconcile.mjs` (diff/proposal engine)
- Create: `.claude/skills/atlas/SKILL.md` (ritual driver; `/atlas` entry)
- Create: `scripts/__tests__/atlas-reconcile.test.mjs` (or vitest under existing test setup) — proposal engine unit tests
- Reference (signals): `plans/`, `plans/complete/`, `MEMORY.md` at `/Users/lap16299/.claude/projects/-Users-lap16299-Documents-code-cube-playground/memory/MEMORY.md`
- Reference (YAML precedent): `src/pages/Segments/presets/parse-preset-bundle.ts`, `src/rollup-designer/utils.ts` (js-yaml usage)

## Implementation Steps

1. Write the schema doc + a tiny shape validator (zod or hand-rolled) reused by helper and P3 loader. Format = **YAML** (confirmed; js-yaml present). No Vite plugin needed — P3 parses `?raw` at runtime.
2. Build `atlas-reconcile.mjs`:
   - parse args (`--since`, `--dry-run` default true);
   - gather signals (git log, plans frontmatter, complete/ membership, MEMORY.md);
   - map signals → proposed node ops (`add-feature`, `set-status`, `add-direction`, `add-drawback`, `flag-health`, `update-links`, `set-lastTouched`);
   - emit a structured proposal (JSON to stdout) — do NOT write `atlas.yaml`.
3. Write `.claude/skills/atlas/SKILL.md`: run helper → render proposal as an approve/edit/drop checklist → on confirm, apply ops to `atlas.yaml`, bump `reconciledAt`, write file.
4. **Run the first reconcile = seed harvest.** Curate the ~60 nodes across the **confirmed 6 surfaces**: LiveOps · Segments · Chat · Catalog/Data-Model · Advisor/Optimization · Ops & CS. Hand-curate directions/drawbacks from memory beyond the conservative auto-drafts.
5. Unit-test the proposal engine on fixture plans (shipped-move, new-plan, frontmatter status change).
6. Commit `atlas.yaml`, helper, skill.

## Success Criteria

- [ ] `src/feature-atlas/atlas.yaml` exists, schema-valid, ~60 features across the agreed surfaces, each with status + health + ≥0 drawbacks; shipped features carry ≥1 direction where sensible.
- [ ] `node scripts/atlas-reconcile.mjs` on a clean tree proposes an empty/near-empty diff; on a fixture with a moved-to-complete plan proposes `set-status: shipped`.
- [ ] `/atlas` skill runs the helper, presents an approve/edit/drop diff, and writes a valid `atlas.yaml` on confirm (no silent writes).
- [ ] Proposal engine unit tests pass.
- [ ] `atlas.yaml` is readable as agent context (well-structured, self-explaining ids).

## Risk Assessment

- **Surface taxonomy churn** — every later phase inherits it. RESOLVED: confirmed 6 surfaces (LiveOps · Segments · Chat · Catalog/Data-Model · Advisor/Optimization · Ops & CS). Still curatable in `atlas.yaml` at low cost if a feature obviously belongs elsewhere.
- **Reconcile drafts are noisy** — auto-drafted directions/drawbacks may be low-signal. Mitigation: always curate; engine proposes, never writes.
- **MEMORY.md path is outside the repo** (`~/.claude/...`). Helper must read it via absolute path and degrade gracefully if absent (CI/other machines).
- **Status heuristic wrong** (e.g. plan not moved to complete/ but shipped). Mitigation: heuristic is a *proposal*; user corrects; document the limitation in SKILL.md.
