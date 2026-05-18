# Phase 02 — Top Bar Rewrite

## Context Links

- Mockup anatomy: `plans/reports/research-260515-1254-ui-revamp-stitch-standalone-mockup.md` §"Mockup Anatomy" + §"Gap Map → 1. Top menu"
- Current file: `src/components/Header/Header.tsx` (72 LOC, verified)
- Current menu helper: `src/components/Header/Menu.tsx`
- Phase 01 tokens required

## Overview

- **Priority:** P1 (highest visibility surface)
- **Status:** completed
- **Brief:** Replace antd `<Menu>` with a custom pill-button row. New brand area `Cube · VNGGames · Data Platform`. Use lucide-react icons. Routes (`/build`, `/schema`) unchanged.

## Key Insights

- Mockup top bar = 32px-tall pill buttons, `border-radius:8px`, icon + label, brand-coloured pill for active.
- antd `<Menu mode="horizontal">` brings unwanted hover/animation. Plain JSX with `<Link>` from react-router-dom v5 is enough.
- Mobile dropdown can stay as-is (antd `Dropdown` + `MenuOutlined`) but restyle the trigger.
- "Metrics•3", "+Request metric", "📥3", "?", "⚙", avatar = OUT OF SCOPE (D9). Keep room visually but don't wire functionality. Just brand area + nav pills + spacer.

## Requirements

**Functional**
- `/build` route highlights "Playground" pill; `/schema` highlights "Models" pill.
- Active pill style = brand-orange background, white text.
- Inactive pill = neutral text, hover = neutral-100 bg.
- Brand area is clickable → `/build`.
- Mobile (≤991px): collapse pills into a single Dropdown trigger.

**Non-functional**
- File < 200 LOC (modularise if needed into `src/components/Header/nav-pill.tsx`).
- No new runtime deps beyond `lucide-react` (added once in phase 03).
- Maintains `selectedKeys` prop contract from caller.

## Architecture

```
Header.tsx
 ├── <BrandBlock>            "Cube" + divider + "VNGGames" logo + "Data Platform" badge
 ├── <NavPillRow>            desktop only
 │     ├── <NavPill to="/build" icon={LayoutDashboard}>Playground</NavPill>
 │     └── <NavPill to="/schema" icon={Database}>Models</NavPill>
 └── <MobileMenu>            ≤991px collapsed Dropdown
```

`<NavPill>` is a small styled-component using react-router-dom v5 `<Link>`. Active state derived from `selectedKeys.includes(to)` passed via prop.

## Related Code Files

**Modify**
- `src/components/Header/Header.tsx` — full rewrite of return JSX, keep `Props` shape
- `src/components/Header/Menu.tsx` — delete contents OR repurpose; if styled-component shells unused, delete file

**Create**
- `src/components/Header/nav-pill.tsx` — `<NavPill>` styled-component (~40 LOC)
- `src/components/Header/brand-block.tsx` — `<BrandBlock>` (~30 LOC)

**Delete**
- `src/components/Header/Menu.tsx` if no other importer (grep `from '.\/Menu'` first)

**Caller (no change)**
- Anywhere `<Header selectedKeys={...} />` is mounted (likely `src/components/Layout/Layout.tsx` — verify).

## Implementation Steps

1. `npm i lucide-react` (devDep). Verify tree-shake works with Vite default.
2. Grep imports of `./Menu` from `src/components/Header/` to confirm deletion safety.
3. Create `nav-pill.tsx` with styled `<Link>` accepting `to`, `icon`, `active`, children. Active uses `var(--brand)` bg + white text; inactive uses transparent + `var(--text-primary)`; hover `var(--neutral-100)`.
4. Create `brand-block.tsx`. Layout: `"Cube"` (Geist 600) + thin divider + VNG mark (placeholder SVG OK — note for design) + `Data Platform` neutral-200 pill.
5. Rewrite `Header.tsx`:
   - Drop antd `<Menu>` import.
   - Use `Layout.Header` shell only for sticky positioning; replace inline styles with token vars (`background: var(--bg-card)`, `border-bottom: 1px solid var(--border-card)`, white not dark).
   - Render `<BrandBlock>` + `<NavPillRow>` on desktop; mobile branch unchanged besides trigger restyle.
6. Update `selectedKeys` plumbing — caller passes `[location.pathname.startsWith('/build') ? '/build' : '/schema']`; verify in caller.
7. `npm run build` + open `/build` and `/schema` to confirm route highlighting.

## Todo List

- [ ] `npm i lucide-react`
- [ ] Grep `./Menu` importers; decide delete vs keep
- [ ] Create `nav-pill.tsx`
- [ ] Create `brand-block.tsx`
- [ ] Rewrite `Header.tsx` return JSX
- [ ] Verify mobile dropdown still works
- [ ] Visual smoke: active route highlighted in brand orange
- [ ] `npm run build` passes

## Success Criteria

- Header renders white bg with neutral border-bottom (no dark-02 anymore).
- Pill row visible on ≥992px; dropdown on <992px.
- Clicking pill navigates and highlights immediately.
- No antd `<Menu>` in rendered DOM under header.
- Geist 600 visible on "Cube" wordmark.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `selectedKeys` caller logic differs from antd Menu key shape | Medium | Low | Wrap with simple `active = selectedKeys.includes(to)` check |
| react-router-dom v5 `<Link>` styling collides with styled-components v6 | Low | Low | Use `styled(Link)` pattern already used elsewhere in codebase |
| VNG logo asset missing | Medium | Low | Inline placeholder SVG; design follow-up after phase 6 |
| lucide-react bundle weight | Low | Low | Tree-shaken per-icon import; ~3-4 icons total here |

## Security Considerations

- None. Static markup, no new data flow.

## Rollback

- Single-file revert restores antd `<Menu>` (keep old code in a `// LEGACY` comment block during PR review only — delete on merge).

## Next Steps

Independent of phases 3/4/5 once tokens exist. Phase 6 verifies overall look.

## Unresolved Questions

- Source for VNG logo SVG — placeholder for now; design team to provide.
- "Data Platform" badge — fixed text or env-driven? Assume fixed string.

Status: DONE
