# Compass — Design handoff

A high-fidelity, interactive prototype for the Cube product layer described in `prd-260519-1930-cube-product-layer-catalog-exploration-proactive.md`. Pair this file with the PRD when handing off to Claude Code.

**Run locally:** open `Compass.html` in a browser. Everything is static — no build step.

---

## What's covered

| PRD § | Surface | File | Fidelity |
|---|---|---|---|
| 5.1 | Catalog (concept-first grid + filter rail + tabs) | `compass/page-catalog.jsx` | Hi-fi, interactive |
| 5.2 | Metric Detail (six panels, inline edit, parameterised picker, right rail) | `compass/page-metric-detail.jsx` | Hi-fi, interactive |
| 5.3 | Grounded NL search (⌘K overlay, suggestions, P4-reserved slot) | `compass/app-shell.jsx` → `GlobalSearchOverlay` | Hi-fi |
| 5.4 | New Concept Wizard (6 steps with metadata at the end + drift detection) | `compass/page-wizard.jsx` | Hi-fi |
| 5.5 | Certified badge + freshness chip (3 prominences) | `compass/patterns.jsx` → `TrustBadge`, `Freshness` | Hi-fi |
| 5.6 | Feedback widget (thumbs) | `compass/patterns.jsx` → `FeedbackWidget` | Hi-fi |
| 5.7 | Verb chips on Explore | `compass/page-explore.jsx` → `VerbChipBar` | Hi-fi, composable |
| 5.8 | Save view modal + Saved Views index | `compass/page-extras.jsx` | Hi-fi |
| 5.9 | Lineage panel (upstream → concept → downstream) | `compass/page-metric-detail.jsx` → `LineageTab` | Hi-fi (no graph engine — uses 3-column layout, which is more legible) |
| 5.10 | Slack-bot block templates | `compass/page-extras.jsx` → `SlackDigestPreview` | Hi-fi mock |
| 5.11 | Metric Digest (subscribe modal + Slack & email previews + preferences) | `compass/page-extras.jsx` → `DigestPage` | Hi-fi |
| 5.12 | Anomaly badge + Change Analysis modal | `compass/patterns.jsx`, `compass/page-extras.jsx` → `ChangeAnalysisModal` | Hi-fi |
| 5.13 | Workspaces index | `compass/page-extras.jsx` → `WorkspacesPage` | Light shell |
| 5.14 | Embedded views | not in this round (light shell only) | — |

Cross-cutting:
- **Trust state machine** — 5 states (certified / beta / draft / deprecated / orphaned) with 3 prominence levels exposed as a Tweak.
- **Drift detection** — shown on `paying_users` (catalog card + detail header) and in the wizard's metadata step.
- **Anomaly states** — 4 states (none / low / high / trending) on Catalog cards, Metric Detail, Explore results, Digest items, Notifications.
- **Empty / partial / error states** — GDS-1.8 import banner on Catalog; "no results" in NL search; deprecated/orphaned filters; draft-with-no-metadata.

---

## File layout

```
Compass.html                          Entry — loads tokens, fonts, Lucide, React, all JSX
compass/
  tokens.css                          Design system tokens (copied from VNGGames Player Hub)
  compass-tokens.css                  Compass-specific extensions (trust states, freshness, anomaly, type, domain)
  primitives.jsx                      Button, Badge, Input, Card, Avatar, Switch, Tabs, Tooltip,
                                      Popover, Modal, Kbd, Sparkline, ToastProvider, …
  patterns.jsx                        TrustBadge, Freshness, AnomalyBadge, TypeIcon, TypeChip,
                                      DomainChip, DriftWarning, FeedbackWidget, UsageChip,
                                      OwnerStamp, Metric, ConceptCard
  data.jsx                            Seed data — 33 concepts (measures / dimensions / segments),
                                      activity feed, lineage, saved views, notifications, change-analysis
  app-shell.jsx                       NavProvider, Sidebar, TopBar, GlobalSearchOverlay (⌘K)
  page-catalog.jsx                    Catalog page (concept tab + by-cube + schema)
  page-metric-detail.jsx              Metric Detail (Overview / Formula / Lineage / Slices / Activity)
  page-explore.jsx                    Explore (left rail + query pills + result viz + verb chips)
  page-wizard.jsx                     New concept wizard (6 steps)
  page-extras.jsx                     Saved Views, Digest, Workspaces, Notifications,
                                      Subscribe / Save-view / Change-analysis modals
  tweaks-panel.jsx                    Tweaks panel chrome (starter component)
  app.jsx                             Root: routing, tweaks, modal management
```

`window` globals are used heavily for cross-script sharing — every component is attached to `window` at the bottom of its file so other Babel scripts can read it.

---

## Interactions wired

End-to-end happy paths the user can click through:

1. **Discovery → Detail → Explore.** Catalog → click a card → Metric Detail → "Open in Explore" → query pre-loaded.
2. **NL search → Detail.** ⌘K → type a phrase → click a result → Metric Detail.
3. **Catalog → Sliced view → Explore.** Metric Detail → "How to slice" → click a dim → Explore with both selected.
4. **Explore composition.** Click verb chips (By country, Compare to last 7d, Filter to whales, Granularity week) — each adds to the current query.
5. **Save view.** Explore → "Save view" → modal → confirm.
6. **Subscribe.** Metric Detail → "Subscribe" → cadence + channel → confirm → toast.
7. **Change analysis.** Click an anomaly badge on a card / Metric Detail / Explore banner / Notification → modal with breakdowns by Country / Channel / Tier.
8. **Wizard.** Sidebar "New metric…" → 6 steps → metadata page → publish → lands on the new concept's detail page.
9. **Edit metadata inline.** Metric Detail → "Suggest edit" / "Edit" → click any field → inline editor.

Routing is in-memory (no URLs). Map to real URLs as listed in PRD §6.

---

## Tweaks exposed

Open the Tweaks panel (bottom-right gear in the toolbar) to flip these on/off live. Each maps to a PRD open question:

| Tweak | Maps to | Options |
|---|---|---|
| **Trust badge prominence** | §10.4 | Quiet · Medium · Loud |
| **Verb chip placement** | §10.5 | Bottom · Right rail |
| **Metric Detail edit pattern** | §10.3 | Inline (Notion) · Toggle (Linear) |
| **NL search framing** | §10.1 | Smart · Strict |

---

## Visual system extensions

New tokens beyond the VNGGames Player Hub system, defined in `compass/compass-tokens.css`:

- **Trust:** `--trust-certified`, `--trust-beta`, `--trust-draft`, `--trust-deprecated`, `--trust-orphaned` (each with `-bg` / `-border` companion).
- **Freshness:** `--fresh-ok`, `--fresh-warn`, `--fresh-stale`.
- **Anomaly:** `--anomaly-low`, `--anomaly-high`, `--anomaly-trend`.
- **Concept type:** `--type-measure` (orange, primary), `--type-dim` (blue, slicer), `--type-segment` (purple, filter), `--type-view`.
- **Domain:** 7 domain colors (revenue, engagement, acquisition, retention, payments, concurrency, marketing).

Type system: kept Inter as the workhorse but **overrode the design system's League Gothic h1/h2/h3** because Compass is an internal data tool, not a brand surface — see top of `compass-tokens.css`. If you want the VNGGames brand-loud look, remove the override.

Numerals use Geist Mono via `--num-font` for tabular alignment.

---

## Open implementation notes for Claude Code

1. **Existing routes.** This prototype assumes the routes in PRD §6. Map `NavContext.go({ name: "metric", id })` → `react-router` `navigate('/metric/' + id)`, etc.
2. **Inline edit save semantics.** Each field commits independently on blur / Enter. Drafts are local until "Submit for approval" (not built — author dialog is the natural follow-on).
3. **Lineage.** The 3-column static layout is intentional — it's more legible than ReactFlow for the shallow graphs Compass typically produces. Replace only if you have lineages >2 layers deep on either side.
4. **Verb chip reachability.** Currently I filter by simple "is this dim/seg already used?". Real reachability should check the cube's join graph — `revenue` joins `users` joins `sessions` — and disable chips whose dim isn't reachable. The `disabled` pattern in `compass/page-explore.jsx` is ready for this.
5. **Search ranking.** `searchConcepts()` in `app-shell.jsx` is a substring scorer with hand-tuned weights. Replace with the embedding pipeline planned for Phase 4 when ready.
6. **Anomaly detection.** Mock data hard-codes anomaly states on a few concepts (`payments.refund_rate` = high, `users.churn_30d` = high, `revenue.ad_vnd` = trend). Wire to a real detector that writes `anomaly` + `deltaPct` per concept per period.
7. **Refresh / freshness.** `refreshMinutes` is a mock number; replace with the cube's actual `refresh_key` timestamp diff.
8. **Drift detection.** `paying_users` is hard-coded with `drift: true`. Real drift check = compare the game's overlay metadata against the canonical GDS-1.8 entry on every read.
9. **Permission gating.** `isAuthor = true` is hard-wired in Metric Detail. Replace with a real authz check that controls visibility of inline-edit affordances.
10. **MCP / CDP / dashboard usage counts.** Mocked. Wire to the usage tracker referenced in PRD §5.5.

---

## Known intentional differences from the PRD

- **No Schema tab content.** The existing `/catalog` schema tab is referenced but not redesigned; my Schema tab is a placeholder.
- **Workspaces canvas (§5.13).** Only the index is built; the canvas itself is deferred.
- **Embedded views (§5.14).** Not in this round.
- **Multi-step agent (§5.15).** Reserved space inside the NL search overlay (the "Coming in v4" hint), not implemented.

---

## Quick map of the codebase

```
Compass.html
└─ <CompassApp>
   ├─ <ToastProvider>
   ├─ <NavProvider initial={{ name: "catalog" }}>
   ├─ <GlobalSearchProvider>  (⌘K overlay)
   ├─ <Router>
   │   └─ <AppShell>
   │       ├─ <Sidebar>
   │       ├─ <TopBar>  (breadcrumbs + global search button + bell + help)
   │       └─ {route body}
   │           ├─ CatalogPage      → ConceptCard grid + FilterRail + Tabs
   │           ├─ MetricDetailPage → 6 panels + right rail
   │           ├─ ExplorePage      → LeftRail + query pills + chart + VerbChipBar
   │           ├─ WizardPage       → 6-step stepper
   │           ├─ SavedViewsPage / DigestPage / NotificationsPage / WorkspacesPage
   ├─ {SubscribeModal, SaveViewModal, ChangeAnalysisModal}  (controlled at root)
   └─ <TweaksPanel>  (4 design-question tweaks)
```
