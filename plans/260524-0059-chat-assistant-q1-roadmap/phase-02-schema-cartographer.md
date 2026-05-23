# Phase 02 — Schema Cartographer (F2)

## Context Links
- Brainstorm: §M1 Track A, F2.
- Existing catalog UI: `src/pages/Catalog/`.

## Overview
- **Priority:** P1 (M1)
- **Status:** pending
- **Description:** Browsable map of cubes / dimensions / measures with plain-English labels, deep-linked from chat answers. Lets non-tech user explore "what data exists" without leaving chat surface.

## Key Insights
- Top friction F1 = users don't know what data exists.
- Cartographer is a **read-only projection** over existing `use-catalog-meta` + `get-cube-meta` tool — no parallel definitions.
- Plain-English label resolution comes from concept glossary (phase-03) when overlap exists; cube-level descriptions come from `getCubeMeta`.

## Requirements

### Functional
- Tree view: Cube → Dimensions / Measures.
- Each node has plain-English label, technical id, type, sample value (when cheap to fetch).
- Search across cubes + members.
- Click member → side-panel with: description, joinable cubes, example query.
- Deep link `/catalog/cube/<id>#member=<member-id>` reusable from chat assistant messages.
- Chat assistant messages can render compact "field chip" linking into cartographer.

### Non-functional
- All metadata cached client-side (reuse `use-catalog-meta`).
- Search debounced 150ms.
- Page rendered <200ms after metadata cache hit.

## Architecture
- **Component:** `src/pages/Catalog/schema-cartographer/` (new dir).
  - `cartographer-page.tsx`
  - `cube-tree.tsx`
  - `member-detail-panel.tsx`
  - `cartographer-search.tsx`
- **Route:** add `/catalog/schema` (in router config).
- **Chat link emitter:** extend `assistant-message.tsx` to recognise `cube/<id>.<member>` tokens and render chip linking to `/catalog/schema?focus=<id>.<member>`.

### Data flow
```
useCatalogMeta() ─► cube-tree ─► onSelect ─► member-detail-panel
                              ↘ search index (memoised)
chat answer (assistant-message) ─► parse field tokens ─► <FieldChip href=/catalog/schema?focus=…>
```

## Related Code Files

### Existing infra
| Capability | Path | Use |
|---|---|---|
| Catalog meta hook | `src/pages/Catalog/use-catalog-meta.ts` | Source data |
| Cube meta tool | `chat-service/src/tools/get-cube-meta.ts` | Confirm fields parity (read-only) |
| Cube cluster groupings | `src/pages/Catalog/use-cube-clusters.ts` | Optional initial tree grouping |
| Assistant message renderer | `src/pages/Chat/components/assistant-message.tsx` | Field chip parsing |

### Create
- `src/pages/Catalog/schema-cartographer/cartographer-page.tsx`
- `src/pages/Catalog/schema-cartographer/cube-tree.tsx`
- `src/pages/Catalog/schema-cartographer/member-detail-panel.tsx`
- `src/pages/Catalog/schema-cartographer/cartographer-search.tsx`
- `src/pages/Catalog/schema-cartographer/use-cartographer-index.ts`
- `src/pages/Catalog/schema-cartographer/__tests__/cartographer-search.test.tsx`

### Modify
- Router: register `/catalog/schema` (locate active router file in `src/App` or `src/shell`).
- `src/pages/Chat/components/assistant-message.tsx` — field-chip parser.

### Delete
- None.

## Implementation Steps
1. Scout existing route registration; add `/catalog/schema`.
2. Build memoised search index over `catalogMeta.cubes[*].members[*]`.
3. Build cube-tree using clusters from `use-cube-clusters`; collapsible per cube.
4. Build member detail panel: render `description`, `type`, `joinableCubes`, `sql` (collapsed).
5. Wire URL state `?focus=<cube>.<member>` for deep links.
6. Parse field-chip tokens in `assistant-message.tsx` (token format TBD — propose markdown extension `{{field:cube.member}}`).
7. Update agent prompt (chat-service `core/`) to emit field tokens in answers. Phase-04 step also depends on this token format — confirm shared spec.
8. Tests: search returns expected hits; deep link focuses correct member; assistant message renders chip.

## Todo List
- [ ] Route registration
- [ ] `use-cartographer-index.ts`
- [ ] `cube-tree.tsx`
- [ ] `member-detail-panel.tsx`
- [ ] `cartographer-search.tsx`
- [ ] `cartographer-page.tsx`
- [ ] Field chip token spec + parser
- [ ] Agent prompt update to emit tokens
- [ ] Tests

## Success Criteria
- All cubes from `use-catalog-meta` browseable.
- Search "DAU" returns the correct measure within top-3.
- ≥50% of chat sessions in M1 surface ≥1 field chip click (telemetry — emit `field_chip_clicked` audit).

## Risk Assessment
| Risk | L | I | Mitigation |
|---|---|---|---|
| Token format collides with markdown | Med | Med | Use `{{field:…}}` pattern absent from any current message. |
| Large catalog perf (>500 members) | Low | Med | Lazy render tree; virtualised list if >100 visible nodes. |
| Agent emits tokens for fields not in catalog | Med | Med | Parser validates against `catalogMeta`; falls back to plain text on miss. |

## Security Considerations
- Read-only over already-public catalog; no PII.
- No new write endpoints.

## Next Steps
- Blocks: phase-06 (editable plan references field chips into cartographer).
- Independent of phase-01, 03, 04, 05.

## Rollback
Unregister `/catalog/schema` route; revert `assistant-message.tsx` chip parser. No data migrations.
