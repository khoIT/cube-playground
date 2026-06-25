# Feature Atlas

The **Feature Atlas** is the single living map of every cube-playground feature —
its status, health, known drawbacks, and possible directions of development. It
exists for fast **triage** ("X is off → its deps, drawbacks, and related plan/code
in <30s") and **ideation** ("see the whole map → spot gaps and adjacencies").

It is loop-engineering's *Memory/State spine* pointed at a human (not an autonomous
loop). There is **no automation/scheduling** — freshness comes from an on-demand ritual.

## Where things live

| Thing | Path |
|-------|------|
| **Source of truth** (edit this) | [`src/feature-atlas/atlas.yaml`](../../src/feature-atlas/atlas.yaml) |
| Shape validator (shared) | `src/feature-atlas/validate-atlas.mjs` |
| Reconcile proposal engine (read-only) | `scripts/atlas-reconcile.mjs` |
| Reconcile ritual | `.claude/skills/atlas/SKILL.md` — run `/atlas reconcile` |
| In-app viewer (later phase) | `/admin/dev/atlas` — a pure renderer of the YAML |

> The canonical file is under `src/` (not here) so the Vite app can import it
> directly via `?raw` + `js-yaml`. This README is only a discoverability pointer.

## Model

`Surface → Feature → Direction`

- **status:** `idea | planned | in-flight | shipped | deprecated`
- **health:** `healthy | partial | at-risk | stale`
- **drawbacks:** known limitations / open gaps (the triage surface)
- **directions:** future bets, rendered as dashed leaf nodes (the ideation surface)
- **deps:** other feature ids this relies on

## Keeping it fresh

Run **`/atlas reconcile`**. It runs the read-only engine, proposes high-confidence
mechanical updates (plan→complete = shipped, new plan = new feature, drawbacks =
at-risk), you approve/edit/drop each, hand-curate directions/drawbacks, then it
writes `atlas.yaml` and bumps `reconciledAt`. The engine **never** writes on its own.

To just preview the proposal without the ritual:

```bash
node scripts/atlas-reconcile.mjs          # human-readable proposal
node scripts/atlas-reconcile.mjs --json   # machine-readable
```
