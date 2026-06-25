# Feature Atlas — Visual Contract (Phase 2)

Spec the Phase 3 React port implements against. Three working HTML prototypes accompany this
doc; all share one data model, one visual encoding, and one detail drawer. They differ only in
**layout + primary interaction**. The human picks one (or mixes) before P3.

Source data: `atlas-snapshot.json` (6 surfaces, 63 features, 27 directions, ~96 nodes). Each
prototype inlines the snapshot so it runs standalone over `file://`.

---

## 1. Data model

```
Surface { id, label, features[] }
Feature { id, label, status, health, summary, drawbacks[], directions[], deps[], links{plans,code,memory}, lastTouched? }
Direction { label, effort? }   // effort ∈ {S,M,L,XL} | null
```

**Data hygiene the renderer must tolerate** (verified against the snapshot):
- One malformed direction in `chat-charts` leaked a sibling key (`"heatmap)": null`) and an
  `effort` on a label-less object. Renderer normalizes: keep only `{label, effort}`, drop
  entries with no `label`, treat any `effort` not in `{S,M,L,XL}` as `null` (label-only chip).
- `deps[]` entries may reference an **unmodeled / external** id not present in `featById`
  (e.g. `preagg-readiness` exists, but some ids do not). Render those as a non-clickable
  "(external / unmodeled)" dep row — never a dead link.
- Optional fields (`drawbacks`, `directions`, `deps`, `links.*`, `lastTouched`) may be absent.
  Always coalesce to empty before counting.

---

## 2. Visual encoding (identical across all 3 variants)

| Channel | Encodes | Mapping |
|---|---|---|
| **Node fill / left-accent** | `health` | healthy→`--success-ink`, partial→`--warning-ink`, at-risk→`--destructive-ink`, stale→`--muted-ink` |
| **Pill / swatch** | `status` | idea→muted, planned→info, in-flight→warning, shipped→success, deprecated→destructive (soft+ink pair) |
| **Dashed ghost leaf** | `directions` | always a dashed border (1px dashed `--border-strong`), never solid — this is the ideation surface; must stay visible |
| **Effort tag on a direction** | `effort` | S→success, M→info, L→warning, XL→destructive (soft+ink); 24px/`ef-*` tag |
| **`⚠ n` count chip** | `drawbacks.length` | destructive soft+ink; only shown when > 0 |
| **`↳ n` / `dep n` chip** | `deps.length` | info soft+ink; only shown when > 0 |
| **Dependency edge** | `deps` relation | drawn only on hover/select (variant 2) or as clickable rows in the drawer — never all-at-once (clutter control) |

Health is the load-bearing triage signal → it gets the **strongest** channel (fill/accent) in
every variant. Status is secondary → a small swatch/pill. Effort is tertiary → a tag inside the
direction chip.

### Legend (must appear in every variant)
Health: 4 dots (healthy/partial/at-risk/stale). Status: 5 pills. Direction = dashed sample.
Dependency = solid info-blue edge sample.

---

## 3. Node anatomy

### Feature node
```
[health accent bar] [▸ dir-toggle?] Label   summary(muted, ellipsis)   [⚠n] [depn] [status pill]
```
- Label: 12–13px / 500–600, `--text-primary`.
- Summary: 12px `--text-muted`, single-line ellipsis in compact layouts, full in drawer.
- The health accent is a 4px rounded left bar (tree/board) or a 4px inset bar (graph node).
- Counts (`⚠`, `dep`) and the status pill sit right-aligned.

### Direction leaf (ideation)
```
[💡] direction label (ellipsis)   [EFFORT tag]
```
- **Always dashed** outline, transparent fill, `--text-secondary`. Distinguishes "idea not yet
  built" from a real feature at a glance.
- Effort tag right-aligned; omitted when effort is null.

---

## 4. Detail drawer (the triage surface — identical in all 3)

Right-side slide-in panel, 420px (92vw cap), `--shadow-lg`, scrim + Esc to close.

**Header** — health accent bar · title (16/700) · surface eyebrow (uppercase 11/600 muted) ·
close button. Badge row below: status pill · health pill (with dot) · `touched {date}` when present.

**Body sections (in order):**
1. **Summary** — full text, 13px `--text-secondary`.
2. **Drawbacks** `(n)` — each a destructive soft callout with a ⚠ glyph. Empty → "No known drawbacks."
3. **Directions · ideation** `(n)` — each a dashed row with effort tag. Empty → "No directions logged yet."
4. **Depends on** `(n)` — clickable info rows; clicking **focuses/centres/scrolls to** that
   feature (clears any filter that would hide it, expands its surface, re-opens the drawer on it).
   Unmodeled ids render as a muted non-clickable row.
5. **Depended on by** `(n)` — reverse-dep rows (computed), same click-to-focus behavior. This is
   the impact-radius answer ("if I touch this, what breaks?") and is worth surfacing.
6. **Links** — grouped Code / Plans / Memory, each a mono path chip (`--bg-muted`). Paths shown
   verbatim (honest — these are real repo paths/memory slugs; no fake hyperlinks).

---

## 5. Filter + search behavior (identical in all 3)

- **Filter chips** in three groups: Health, Status, Surface. Each chip shows a **live count**.
  Multi-select within a group (OR); groups combine (AND). Active chip = brand-soft bg + brand border.
- **Free-text search** matches `label + summary`, case-insensitive, live on input.
- An empty result set shows an explicit empty state (never a blank page).
- **Click-to-focus from a dep auto-relaxes** any filter/search that would hide the target, so a
  dependency jump never lands on nothing.

---

## 6. Collapse-by-default strategy (the density decision)

**Recommendation: two-level, asymmetric default.**

- **Surfaces: expanded by default.** Only 6 of them; collapsing them hides the whole map and
  defeats discovery. Each surface header carries a tiny stacked **health-composition bar** so a
  collapsed surface still telegraphs its risk profile. Provide Expand-all / Collapse-all.
- **Directions: collapsed by default, expand per-feature.** 27 directions across 63 features is
  the single biggest density tax. Hanging them all open at once is what made raw Mermaid
  unreadable. Default-collapsed, with a per-feature caret + a `↳`/count affordance, keeps the
  ideation layer *one click away* without paying its cost up-front. The drawer always shows the
  full direction list regardless of inline collapse state.

This "surfaces open, directions folded" rule is what keeps all three variants legible at 96 nodes.
In the graph variant the equivalent is: features always shown, dependency edges drawn only on
hover/select (collapse-by-interaction rather than collapse-by-tree).

---

## 7. The three variants — trade-offs

### Variant 1 — Collapsible indented tree (`atlas-variant-1-indented-tree.html`)
By-the-book baseline. Surfaces as collapsible sections, features indented, directions as dashed
sub-leaves under a per-feature caret. **Densest, most legible, most scannable** — the whole atlas
reads top-to-bottom with zero spatial hunting. Surface headers carry the health-composition bar.
*Trade-off:* shows hierarchy and triage well, shows *relationships* (deps) only in the drawer —
no spatial sense of how clusters connect.

### Variant 2 — Cluster graph (`atlas-variant-2-cluster-graph.html`)
Surfaces as radial cluster roots, features fanning outward (multi-ring for dense surfaces so
labels don't collide), directions as dashed leaves; hand-rolled SVG edges + absolute-positioned
divs, full pan/zoom, dependency edges drawn on hover/select. Matches the existing cube join-graph
feel. *Trade-off:* best for **seeing structure and dependency topology**; but at the full 96-node
fit-to-screen, feature labels are small and you must zoom to read — the inherent cost of an
overview graph. Great for "show me the shape of the system", weaker for fast line-item triage.

### Variant 3 — Triage swimlane / kanban (`atlas-variant-3-triage-swimlane.html`)
Novel triage angle. Columns by **status** (toggle: status / health / surface), features as cards,
directions as dashed effort chips on cards, a KPI banner (at-risk / in-flight / planned /
drawbacks / directions counts) up top, and within-lane **health-priority sort** (at-risk first).
*Trade-off:* purpose-built to answer "what's at-risk / what's in-flight right now" in one glance —
the strongest *operational* view. Less good at conveying the Surface→Feature hierarchy (surface
becomes a card subtitle, not a container) unless you switch the lane mode to "By surface".

---

## 8. Recommendation

**Port Variant 3 (triage swimlane) as the primary surface, with Variant 1 (indented tree) as a
secondary "Map" tab.** Rationale: the Atlas's stated job is *living triage + ideation*, and the
swimlane answers the triage question (what needs attention) faster than any other layout, while
the lane-mode toggle (status/health/surface) folds in most of what the tree and a surface-grouped
view provide. Keep Variant 1 as the dense, hierarchy-true reading view for when someone wants to
read the whole atlas linearly. Variant 2 is the best *demo/overview* artifact and the right
choice only if relationship topology (deps between features) becomes a first-class need — defer
it unless that need is confirmed.

All three share the §4 drawer and §2 encoding verbatim, so the React port builds the drawer +
encoding + filter logic once and swaps only the layout component.

---

## Open questions

1. **Direction provenance** — directions are currently free-text ideas with effort. Should P3
   let a direction be promoted into a real plan/feature (write-back), or stay read-only ideation?
   Prototypes are read-only per scope.
2. **`deps` to unmodeled ids** — several deps point at ids not in the snapshot (treated as
   external). Is that a snapshot-completeness gap to fix upstream, or are cross-boundary deps
   expected to stay unresolved?
3. **Health derivation** — is `health` hand-curated in the snapshot, or should P3 derive it from
   drawback count / lastTouched staleness? Affects whether the health channel is editable.
