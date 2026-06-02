# Phase 02 — Glossary edit UI (modal)

## Context Links

- Index page: `src/pages/Catalog/glossary/glossary-index-page.tsx`
- Row component: `src/pages/Catalog/glossary/glossary-row.tsx`
- Search component: `src/pages/Catalog/glossary/glossary-search.tsx`
- API client (extended in phase-01): `src/api/glossary-client.ts`
- i18n: `src/i18n/locales/en.json`, `src/i18n/locales/vi.json`

## Overview

- Priority: P2 (blocks chat usefulness via Official terms — user must be able to promote).
- Status: pending.
- Add edit/create modal launched from index page. Include status pill + one-click toggle, VI fields, alias chips.

## Key Insights

- Modal chosen over new route per locked decision (#6). Lower nav surface; users edit inline.
- shadcn/ui not present in this repo; styling is styled-components. Reuse `var(--*)` tokens already in `glossary-row.tsx`.
- The index page is currently 119 LOC. Adding modal logic inline would push it over the 200-LOC cap → split.

## Requirements

### Functional

- "New term" button in header opens modal in create mode.
- Click on any row's edit affordance (icon button at row trailing edge) opens modal in edit mode populated with row state.
- Status pill in modal: `Draft`/`Official` with one-click toggle (instant PATCH, optimistic flip).
- Form fields: label (EN, required), label_vi, description (EN, required), description_vi, aliases (chip input, comma/Enter to add), aliases_vi (chip input), primary_catalog_id (text), category (text), editor_name (text, prefilled from localStorage `compass:prefs:glossary:editor-name`).
- Delete button visible only when `source='user'`; confirmation prompt before DELETE.
- Validation mirrors phase-01 zod (label ≤80, description ≤500, aliases ≤20 × ≤40).
- After save: refresh list (refetch with ETag short-circuit).
- Status filter chip in toolbar: All / Draft / Official.

### Non-functional

- Modal open/close ≤ 16ms (no remote fetch on open — row data already in memory).
- A11y: focus-trap inside modal; Esc closes; `role="dialog"` + `aria-modal="true"` + labelled by title.
- All new files <200 LOC.

## Architecture

```
GlossaryIndexPage
 ├─ GlossarySearch (existing) + StatusFilter (new inline)
 ├─ "New" button → opens GlossaryEditModal({mode:'create'})
 ├─ List<GlossaryRow onEdit={openModal('edit', term)} />
 └─ GlossaryEditModal
     ├─ GlossaryEditForm  (controlled inputs)
     ├─ GlossaryStatusToggle (one-click PATCH)
     ├─ GlossaryAliasChips (×2 — EN, VI)
     └─ footer: Save / Delete / Cancel
```

State flows via local `useState` in index page; no global store needed.

## Related Code Files

### Modify

- `src/pages/Catalog/glossary/glossary-index-page.tsx` (wire modal open state, add "New" + status filter; pull edit handler from row).
- `src/pages/Catalog/glossary/glossary-row.tsx` (add trailing edit IconButton + status pill).
- `src/api/glossary-client.ts` (already extended in phase-01).
- `src/i18n/locales/en.json`, `src/i18n/locales/vi.json` (new strings: glossary.modal.*, glossary.status.*, glossary.actions.*).

### Create

- `src/pages/Catalog/glossary/glossary-edit-modal.tsx` (shell, <150 LOC)
- `src/pages/Catalog/glossary/glossary-edit-form.tsx` (fields, <180 LOC)
- `src/pages/Catalog/glossary/glossary-status-toggle.tsx` (<80 LOC)
- `src/pages/Catalog/glossary/glossary-alias-chips.tsx` (<120 LOC, reused for EN+VI)
- `src/pages/Catalog/glossary/glossary-status-filter.tsx` (<80 LOC)
- `src/pages/Catalog/glossary/use-glossary-mutations.ts` (hook wrapping client calls with loading/error)

### Delete

- None.

## Implementation Steps

1. Add i18n keys (en + vi). Bilingual placeholders for VI fields ("Bản dịch tiếng Việt").
2. Build `glossary-alias-chips.tsx` — generic chip input (props: value, onChange, placeholder, maxItems). Use as building block.
3. Build `glossary-status-toggle.tsx` — two-button segmented pill calling `setGlossaryStatus(id, status)` from client; optimistic update on parent via prop callback.
4. Build `glossary-edit-form.tsx` — controlled form receiving initial term + onSubmit; client-side validation with same constraints as zod backend.
5. Build `glossary-edit-modal.tsx` — focus-trap (use existing `focus-trap-react` if present, else minimal custom), backdrop click closes, Esc closes, footer with Save/Delete/Cancel.
6. Build `use-glossary-mutations.ts` — wraps createGlossary/updateGlossary/deleteGlossary/setGlossaryStatus with `{state, error, run}` shape.
7. Build `glossary-status-filter.tsx` — three-button segmented (All/Draft/Official) driving a `status` query state in index page.
8. Wire into `glossary-index-page.tsx`: add modal state, new button, refresh-on-save. Add status filter to existing search toolbar row.
9. Update `glossary-row.tsx` to render status pill (Draft = neutral, Official = brand) and trailing edit icon button.
10. Smoke: create a draft, promote to official, edit description_vi, delete draft, confirm seed rows reject DELETE with friendly toast.

## Todo List

- [ ] i18n strings added (en + vi)
- [ ] alias-chips component
- [ ] status-toggle component
- [ ] edit-form component
- [ ] edit-modal shell with focus-trap
- [ ] use-glossary-mutations hook
- [ ] status-filter component
- [ ] index page wired
- [ ] row edit affordance + status pill
- [ ] manual smoke covers all four mutations + DELETE rejection on seed row

## Success Criteria

- User can create a Draft term, toggle to Official, edit VI fields, delete user-created term — all from the index page with no nav.
- Status filter narrows list correctly.
- Promoted rows immediately appear in `?status=official` API (verified via DevTools network).
- Modal a11y: keyboard-only flow works (Tab cycles within, Esc closes, focus restored to trigger).

## Risk Assessment

- **R2.1**: Optimistic toggle then server 4xx → revert local state and show toast. Hook covers via `error` field.
- **R2.2**: User opens modal, edits row, another tab edits same row → last-write-wins. Acceptable for single-user dev; document only.
- **R2.3**: Chip input UX divergence — be conservative: comma + Enter to add, Backspace on empty input removes last.

## Security Considerations

- Render user-supplied `description`, `description_vi`, `editor_name` via React text nodes (auto-escaped) — never `dangerouslySetInnerHTML`.
- Alias values must not contain newlines; strip before send.
- API errors must not leak server stack — phase-01 already returns structured codes.

## Next Steps / Dependencies

- Phase 04 (chat panel chip) reuses no code here; independent.
- Phase 07 (seed enrichment) verifies VI fields render correctly via this UI.
