# Brainstorm Summary — Feature Atlas (living triage & ideation map)

- Date: 2026-06-25
- Source request: apply loop-engineering (https://github.com/cobusgreyling/loop-engineering) to cube-playground; NOT automation/scheduling — want an actively-maintained state of what's built, each feature's directions + drawbacks, visualized as a tree to triage fast / ideate.
- Status: design agreed, ready for `/ck:plan`.

## Problem

Knowledge of ~60 features scattered across `plans/` (47 active + ~20 `complete/`), `MEMORY.md` (~60 files), `docs/`, code. No single surface to triage ("X weird → what is it, deps, known drawbacks, related plan/code?") or ideate ("see the map → spot gaps/adjacencies"). Existing "living view" `docs/development-roadmap.md` already rotted (only mentions New Metric wizard; blind to LiveOps/Segments/Chat/Advisor) — proof a hand-maintained doc dies.

## Loop-engineering mapping

Article = 6 blocks (Scheduling, Worktrees, Skills, Connectors, Sub-agents, **Memory/State spine**) + phased L1→L3 rollout. User correctly skips scheduling. The ask IS the **Memory/State spine**, pointed at a human (triage/ideate) not an autonomous loop. Kept idea: spine stays fresh via **on-demand reconcile ritual** (their "L1 report-only"), no cron. Unification: ONE committed data file = both the human visualization source AND agent-readable context.

## Decisions locked (user)

| Q | Decision |
|---|----------|
| Medium | In-app interactive page (reuses existing `cube-graph/` reactflow + `concept-shell`). |
| Freshness | On-demand `/atlas reconcile` skill (L1 assisted), no automation. |
| Node model | **Surface → Feature → Direction** 3-level tree. |
| V1 scope | Whole app (~60 nodes) — first reconcile run IS the seed harvest. |
| Render | **Custom interactive viz, NOT raw Mermaid** (raw Mermaid hard to see/interact/discover). Design via **huashu-design** hi-fi HTML variants → pick/mix → React. |
| Reconcile depth | **Auto-draft** directions/drawbacks from plan/memory text; user curates. |

## Architecture — 3 components

**1. Spine — `docs/feature-atlas/atlas.yaml`** (single source of truth, git-tracked, dual-use: human view + agent memory)

```yaml
version: 1
reconciledAt: 2026-06-25
surfaces:
  - id: liveops
    label: LiveOps
    features:
      - id: liveops-diagnostics
        label: Diagnostics sub-hub
        status: shipped          # idea|planned|in-flight|shipped|deprecated
        health: partial          # healthy|partial|at-risk|stale
        summary: Delta decomp · event timeline · lifecycle flow
        drawbacks:
          - Lifecycle state cards empty — no history table upstream
        directions:              # rendered as dashed leaf nodes = visible ideas
          - { label: Sankey drilldown on lifecycle, effort: M }
          - { label: Auto-create alert-rule from anomaly, effort: S }
        deps: [cs-ticket-join]   # other feature ids → clickable edges
        links:
          plans:  [plans/260624-0104-liveops-monitoring-center]
          code:   [src/pages/Liveops]
          memory: [liveops-monitoring-center-built]
        lastTouched: 2026-06-24  # harvested from git
```

**2. View — in-app `/admin/dev/atlas`** (admin-gated; `authUser.role==='admin'`, sits in existing `/admin/dev` section w/ chat-audit + advisor-audit)
- 3-level tree Surface→Feature→Direction. Feature node color=`health`, badge=`status`.
- **Directions = dashed leaf nodes** off each feature → expansion arrows visible (ideation surfaced, not buried).
- Filter chips (status/health/surface) + search = quick-triage lever.
- Click feature → right detail drawer (mirror `concept-detail`): summary, drawbacks, directions, clickable deps (jump node), links (plan/code/memory).
- Loads `atlas.yaml` via `?raw` import + `js-yaml@4.1.0` parse (exact WhatsNew `import.meta.glob` precedent). No backend/DB.
- **Pure renderer** — zero state encoded in the view; all intelligence in the YAML.

**3. Freshness — `/atlas reconcile` project skill** (`.claude/skills/atlas/` + `scripts/atlas-reconcile.mjs` helper) — L1 report-only
- Diffs `git log` + `plans/` (incl. `complete/` moves) + `MEMORY.md` since `reconciledAt`.
- Proposes approve/edit diff: new plans→draft nodes; plan moved to `complete/`→`in-flight→shipped`; harvest plan §Upcoming/§Next-steps→candidate `directions`; memory caveats→candidate `drawbacks`; flag `stale` (shipped + no git touch N days), `at-risk` (open drawbacks).
- **First run = whole-app seed harvest** (satisfies "whole app at once" without manual typing).

## Phasing

- **P1 Spine + reconcile skill** — schema + `/atlas` + first harvest → populated `atlas.yaml`. Value: data + agent memory; near-zero build risk.
- **P2 Visualization design (huashu)** — hi-fi HTML variants fed by `atlas.yaml`; pick/mix. Chosen prototype already interactive → triage value lands.
- **P3 In-app build** — port approved design to `/admin/dev/atlas` (reactflow + concept-shell). Admin-gated, nav under Advanced/Dev.
- **P4 (optional)** — auto git-derivation of `lastTouched`/`stale`.

## Approaches considered (rejected)

- **Raw Mermaid mindmap** — cheapest, but unreadable/non-interactive at 60+ nodes (user rejected explicitly).
- **Pure manual edits** — how `development-roadmap.md` died; rejected.
- **Auto-harvest from plan frontmatter only** — only 17/47 plans have `status:`; can't capture directions/drawbacks; rejected as sole mechanism (kept as input signal to reconcile).
- **Flat per-plan nodes** / **free capability graph** — rejected vs Surface→Feature→Direction (flat = weak ideation; free graph = heavy edge upkeep).

## Risks / brutal honesty

1. In-app page = most expensive + most rot-prone surface. Mitigation: pure renderer; YAML usable standalone; P1 delivers value before page exists.
2. Reconcile still requires you to RUN it (~weekly). L1 not L3. Dual-use (agent reads it) raises odds it stays alive.
3. directions/drawbacks are judgment — reconcile drafts, you curate. Inherent.
4. Don't overlap WhatsNew (user-facing release cards) or Concept Map (cube schema). This is internal/dev, admin-gated — distinct audience/route.

## Success metrics

- Triage: from "something's off in feature X" → its deps + known drawbacks + plan/code links in < 30s.
- Freshness: `/atlas reconcile` run keeps drift to one run's window; reconciledAt never older than ~2 weeks in practice.
- Ideation: each shipped feature carries ≥1 curated direction; map makes ≥1 cross-surface adjacency obvious.
- Spine reused as agent context in ≥1 later session (dual-use proven).

## Touchpoints (files)

- NEW `docs/feature-atlas/atlas.yaml` — source of truth.
- NEW `.claude/skills/atlas/` + `scripts/atlas-reconcile.mjs` — reconcile ritual.
- NEW `src/pages/Atlas/` — in-app page; reuse `src/pages/Catalog/cube-graph/*`, `src/shared/concept-shell`, `src/pages/Catalog/concept-detail`.
- EDIT route table (`src/App.tsx`) + nav (`src/shell/sidebar/sidebar.tsx`, `/admin/dev` section).
- Loader pattern precedent: `src/pages/WhatsNew/announcements-content.ts` (`import.meta.glob` + `?raw`).

## Unresolved questions

- Source format YAML vs JSON — defaulted YAML (diff-friendly for agent+human). Confirm at plan time if a Vite YAML transform is undesired (fallback: parse `?raw` with js-yaml at runtime — no build plugin needed).
- `health` semantics: how much auto-derived (P4) vs manual — defer to P1 schema detail.
- Whether `/atlas` is a CK skill vs a plain `scripts/` + `/ck:cook` invocation — defaulted project skill.
