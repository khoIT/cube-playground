# Brainstorm — Hermes Shell Mirror for cube-playground

**Date:** 2026-05-23 10:54 ICT
**Source repo:** `/Users/lap16299/Documents/code/cube-playground`
**Reference repo:** `/Users/lap16299/Documents/code/hermes`
**Author:** Claude (Opus 4.7) + khoitn@vng.com.vn
**Status:** ✅ Agreed + all open Qs resolved — ready for /ck:plan

---

## 1. Problem Statement

Mirror Hermes' chat-first IA shell (260px left sidebar + rounded main panel + 56px topbar) inside cube-playground, **without breaking any existing functionality** (Playground query builder, Catalog tabs, Segment detail tabs, GamePicker, dark mode, SmartSearch, push-to-CDP, etc.).

### Hard constraints

- **Zero functional regressions** — every working feature today still works.
- **Pixel parity** with Hermes for: sidebar (spacing, icons, hover, collapse), workspace pill, topbar, Segments **library** page.
- **Root `/` lands on Playground** (hard redirect → `/build`).
- **Chat = placeholder**: sidebar section + `/chat` empty-state page only. No right rail, no FAB.
- **Sidebar collapse** to 60px icon rail w/ hover tooltip + localStorage persistence (Hermes parity).
- **Dark mode preserved** — port Hermes' dark CSS-var set alongside light.

### Soft constraints

- Catalog splits into two sidebar entries: **Metrics Catalog** + **Data Model**.
- **Data Model section** mirrors Hermes' Feature Store section shape (`+ New data model` CTA replaces `+ Register feature`; Pinned / Recently viewed / New this month sub-lists when non-empty).
- Topbar trailing slot preserves cube's `GamePicker + SmartSearch + ThemeToggle + LanguageToggle + Help + NotificationBell + UserMenu + API Settings`.
- Segment **library** mirrors Hermes look (goal-grouped rows, sparklines, mini-avatars, filter rail). Segment **detail** keeps cube's 5 tabs (Monitor/Insights/Members/Definition/Activation) but restyled with Hermes tokens.

---

## 2. Current State (verified)

### cube-playground

- Shell: `src/App.tsx` mounts `<Layout>` with top `<Header>` (44px) holding `BrandBlock + GamePicker + 4 NavPills + RightCluster`. `<StyledLayoutContent>` renders routed children below.
- Router: react-router-dom v5 API (`Switch`, `useHistory`, `withRouter`) inside hash history.
- Tokens: `src/theme/tokens.css` (422 lines) — `--brand #f05a22`, `--bg-card`, `--text-primary`, …; `antd-overrides.css` rebinds AntD to these vars.
- Provider stack: `AppContextProvider → GameContextProvider → ThemeProvider → SecurityContextProvider → App → SmartSearchProvider`.
- Routes: `/` → IndexPage, `/build` → ExplorePage, `/catalog/*` → CatalogPage (internal tabs metrics / data-model / digest / notifications / saved-views / workspaces), `/segments/*` → SegmentsPage, `/data-model/new` → wizard.

### Hermes

- Shell: `apps/web/src/App.tsx` mounts `<Sidebar/> | <main rounded card><Topbar/><AppRoutes/></main> | <ChatRail/> + <AskHermesFab/>` inside outer flex with 10px padding + 8px gap, `T.shell` background.
- Sidebar (`components/sidebar/sidebar.tsx`): 260/60 widths, WorkspacePill (56px) + scrollable nav + BottomRow + edge CollapseToggle. Sections: Chat (`MessageSquare`) → Feature Store (custom) → Segments (`Users`) → Boards (`Layers`) → Campaigns (`Send`) → Advanced Features (expand-only `MoreHorizontal` parent for Playbooks/Funnels/Retentions/Knowledge).
- Active item style: 3px brand left bar (`T.brand`) + semibold text; sub-row uses box highlight not bar (avoids clash w/ tree-line guide).
- Collapsed-mode icon row: 32px height, hover → `rgba(0,0,0,0.04)` bg + floating dark tooltip at `r.right + 8px`.
- Topbar (`components/topbar/topbar.tsx`): 56px sticky, blur backdrop, `Breadcrumb` + trailing slot (via context) + `SearchTrigger` + `AvatarMenu`.
- Tokens: `theme.tsx` exports `T` proxy → `--hermes-*` CSS vars in `theme-tokens.css` (150 lines, light + dark via `html.dark`).

---

## 3. Evaluated Approaches

| | A. Inline-style shell + hybrid tokens **(CHOSEN)** | B. Full token replacement | C. Two themes by route |
|---|---|---|---|
| **Tokens** | Vendor `--hermes-*` alongside cube's `--brand`/`--bg-card`. Both coexist. | Replace cube tokens.css; rename ~30 files' var refs. | Cube tokens for /build; Hermes for everything else. |
| **AntD risk** | None — AntD overrides untouched. | High — every AntD widget shifts. | Medium — boundary leak via portals (Dropdown, Modal). |
| **Files touched (est)** | ~25 new (shell), ~5 modified (App, index, routes) | ~25 new, ~30 modified | ~25 new, ~10 modified |
| **Maintenance** | One-way port; manual sync per Hermes change. | One-way port; broader blast radius. | Dual theme drift over time. |
| **"Pixel parity" feasibility** | High for Hermes-styled surfaces; cube AntD surfaces stay current-look | Highest if all overrides re-tuned | High inside Hermes-scoped routes, none in /build |
| **Functional regression risk** | Lowest | High | Medium |

### Why A wins

User's hard constraint ("ensure all existing function working") drops B and C. A vendors Hermes shell verbatim, keeps AntD-themed pages visually as-is, but wraps them in the Hermes shell. Visual delta lands where the user asked: shell + segments-library. Other AntD pages render inside the rounded main card and pick up the Hermes neutral background, no AntD-internal restyle needed.

---

## 4. Final Architecture

### 4.1 New shell layout

```
┌────────────── outer flex (T.shell, 10px pad, 8px gap) ──────────────┐
│                                                                       │
│ ┌─ aside (260/60) ─┐ ┌──────────── <main> rounded card ───────────┐ │
│ │ WorkspacePill     │ │ Topbar (56px sticky)                       │ │
│ │   "GDS Cube" logo │ │   Breadcrumb | GamePicker | SmartSearch    │ │
│ │                   │ │     ThemeToggle Lang Help Notif UserMenu   │ │
│ │ Chat              │ ├────────────────────────────────────────────┤ │
│ │ Playground        │ │                                            │ │
│ │ Data Model   ▾    │ │   <AppRoutes/>                             │ │
│ │   + New           │ │     /          → Redirect /build           │ │
│ │   Recently viewed │ │     /build     → ExplorePage (unchanged)   │ │
│ │ Metrics Catalog ▾ │ │     /catalog/* → CatalogPage (restyled)    │ │
│ │ Segments     ▾    │ │     /segments  → Hermes-style LibraryView  │ │
│ │ Advanced     ▾    │ │     /segments/:id → restyled DetailView    │ │
│ │                   │ │     /chat      → ChatPlaceholderPage       │ │
│ │ BottomRow         │ │                                            │ │
│ │ CollapseToggle    │ │                                            │ │
│ └───────────────────┘ └────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────┘
```

### 4.2 Sidebar IA (final)

| Section | Icon | Route | Sub-rows |
|---|---|---|---|
| **Chat** | `MessageSquare` | `/chat` | "No recent items" (placeholder) |
| **Playground** | `LayoutDashboard` | `/build` | flat (no expand) |
| **Data Model** | `Grid` | `/catalog/data-model` | `+ New data model` → `/data-model/new?v=2`, Recently viewed (cubes/views), New this week |
| **Metrics Catalog** | `BookOpen` | `/catalog/metrics` | Recently viewed metrics, "See all" |
| **Segments** | `Users` | `/segments` | RecentItems (Hermes pattern) |
| **Advanced** | `MoreHorizontal` | (expand-only) | Digest, Notifications, Saved views, Workspaces, Identity Map |

### 4.3 File layout

```
cube-playground/src/
├─ shell/                               ★ NEW — Hermes-vendored
│  ├─ theme.tsx                         (T tokens, Icon, primitives — pruned to what shell needs)
│  ├─ theme-tokens.css                  (--hermes-* light + dark; appended to existing tokens.css)
│  ├─ sidebar/
│  │  ├─ sidebar.tsx
│  │  ├─ sidebar-item.tsx
│  │  ├─ sidebar-section.tsx
│  │  ├─ sidebar-subheader.tsx
│  │  ├─ workspace-pill.tsx             (GDS Cube branding instead of Hermes VG)
│  │  ├─ bottom-row.tsx                 (settings entry / user mini)
│  │  ├─ collapse-toggle.tsx
│  │  ├─ recent-items.tsx               (reuses cube's recent-items store; new util)
│  │  ├─ sidebar-data-model-section.tsx ★ NEW (Feature-Store-shaped)
│  │  └─ utils-collapsed-store.ts       (localStorage 'gds-cube:sidebar-collapsed')
│  └─ topbar/
│     ├─ topbar.tsx
│     ├─ breadcrumb.tsx                 (derives from route)
│     ├─ search-trigger.tsx             (opens existing SmartSearch overlay)
│     ├─ topbar-trailing-context.tsx    (slot for page-owned actions)
│     └─ avatar-menu.tsx                (wraps existing user-menu)
│
├─ pages/Segments/library/              ★ REWRITTEN to Hermes look
│  ├─ library-view.tsx                  (goal-grouped rows, sparklines, mini-avatars)
│  ├─ library-filter-rail.tsx           (left rail: GROUP BY / GOAL / STATUS / HAS CAMPAIGNS)
│  ├─ library-meta-line.tsx             (existing — keep behaviour, restyle)
│  └─ … existing files kept where unchanged
│
├─ pages/ChatPlaceholder/               ★ NEW
│  └─ chat-placeholder-page.tsx         (empty-state w/ "Chat coming soon" + CTA back to /build)
│
├─ App.tsx                              ◆ REWRITTEN — outer flex, no Header
├─ components/Header/                   ✂ DELETED (game-picker + right-cluster relocated)
│  → game-picker moves to shell/topbar/topbar-trailing slot
│  → right-cluster bits relocated into avatar-menu + topbar
│
├─ index.tsx                            ◆ MODIFIED — / redirects to /build
│
└─ theme/
   ├─ tokens.css                        ◆ MODIFIED — append --hermes-* vars (light + dark)
   ├─ ThemeContext.tsx                  ◆ ensures html.dark toggle flips both var sets
   └─ antd-overrides.css                ✓ untouched
```

### 4.4 Route changes (RR5 API preserved)

```diff
- <Route key="index" exact path="/" component={IndexPage} />
+ <Route key="index" exact path="/"><Redirect to="/build" /></Route>
+ <Route key="chat" exact path="/chat" component={ChatPlaceholderPage} />
+ <Route key="catalog-data-model-default" exact path="/catalog">
+   <Redirect to="/catalog/data-model" />
+ </Route>
```

All other routes unchanged. `IndexPage` deleted from `src/pages/Index/`.

### 4.5 Provider stack changes

```
AppContextProvider
  GameContextProvider
    ThemeProvider                  ← still drives html.dark; flips --hermes-* + cube vars together
      SecurityContextProvider
        Router
          SidebarCollapsedProvider ★ NEW (localStorage-synced)
            TopbarTrailingProvider ★ NEW
              SmartSearchProvider
                <App>              ← App now renders sidebar/main/topbar shell
                  <Routes>
```

### 4.6 Token bridge

`tokens.css` gains:

```css
:root {
  /* Hermes neutrals (light) */
  --hermes-n50:  #fafafa; --hermes-n100: #f5f5f5; --hermes-n200: #e5e5e5;
  --hermes-n300: #d4d4d4; --hermes-n400: #a3a3a3; --hermes-n500: #737373;
  --hermes-n600: #525252; --hermes-n700: #404040; --hermes-n800: #262626;
  --hermes-n900: #171717; --hermes-n950: #0a0a0a;

  --hermes-brand:        #f05a22;   /* same as cube --brand */
  --hermes-brand-hover:  #d94d18;
  --hermes-brand-soft:   #fff2eb;
  --hermes-brand-border: #f8c9b0;

  --hermes-surface:        #ffffff;
  --hermes-surface-muted:  #fafafa;
  --hermes-shell:          #f3f1ec;
  --hermes-sidebar:        #ffffff;
  --hermes-topbar:         rgba(255,255,255,0.7);
}

html.dark {
  --hermes-n50:  #0a0a0a; --hermes-n100: #171717; …
  --hermes-surface: #0a0a0a; --hermes-shell: #060606; …
}
```

(Exact values copied from `apps/web/src/theme-tokens.css`; ~60 vars in each block.)

---

## 5. Implementation Plan (phased)

| Phase | Scope | Files | Verify |
|---|---|---|---|
| **1. Token bridge** | Append `--hermes-*` vars + dark variant to `tokens.css`. Build `shell/theme.tsx` proxy. | `tokens.css`, `shell/theme.tsx` | `npm run typecheck`; ThemeProvider toggle still flips colors. |
| **2. Sidebar primitives** | Port `sidebar-item`, `sidebar-section`, `sidebar-subheader`, `workspace-pill`, `collapse-toggle`, `recent-items`, `bottom-row`. Add `SidebarCollapsedProvider`. | `shell/sidebar/*` | Story-tested in isolation; localStorage persistence works. |
| **3. Topbar + provider** | Port `topbar`, `breadcrumb` (route-derived), `search-trigger` (delegates to SmartSearch overlay), `avatar-menu`, `TopbarTrailingProvider`. | `shell/topbar/*` | GamePicker mounts in trailing slot; SmartSearch Cmd+K still works. |
| **4. App shell swap** | Rewrite `App.tsx` outer layout. Delete `components/Header/`. Add `/` → `/build` redirect. Add `/chat` placeholder route. | `App.tsx`, `index.tsx`, `pages/ChatPlaceholder/*` | Manual: every existing route still renders inside the new shell. |
| **5. Sidebar sections** | Wire 5 sections (Chat / Playground / Data Model / Metrics Catalog / Segments) + Advanced. Build `sidebar-data-model-section` mirroring `SidebarFeatureStoreSection`. | `shell/sidebar/sidebar.tsx`, `sidebar-data-model-section.tsx` | Click each tab → loads correct page; active highlight + auto-expand work. |
| **6. Segments Library restyle** | Rewrite `library-view.tsx` to Hermes goal-grouped row pattern. Left rail filter (GROUP BY / GOAL / STATUS / HAS CAMPAIGNS). Preserve URL-state + multi-select + bulk-actions. | `pages/Segments/library/*` | Existing vitest specs pass; URL state survives refresh. |
| **7. Segments Detail restyle** | Restyle header, KPI strip, tab strip with Hermes tokens. Tab bodies unchanged. | `pages/Segments/detail/*` | All 5 tabs still load; Activation push-to-CDP modal unchanged. |
| **8. Visual parity validation** | Run `/huashu-design` → Hermes-target prototype. Side-by-side screenshot diff in Playwright @ 1440×900. | `tests/visual/*.spec.ts` | < 2% pixel diff for sidebar + topbar + segments library. |
| **9. Full E2E** | Playwright on every route: /, /build, /catalog/*, /segments, /segments/:id, /chat, /data-model/new. Assert no console errors, all CTAs reachable, dark-mode toggle still works. | `tests/e2e/*.spec.ts` | Green CI. |

---

## 6. Risks & Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| AntD-styled modals/dropdowns clash visually with Hermes neutrals | Med | Token bridge keeps cube's `--brand`/`--bg-card` — AntD untouched. Only shell chrome shifts. |
| Hermes Sidebar uses RR6 (`NavLink`, `useNavigate`); cube on RR5 | High | Rewrite touched lines to RR5 (`NavLink` from rr5 has same API; swap `useNavigate` → `useHistory().push`). Verified ~6 call sites. |
| Hermes inline-style components depend on `T` tokens that don't exist in cube CSS vars | High | Phase 1 token bridge adds all required `--hermes-*` vars before sidebar files land. |
| Segments library rewrite loses URL-state / multi-select behavior | Med | Preserve `useLibraryUrlState` + `BulkActionsToolbar` hooks; only restyle row + filter rail components. |
| `huashu-design` html prototype can't fully validate AntD-rendered inner pages | Low | Validation scope = shell + Segments library only. Inner AntD pages validated by Playwright + manual diff. |
| Dark-mode regression on AntD widgets | Low | `antd-overrides.css` untouched; dark mode toggle flips both var sets simultaneously. |
| Game switching state loss when GamePicker moves to trailing slot | Low | `GameContextProvider` mounted above all UI; relocation is pure render-tree move. |
| Hermes `T.shell` background visible behind rounded main card may clash with cube's `--bg-app` | Low | Cube `--bg-app` matches Hermes `T.shell` (#f3f1ec) closely; minor manual tune in Phase 1. |

---

## 7. Success Criteria

1. **IA parity**: sidebar 260px (60px collapsed), Hermes-shaped sections, hover tooltip, active-bar, persisted collapse.
2. **Functional preservation**: every test in `cube-playground/src/**/__tests__` still passes; manual smoke on Playground query execution, Catalog tabs, Segment Push-to-CDP, GamePicker switching, dark mode toggle, SmartSearch Cmd+K, API Settings modal.
3. **Visual parity for shell + segments library**: Playwright pixel diff < 2% vs Hermes screenshots at 1440×900 light + dark.
4. **`/` redirects to /build** (no IndexPage rendered).
5. **`/chat` renders empty-state placeholder** with link back to /build.
6. **Data Model section** in sidebar shows `+ New data model` CTA → `/data-model/new?v=2`; preserves recently-viewed sub-rows from existing catalog state.

---

## 8. Next Steps

1. Confirm this report.
2. Run `/ck:plan` against this report → creates `plans/260523-1054-hermes-shell-mirror/plan.md` with 9 phase files.
3. Phase-by-phase execution via `/ck:cook`.

---

## Resolved decisions (2026-05-23)

- **Bottom-row content**: API Settings trigger + Theme toggle. Bottom-row stays useful at sidebar floor; mirrors Hermes density.
- **Sidebar i18n**: Add new keys to `src/i18n/locales/{en,vi}.json` — `nav.chat`, `nav.dataModel`, `nav.metricsCatalog`, `nav.advanced`, `nav.dataModelNew`. Existing `nav.playground` / `nav.segments` reused. `nav.catalog` deprecated (not removed yet — left for compat until callers gone).
- **`design-reference/` directory**: Vendor the whole `hermes/design-reference/` tree into `cube-playground/design-reference/` for future-port traceability. Not imported at runtime; build excludes via vite `assetsInclude` / tsconfig.
- **Workspace pill brand**: `GDS` glyph + "Cube Playground" title + "Self-serve data exploration" subtitle. Replaces existing `BrandBlock`.

## Open questions

None remaining.
