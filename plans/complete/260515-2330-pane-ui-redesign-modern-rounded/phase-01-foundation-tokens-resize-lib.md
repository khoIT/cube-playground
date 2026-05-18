---
phase: 1
title: "Foundation: tokens & resize lib"
status: complete
priority: P2
effort: "2-3h"
dependencies: []
---

# Phase 1: Foundation — tokens & resize lib

## Overview

Add the minimal token gaps (pane-level radius/gap/shadow), install `react-resizable-panels`, and build a thin wrapper component (`AppPaneGroup`, `AppPane`, `AppResizeHandle`) that joins the new resize lib to the existing tasty/ui-kit content model.

## Requirements

**Functional**
- New tokens for pane gap and (optional) larger pane radius
- `react-resizable-panels` installed and importable
- Wrapper components that accept a `qa` attribute, persist size in localStorage, support disabled mode

**Non-functional**
- Zero behavior change to call sites in this phase (call sites swap in Phase 2)
- TypeScript strict-mode clean
- File size ≤ 200 lines per wrapper module

## Architecture

```
+-----------------------------------------+
| AppPaneGroup (HorizontalPanelGroup)    |
|  +------+ <handle> +-------+ <handle> +------+
|  | Pane |          | Pane  |          | Pane |
|  +------+          +-------+          +------+
+-----------------------------------------+
```

- `AppPaneGroup` wraps `<PanelGroup direction="horizontal" autoSaveId="...">` from `react-resizable-panels`. Persistence is via the lib's `autoSaveId` (writes to localStorage automatically).
- `AppPane` wraps `<Panel defaultSize minSize maxSize collapsible>`; styles outer container as a rounded card (radius, border, shadow, white fill).
- `AppResizeHandle` wraps `<PanelResizeHandle>`; renders an invisible 12-16px-wide hit area showing the `--bg-app` gap.

## Related Code Files

- **Create:** `src/components/AppPanes/AppPaneGroup.tsx`
- **Create:** `src/components/AppPanes/AppPane.tsx`
- **Create:** `src/components/AppPanes/AppResizeHandle.tsx`
- **Create:** `src/components/AppPanes/index.ts`
- **Modify:** `src/theme/tokens.css` (add pane gap, optional larger pane radius)
- **Modify:** `package.json` (add `react-resizable-panels`)

## Implementation Steps

1. **Install lib**
   - `npm install react-resizable-panels@^2 --legacy-peer-deps`
   - Pin to v2.x in `package.json`. v2 ships `minSizePixels`/`maxSizePixels`/`defaultSizePixels` which we rely on in Phase 2 to preserve current px-based mins.
   <!-- Updated: Validation Session 1 - pin v2 for minSizePixels API -->
   - Verify pinned version in `package.json` (lib targets React 18+, ESM, matches our `react ^18.3.1` peer)

2. **Extend `tokens.css`** — add inside `:root {}`:
   ```css
   --pane-gap: 10px;        /* gap between panes (matches reference ~10px) */
   --radius-pane: 14px;     /* slightly larger than inner cards' --radius-card: 12px */
   --shadow-pane: 0 1px 2px rgba(0, 0, 0, 0.04), 0 1px 1px rgba(0, 0, 0, 0.03);
   --bg-pane-rail: var(--bg-app);  /* color shown in resize-handle gap */
   ```
   Keep existing `--radius-card`, `--bg-card`, `--border-card`, `--shadow-xs` — they remain the inner-card tokens.

3. **Create `AppPane.tsx`** (≤80 lines) — a styled-components wrapper:
   ```tsx
   const PaneShell = styled.section<{ $padded?: boolean }>`
     display: flex;
     flex-direction: column;
     height: 100%;
     min-height: 0;
     background: var(--bg-card);
     border: 1px solid var(--border-card);
     border-radius: var(--radius-pane);
     box-shadow: var(--shadow-pane);
     overflow: hidden;
   `;
   ```
   Props: `defaultSize?: number` (percent), `minSize?: number`, `maxSize?: number`, `collapsible?: boolean`, `id: string`, `order?: number`, `children`.
   Internally: `<Panel id={id} defaultSize={defaultSize} minSize={minSize ?? 12} order={order}><PaneShell>{children}</PaneShell></Panel>`.

4. **Create `AppResizeHandle.tsx`** (≤50 lines):
   ```tsx
   const Rail = styled(PanelResizeHandle)`
     width: var(--pane-gap);
     background: transparent;
     cursor: col-resize;
     position: relative;

     &[data-resize-handle-active] {
       background: rgba(0, 0, 0, 0.04);
     }
   `;
   ```
   No visible thumb — gap *is* the handle. Hover state optional (subtle).

5. **Create `AppPaneGroup.tsx`** (≤60 lines):
   ```tsx
   const Group = styled(PanelGroup)`
     width: 100%;
     height: 100%;
     padding: var(--pane-gap);
     gap: 0; /* spacing comes from handle width */
     background: var(--bg-app);
   `;
   ```
   Props: `autoSaveId: string` (localStorage key for the lib), `direction?: 'horizontal' | 'vertical'` (default horizontal), `children`.

6. **Create `index.ts`** re-exporting the three wrappers + lib types.
   <!-- Updated: Validation Session 1 - no `@/` alias; use relative imports -->
   - Consumers import via relative paths (e.g. `import { AppPaneGroup, AppPane, AppResizeHandle } from '../../components/AppPanes'`). Project tsconfig has `baseUrl: "."` with **no `paths` mapping** — `@/` alias does NOT resolve.

7. **Compile check**: `npm run typecheck`.

## Todo List

- [ ] Install `react-resizable-panels` (--legacy-peer-deps)
- [ ] Add 4 tokens to `tokens.css`
- [ ] `AppPane.tsx` written and exports compile
- [ ] `AppResizeHandle.tsx` written and exports compile
- [ ] `AppPaneGroup.tsx` written and exports compile
- [ ] `index.ts` barrel created
- [ ] `npm run typecheck` passes

## Success Criteria

- [ ] `react-resizable-panels` in `package.json` dependencies and in lockfile
- [ ] Four new tokens visible in `tokens.css`
- [ ] `src/components/AppPanes/` directory with 4 files exists
- [ ] `import { AppPaneGroup, AppPane, AppResizeHandle } from '../../components/AppPanes'` resolves from `src/QueryBuilderV2/`. No `@/` alias is added — project uses relative imports throughout.
- [ ] TypeScript compiles cleanly (`npm run typecheck`)
- [ ] No call sites changed yet — pure additive phase

## Risk Assessment

- **Peer-dep conflict**: project uses `--legacy-peer-deps`; lib advertises React 18 peer. Already aligned. Mitigation: `npm install --legacy-peer-deps`.
- **SSR**: not applicable (Vite SPA). No `window` guards needed.

## Security Considerations

None. Pure UI dependency, no network / storage of secrets.

## Next Steps

→ Phase 2 swaps the two existing `ResizablePanel` call sites onto these wrappers.
