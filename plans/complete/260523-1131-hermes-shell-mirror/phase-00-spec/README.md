# Phase 0 — Spec & Reference

Pre-implementation deliverables for the Hermes shell mirror. All five files in this dir feed into `/ck:plan` so phases 1-9 are mechanical execution.

**Brainstorm:** [`plans/reports/brainstorm-260523-1054-hermes-shell-mirror.md`](../../reports/brainstorm-260523-1054-hermes-shell-mirror.md)

---

## Artifacts

| # | File | Purpose |
|---|---|---|
| 1 | [`token-inventory.md`](./token-inventory.md) | Every `--hermes-*` CSS var (light + dark) to append to `src/theme/tokens.css`. `T` proxy definition. Selector swap `html.dark` → `html[data-theme="dark"]`. |
| 2 | [`pixel-spec.md`](./pixel-spec.md) | Magic numbers table per surface — outer shell, sidebar (item/section/subheader/collapsed/tooltip), bottom-row, collapse-toggle, topbar (breadcrumb/search/avatar), z-index map, color cheats. |
| 3 | [`port-manifest.md`](./port-manifest.md) | File-by-file source → dest table, RR6→RR5 swap notes, import substitutions, order of operations across 9 PRs. |
| 4 | [`font-audit.md`](./font-audit.md) | Cube loads Inter + Geist + Geist Mono. **Missing: League Gothic** — single `index.html` link edit. |
| 5 | [`huashu-prototype.html`](./huashu-prototype.html) | Self-contained working clone of the new shell. Open in browser, toggle theme + sidebar to visually validate before any React code lands. |

---

## How to use during /ck:plan

`/ck:plan` should consume **brainstorm report** + **this dir** as input. Each phase file references:

- **Phase 1 (Tokens)** ← `token-inventory.md` § "Patch to apply" + "Dark variant"
- **Phase 2 (Stores & utils)** ← `port-manifest.md` § "Shell — sidebar utils"
- **Phase 3 (Sidebar primitives)** ← `port-manifest.md` § "Shell — sidebar" + `pixel-spec.md` § "SidebarItem" / "WorkspacePill" / "SidebarSection" / "SidebarSubheader" / "BottomRow" / "CollapseToggle"
- **Phase 4 (Topbar primitives)** ← `port-manifest.md` § "Shell — topbar" + `pixel-spec.md` § "Topbar"
- **Phase 5 (Custom sections)** ← `port-manifest.md` § "Custom sections" + `pixel-spec.md` § "Sidebar IA"
- **Phase 6 (App shell + routes)** ← `port-manifest.md` § "Shell — chrome glue" + `pixel-spec.md` § "Outer shell"
- **Phase 7 (Segments library)** ← brainstorm § 5 Phase 6 + `port-manifest.md` § "Segments library"
- **Phase 8 (Segments detail restyle)** ← brainstorm § 5 Phase 7 + `port-manifest.md` § "Segments detail"
- **Phase 9 (Visual + E2E)** ← brainstorm § 7 Success Criteria + `huashu-prototype.html` as the visual baseline

---

## How to use during implementation

1. **Phase 1 starts:** open `token-inventory.md` next to `src/theme/tokens.css`. Append the two blocks (light + dark). Run `npm run dev` — toggle dark mode → `--hermes-*` vars should flip.
2. **Phase 2+:** open `huashu-prototype.html` in browser as the visual target. Side-by-side with `pnpm dev` Hermes on `localhost:5173`. They should look identical.
3. **For each file port:** find row in `port-manifest.md`. Apply listed modifications. Reference `pixel-spec.md` for any magic number.
4. **Stuck on a behavior?** Re-read the Hermes source path listed in the manifest row.

---

## Pre-flight checks (run before Phase 1)

```bash
# 1. Verify cube loads required fonts in dev
grep "Inter\|Geist" /Users/lap16299/Documents/code/cube-playground/index.html

# 2. Verify Hermes source files still in expected paths
ls /Users/lap16299/Documents/code/hermes/apps/web/src/components/sidebar/
ls /Users/lap16299/Documents/code/hermes/apps/web/src/components/topbar/

# 3. Confirm cube's RR API matches manifest assumptions
grep -n "react-router-dom" /Users/lap16299/Documents/code/cube-playground/src/index.tsx
grep -n "react-router-dom" /Users/lap16299/Documents/code/cube-playground/package.json
```

Expected output:
- Cube `package.json`: `react-router-dom: 5.x`
- Cube `index.tsx`: uses `Router`, `Route`, `Redirect`, `Switch` (RR5 API)

---

## Resolved decisions (locked from brainstorm)

| # | Decision |
|---|---|
| Strategy | **A. Inline-style shell + hybrid tokens.** Cube AntD overrides untouched. |
| Tokens | Replace cube `tokens.css` *additions only* — append Hermes vars. Don't rewrite existing cube vars. |
| Segments | Library mirrors Hermes look. Detail keeps cube's 5 tabs, restyled with Hermes tokens. |
| Chat | Sidebar section + `/chat` empty-state. No right rail. No FAB. |
| Root | `/` hard-redirects to `/build`. |
| Sidebar collapse | Port 260↔60 + hover tooltip + localStorage. |
| Dark mode | Port Hermes' dark CSS var set, selector adapted to `html[data-theme="dark"]`. |
| Catalog split | Catalog → **Data Model** (Feature-Store-shape) + **Metrics Catalog** as separate sidebar entries. |
| Topbar | Breadcrumb + GamePicker (trailing slot) + SmartSearch + Theme/Lang/Help/Notif/UserMenu. |
| Bottom row | API Settings trigger + Theme toggle. |
| i18n | Add `nav.chat`, `nav.dataModel`, `nav.metricsCatalog`, `nav.advanced`, `nav.dataModelNew` to `en.json` + `vi.json`. |
| design-reference | Vendor full `hermes/design-reference/` tree into `cube-playground/design-reference/`, excluded from build. |
| Workspace pill | `GDS` glyph + "Cube Playground" + "Self-serve data exploration". |

---

## Estimated implementation time

| Phase | Est. (focused) |
|---|---|
| 1. Tokens | 20 min |
| 2. Stores & utils | 30 min |
| 3. Sidebar primitives (7 files) | 90 min |
| 4. Topbar primitives (5 files) | 60 min |
| 5. Custom sections (sidebar IA + data-model section) | 60 min |
| 6. App shell + routes + chat placeholder | 45 min |
| 7. Segments library rewrite | 2-3 hr |
| 8. Segments detail restyle | 60 min |
| 9. E2E + visual diff | 90 min |
| **Total** | **~10 hr focused** |

With Phase 0 spec in hand, expect <2 deviation iterations per phase vs ~5 without.

---

## Open questions

None — all 4 resolved in brainstorm (see brainstorm § "Resolved decisions").
