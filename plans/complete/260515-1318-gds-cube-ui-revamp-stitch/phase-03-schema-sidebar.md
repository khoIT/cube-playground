# Phase 03 — Schema Sidebar Restyle + Cube/View Alias Rename + Icon Picker

## Context Links

- Mockup sidebar: `plans/reports/research-260515-1254-ui-revamp-stitch-standalone-mockup.md` §"Gap Map → 2. Left bar"
- Backend constraint: `plans/reports/research-260515-1311-cube-api-rename-support.md` §F1, §F6, §"Option A"
- Decisions: D1 (alias-only), D2 (lucide free-text), D3 (mono real name), D4 (views get icons too)
- Current file: `src/QueryBuilderV2/QueryBuilderSidePanel.tsx` (531 LOC — restyle, do not rewrite)
- Member rendering helpers: `src/QueryBuilderV2/components/` (verify exact names during step 1)

## Overview

- **Priority:** P1 (Cube alias is a user-facing feature, not just chrome)
- **Status:** completed
- **Brief:** Restyle existing sidebar to match mockup. Add inline alias-rename + icon picker per cube and per view, persisted in localStorage. Real YAML files untouched.

## Key Insights

- Cube backend has zero file-mutation API in dev mode (verified, §F2 + §F3). Rename + delete return 404. Model volume mounted `:ro` (§F1).
- Renaming a real cube would cascade-break views referencing `join_path:` — no API to discover backrefs (§F6).
- Therefore: alias = localStorage map keyed by cube `name`. Survives reload, per-browser, no infra change.
- Views in `/cubejs-api/v1/meta` look identical to cubes (`type: "view"`) — same alias hook works for both (D4).
- Underlying real name must remain visible (D3) so users can write manual queries / SQL.
- lucide-react free-text picker = `<Input>` + filtered icon grid. Curated set is YAGNI (D2).

## Requirements

**Functional**
- Each cube row shows `aliases[name].displayName ?? meta.title ?? meta.name` as primary label.
- Real `meta.name` shown beneath as monospace neutral-500 small text.
- Each cube row has `…` button → popover with: rename input + icon picker + "Reset" link.
- Icon picker: free-text search filtering lucide-react names; selecting one writes alias.
- Same UX applies to view rows.
- Reset clears entry in localStorage map.
- Member tree (measures/dimensions/time/segments) behaviour unchanged.
- Search box unchanged.

**Non-functional**
- All new files < 200 LOC.
- Hook is pure client; no network.
- Renaming or icon change updates UI immediately (React state, not just storage).
- No impact on QueryBuilderContext or query execution.

## Architecture

```
QueryBuilderSidePanel.tsx (restyled — sizing, borders, paddings → tokens)
  └── (existing cube/view row component)
        ├── <CubeRowHeader>          ← restyled
        │     ├── <CubeIcon> ← from use-cube-alias()
        │     ├── displayName        (primary)
        │     ├── real name          (mono, smaller, neutral-500)
        │     └── <CubeRowEditor>    ← NEW popover trigger
        └── existing member sub-tree

src/hooks/use-cube-alias.ts                 ← NEW (D1)
src/QueryBuilderV2/components/cube-row-editor.tsx   ← NEW popover (rename + icon picker)
src/QueryBuilderV2/components/icon-picker.tsx       ← NEW lucide-react search-grid
```

`use-cube-alias` shape (locked from research §"Option A" rev'd for icons + views):

```ts
type Alias = { displayName?: string; icon?: string };
type AliasMap = Record<string, Alias>;          // key = cube OR view name
const STORAGE_KEY = 'gds-cube:cube-aliases';

export function useCubeAlias(name: string) {
  const [map, setMap] = useState<AliasMap>(load);
  const alias = map[name] ?? {};
  const update = (patch: Partial<Alias>) => { ...; localStorage.setItem(...); };
  const reset  = () => { ...; };
  return { alias, update, reset };
}
```

Subscribe to `storage` event to sync across tabs (KISS — single `addEventListener`).

## Related Code Files

**Create**
- `src/hooks/use-cube-alias.ts` (~80 LOC) — hook + storage event listener
- `src/QueryBuilderV2/components/cube-row-editor.tsx` (~150 LOC) — popover (UI-kit `Dialog`/`Modal` or antd `Popover`)
- `src/QueryBuilderV2/components/icon-picker.tsx` (~120 LOC) — search input + filtered icon grid, lucide-react dynamic import

**Modify**
- `src/QueryBuilderV2/QueryBuilderSidePanel.tsx` — restyle row styles (padding, border, font tokens); inject `<CubeRowEditor>` button in cube/view header; replace label render with `displayName` + mono real-name; replace static icon with `alias.icon ?? default`

**Delete**
- None

## Implementation Steps

1. Grep `QueryBuilderSidePanel.tsx` for the line that renders cube name + icon (look for `cube.name`, `cube.title`, icon refs). Identify the right insertion point for `<CubeRowEditor>` trigger.
2. Confirm `lucide-react` already installed (Phase 02). Import on demand.
3. Implement `src/hooks/use-cube-alias.ts`:
   - `load()` from localStorage with `try/catch` around `JSON.parse`.
   - `update(name, patch)` merges + persists.
   - `reset(name)` removes key.
   - `useEffect` listens on `window.addEventListener('storage', ...)` for cross-tab.
   - Export `useCubeAlias(name)` returning `{ alias, update, reset }`.
4. Implement `src/QueryBuilderV2/components/icon-picker.tsx`:
   - Import lucide-react `* as Icons`; cache filtered list of icon names matching query (lowercased substring).
   - Render in a 6-col CSS grid; click → onPick(name).
   - Show ~60 results max; "type to search" hint.
5. Implement `src/QueryBuilderV2/components/cube-row-editor.tsx`:
   - Popover anchored to `…` button.
   - Inputs: `displayName` (text), `icon` (button → opens `<IconPicker>`).
   - Buttons: Save (calls `update`), Reset (calls `reset`), Cancel.
6. In `QueryBuilderSidePanel.tsx`:
   - Per row: call `useCubeAlias(cube.name)`.
   - Render `<Icon name={alias.icon ?? 'database'} />` (cube) or `'eye'` (view) as default.
   - Render `<Label>` showing `alias.displayName ?? cube.title ?? cube.name`.
   - Render `<MonoName>` showing `cube.name` if displayName is set OR always (D3 — always show, keeps mapping obvious).
   - Inject `<CubeRowEditor>` trigger.
   - Restyle row padding to 8px / borders to `var(--border-card)` / font to `var(--font-sans)`.
7. Restyle sidebar shell: 280px width, white bg, `1px solid var(--neutral-200)` right border, sticky.
8. Manual test: rename a cube, refresh, alias persists. Pick icon, refresh, persists. Reset clears. Test on a view too.
9. `npm run build`.

## Todo List

- [ ] Grep + identify cube/view row insertion point in `QueryBuilderSidePanel.tsx`
- [ ] Implement `use-cube-alias.ts`
- [ ] Implement `icon-picker.tsx`
- [ ] Implement `cube-row-editor.tsx`
- [ ] Wire popover trigger + alias rendering into sidebar
- [ ] Add mono real-name below alias
- [ ] Restyle sidebar shell + rows with tokens
- [ ] Manual smoke: rename + icon persists; reset works
- [ ] Cross-tab sync via storage event
- [ ] `npm run build` passes

## Success Criteria

- Setting displayName visible immediately; survives full page reload.
- Mono real name always visible beneath alias.
- Icon shows in row; default fallback when not set.
- Reset removes both displayName + icon for that name.
- Storage event syncs another tab without reload.
- No regression in member-tree expand/collapse, search, click-to-add.
- Build green.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Two tabs race on storage write | Low | Low | Last write wins; storage event reconciles |
| User assumes alias renames the file → bug report | High | Medium | Show "Display only — file unchanged" hint in popover footer |
| lucide-react bundle blows up if naively `import *` | Medium | Medium | Use `import * as Icons from 'lucide-react'` (tree-shaken at build) — verify build size; switch to dynamic import if regression |
| Member tree picks up wrong key when meta refreshes | Low | Medium | Alias keyed by `meta.name` which is stable across refresh |
| QBv2 internal rerender if we wrap rows | Medium | Low | Wrap minimally; preserve existing memoisation |

## Security Considerations

- localStorage is per-origin and not encrypted — alias text is non-sensitive. OK.
- No data leaves the browser. No XSS surface (display name rendered as text, never `dangerouslySetInnerHTML`).

## Rollback

- Remove three new files + revert `QueryBuilderSidePanel.tsx` block. Alias entries in users' localStorage become orphaned but harmless.

## Migration / Backwards Compatibility

- No existing localStorage key collides (`gds-cube:cube-aliases` is new namespace).
- Falls back gracefully when alias missing (shows `meta.title ?? meta.name`).

## Next Steps

Unblocks phase 4 (member-pill labels reuse the alias for display).

## Unresolved Questions

- Should icon picker also expose a "color" tag (mockup uses muted neutrals)? Defer — YAGNI for v1.
- Sync alias map to a backend later? Out of scope for v1; document in v2 deck.

Status: DONE
