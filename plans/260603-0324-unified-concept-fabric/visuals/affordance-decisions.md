# Affordance Vocabulary — decisions from the P1 hi-fi prototype

Source artifact: `visuals/index.html` (3 clickable screens). These decisions feed
P2 (Linking & Affordance) and P5 (Unified Map). Throwaway prototype — not code.

## Object chips (one glyph language everywhere: chat · build · catalog · map)

| Object | Glyph | Fill token | Ink token | Notes |
|--------|-------|------------|-----------|-------|
| Field (data-model member) | `＃` | `--bg-muted` + `--border-card` | mono, `--text-primary` | code-chip, `font-mono`, always read-only |
| Metric (business metric) | `▦` | `--metric-soft` (QB measure) | `--metric-ink` `#7e5e07` | |
| Concept (glossary term) | `ⓘ` | `--concept-soft` (info) | `--concept-ink` `#2563eb` | matches existing glossary `concept` badge |
| Segment (population) | `◑` | `--segment-soft` (QB segment) | `--segment-ink` `#725390` | |

Glyphs are unicode (no SVG icon dependency) and reuse the QueryBuilder member-type
hues already in `tokens.css`, so a chip's color already means the same thing it
means in the query builder.

## Trust badges (unified ladder — `trust ∈ {draft, certified, deprecated}`)

| Trust | Background | Text | Label |
|-------|------------|------|-------|
| certified | `--success-soft` | `--success-ink` | `✓ certified` |
| draft | `--muted-soft` | `--muted-ink` | `draft` |
| deprecated | `--destructive-soft` | `--destructive-ink` | `deprecated` |

Uppercase pill, `--radius-pill`. Glossary's legacy `official` maps to `certified`
on read (back-compat mapping handled in P2).

## Visibility (orthogonal axis — `visibility ∈ {personal, shared, org}`)

Rendered as a muted inline marker (icon + word), NOT a colored pill — keeps trust
the dominant signal and visibility secondary. Icons: personal = lock, shared =
people, org = globe.

## Term hover-card — typed actions (fixed order)

1. **Define** → `/catalog/glossary#<id>` (the anchored row; P0 already ships this)
2. **Slice by field** → `/build?query=…` filtered by `default_filter_json`
3. **Open segment** → `segments/<id>`
4. **See metric** → `/catalog/metric/<slug>`

Order = definition-first, then the three resolved refs by increasing specificity
(field → segment → metric). Actions only render when the ref exists; the card
never shows a dead action. Parent term (`IS-A`) sits above the action grid as a
text link.

## Map (cross-layer)

- 4 fixed columns: Fields · Metrics · Glossary · Segments, color-keyed by the chip ink.
- Focused concept + its resolved refs get the brand focus ring; unrelated nodes dim.
- Reverse edges drawn brand-colored, low opacity, behind nodes.
- Layer-filter pills toggle columns; `+Add`/`Promote` affordances are dashed,
  brand-colored, and role-gated (disabled-but-visible when the role can't act).

## Role-gating pattern

Disabled affordances stay **visible** (discoverable) but inert, with a `needs
<role>` hint. Editor can propose drafts + share-to-team; certify + org-visibility
require steward/admin. Cube fields are always read-only for end users.

## Open question carried to P2

- `entity_cube` for payer tiers: prototype used `mf_users.payer_tier` (chat's
  choice) — confirm vs `players` against live `/meta` during P2 backfill.
