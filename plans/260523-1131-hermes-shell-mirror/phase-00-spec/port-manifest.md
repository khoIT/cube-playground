# Port Manifest — file-by-file

Per file: source → destination → required modifications. Implementer follows this list top-to-bottom; each row = one mechanical translation.

---

## Legend

- **🟢** Verbatim copy
- **🟡** Copy + minor edit (RR5 swap, i18n swap, data swap)
- **🔴** Rewrite (cube-specific shape)
- **⚪** Skip (not needed)

---

## RR6 → RR5 API delta

| RR6 (Hermes) | RR5 (cube-playground) | Notes |
|---|---|---|
| `useNavigate()` → `navigate('/x')` | `useHistory()` → `history.push('/x')` | Replace import + call sites. |
| `NavLink` from `react-router-dom` | `NavLink` from `react-router-dom` v5 | API compatible: `to`, `style`, `onClick`, `children` work the same. ✅ no change. |
| `useLocation()` | `useLocation()` | Identical. ✅ no change. |
| `useParams<{id:string}>()` | `useParams<{id:string}>()` | Identical. ✅ no change. |
| `<Routes><Route path element/>` | `<Switch><Route path component/>` | Used in `routes.tsx` only — cube's `index.tsx` already uses RR5 pattern. |

**Verified call sites needing edit:**

```
sidebar/bottom-row.tsx        : line 7  useNavigate  → useHistory
sidebar/bottom-row.tsx        : line 17 const navigate = useNavigate()  →  const history = useHistory()
sidebar/bottom-row.tsx        : line 35 onClick={() => navigate('/account')}  →  history.push('/...')
sidebar/workspace-pill.tsx    : line 7  useNavigate  → useHistory
sidebar/workspace-pill.tsx    : line 16 navigate('/welcome')  → history.push('/build')
sidebar/chat-context-menu.tsx : line 11 useNavigate  → useHistory
topbar/avatar-menu.tsx        : line 6  useNavigate  → useHistory
```

---

## File-by-file

### Shell — theme

| Status | Source | Destination | Modifications |
|---|---|---|---|
| 🟡 | `apps/web/src/theme.tsx` | `src/shell/theme.tsx` | Copy only `T` constants + `Icon` + `cx` (lines 16-101). **Drop** Button/Badge/Card/Input/Select/Switch/Tabs/Avatar/Kpi/SectionHeader/Sparkline — shell doesn't consume them. Saves ~400 lines. |
| 🟡 | `apps/web/src/theme-tokens.css` | append to `src/theme/tokens.css` | See `token-inventory.md`. Selector change: `html.dark` → `html[data-theme="dark"]`. Skip safety-net rules (lines 129-150). |

### Shell — sidebar

| Status | Source | Destination | Modifications |
|---|---|---|---|
| 🟢 | `apps/web/src/components/sidebar/sidebar-item.tsx` | `src/shell/sidebar/sidebar-item.tsx` | Verbatim. `NavLink` from RR5 has compatible API. |
| 🟢 | `apps/web/src/components/sidebar/sidebar-section.tsx` | `src/shell/sidebar/sidebar-section.tsx` | Verbatim. Move `getSectionExpanded` / `setSectionExpanded` to a new local util (see below). |
| 🟢 | `apps/web/src/components/sidebar/sidebar-subheader.tsx` | `src/shell/sidebar/sidebar-subheader.tsx` | Verbatim. |
| 🟡 | `apps/web/src/components/sidebar/workspace-pill.tsx` | `src/shell/sidebar/workspace-pill.tsx` | Replace `useNavigate` → `useHistory`. Replace `navigate('/welcome')` → `history.push('/build')`. Replace `VG` glyph with `GDS`; replace title "Hermes" with "Cube Playground", subtitle with "Self-serve data exploration". |
| 🟡 | `apps/web/src/components/sidebar/bottom-row.tsx` | `src/shell/sidebar/bottom-row.tsx` | **Rewrite contents**: ditch `Data`/`Settings`/`Account` rows. Render 2 rows: (1) `Settings2` icon + "API Settings" → opens `SecurityContextProvider` modal via context (need a `useSecurityContext()` hook with an `openModal()` API — verify cube has one, else add). (2) `Moon`/`Sun` icon + "Dark mode" → calls cube `useTheme()` toggle. Both use `SidebarItem` shape; in collapsed mode show icon-only with tooltip. Drop the user-row entirely (Khoi/CFM PM artifact). Replace `useT` → `useTranslation`. |
| 🟢 | `apps/web/src/components/sidebar/collapse-toggle.tsx` | `src/shell/sidebar/collapse-toggle.tsx` | Verbatim. Imports from local `sidebar-collapsed-store`. |
| 🟡 | `apps/web/src/components/sidebar/recent-items.tsx` | `src/shell/sidebar/recent-items.tsx` | Replace `useI18n` import with `useTranslation`. Drop localizers (`localizedSegmentNameById`/etc — Hermes-specific); pass titles through verbatim. Recent items source = new util (see below). Drop `ChatContextMenu` import & usage (chat is placeholder, no per-thread context actions). |
| 🔴 | (new) | `src/shell/sidebar/sidebar-data-model-section.tsx` | Mimics `sidebar-feature-store-section.tsx` shape: section header (Grid icon, "Data Model", to=`/catalog/data-model`) + `+ New data model` CTA (`/data-model/new?v=2`) + RECENTLY VIEWED subheader + recent cube/view items. Data source: cube meta (`useCubeMeta` or similar) — read names from cube's existing catalog state. |
| 🔴 | `apps/web/src/components/sidebar/sidebar.tsx` | `src/shell/sidebar/sidebar.tsx` | Rewrite for cube IA: Chat (placeholder) / Playground (flat) / Data Model (custom section) / Metrics Catalog / Segments / Advanced (5 sub-items). Drop `SidebarFeatureStoreSection` import. Replace `useT` → `useTranslation`. Path-to-section map: `/chat→chats`, `/build→playground`, `/catalog/data-model→data-model` + `/data-model/new→data-model`, `/catalog/metrics→metrics-catalog`, `/segments→segments`, `/catalog/{digest,notifications,saved-views,workspaces}→advanced`. |
| ⚪ | `apps/web/src/components/sidebar/sidebar-feature-store-section.tsx` | (don't port) | Use as **structural reference only** for the new `sidebar-data-model-section.tsx`. Doesn't depend on `@hermes/contracts` after substitution. |
| ⚪ | `apps/web/src/components/sidebar/chat-context-menu.tsx` | (don't port) | Chat is placeholder; no per-thread actions needed. |

### Shell — sidebar utils

| Status | Source | Destination | Modifications |
|---|---|---|---|
| 🟡 | `apps/web/src/utils/sidebar-collapsed-store.ts` | `src/shell/sidebar/sidebar-collapsed-store.ts` | Verbatim. Change key prefix `hermes:sidebar:collapsed` → `gds-cube:sidebar:collapsed`. Change event name to `gds-cube:sidebar:collapsed-changed`. |
| 🔴 | (new) | `src/shell/sidebar/sidebar-section-store.ts` | Extract `getSectionExpanded` / `setSectionExpanded` / `getSidebarSectionForPath`. Key prefix `gds-cube:sidebar:section:{id}`. Map of path-prefix → section-id (see sidebar IA mapping above). |
| 🔴 | (new) | `src/shell/sidebar/recent-items-store.ts` | Local LRU-8 store (verbatim from `hermes/utils/recent-items-store.ts`). Modules: `chat` `playground` `data-model` `metrics-catalog` `segments`. Key prefix `gds-cube.recent.v1.{module}`. |

### Shell — topbar

| Status | Source | Destination | Modifications |
|---|---|---|---|
| 🟢 | `apps/web/src/components/topbar/topbar.tsx` | `src/shell/topbar/topbar.tsx` | Verbatim. Imports `breadcrumb`, `search-trigger`, `avatar-menu`, `TopbarTrailingContext` from local. |
| 🔴 | `apps/web/src/components/topbar/breadcrumb.tsx` | `src/shell/topbar/breadcrumb.tsx` | Rewrite resolver: cube has no `allFeatures`/`allSegments`/`allCampaigns`. Use simple path → label map: `/build → Playground`, `/catalog/data-model → Data Model`, `/catalog/data-model/:cube → {cubeName}`, `/catalog/metrics → Metrics Catalog`, `/segments → Segments`, `/segments/:id → {segmentName from segmentsClient cache}`, `/chat → Chat`. Drop hermes data imports entirely. |
| 🟢 | `apps/web/src/components/topbar/search-trigger.tsx` | `src/shell/topbar/search-trigger.tsx` | Verbatim. `onOpen` wires to cube's existing `SmartSearchProvider.openOverlay()` (verify API). |
| 🟡 | `apps/web/src/components/topbar/avatar-menu.tsx` | `src/shell/topbar/avatar-menu.tsx` | Replace internals with cube's existing `user-menu` component as a popover trigger. Keep the 32×32 `T.brand` button shell from Hermes for visual parity. |
| 🟢 | `apps/web/src/utils/topbar-trailing-context.tsx` | `src/shell/topbar/topbar-trailing-context.tsx` | Verbatim. Provider mounted in App.tsx; consumed by pages via `useTopbarTrailing()`. |

### Shell — chrome glue

| Status | Source | Destination | Modifications |
|---|---|---|---|
| 🔴 | `apps/web/src/App.tsx` | `src/App.tsx` (rewrite) | Replace existing `<StyledLayoutContent>` + `<Header>` with Hermes shell: outer flex 10px padding + 8px gap, T.shell background, `<Sidebar/>` + `<main rounded>` (Topbar + scrollable content). Keep `SmartSearchProvider`, `CubeTokenBootstrap`, GlobalStyles. **Drop** `<Header>` import + render — Header.tsx + its sub-components get deleted. Wrap App with `TopbarTrailingProvider`. |
| 🟡 | `src/index.tsx` | `src/index.tsx` | Change `/ → IndexPage` to `<Redirect to="/build" />`. Add `<Route path="/chat" component={ChatPlaceholderPage} />`. Add `<Redirect from="/catalog" to="/catalog/data-model" exact />` (so old catalog landing routes to Data Model tab). |
| 🔴 | (new) | `src/pages/ChatPlaceholder/chat-placeholder-page.tsx` | Empty-state: centered card, MessageSquare icon (size 48, T.n400), "Chat coming soon" (T.fDisp 32px), "Conversational analytics will appear here." subtitle (T.n500), CTA button → /build. |

### Segments library — Hermes-style rewrite

| Status | Source | Destination | Modifications |
|---|---|---|---|
| 🔴 | `apps/web/src/modules/segments/library.tsx` (Hermes) | `src/pages/Segments/library/library-view.tsx` (cube) | Rewrite cube's library to Hermes goal-grouped row pattern. Preserve cube-specific hooks: `useLibraryUrlState`, `BulkActionsToolbar`, `ImportIdsModal`, `useRefreshLogs`. Render rows via new `library-segment-row.tsx` (Hermes style). Filter rail via new `library-filter-rail.tsx`. |
| 🔴 | (new) | `src/pages/Segments/library/library-filter-rail.tsx` | Left sidebar inside library view: GROUP BY (goal/owner/type/none) / 4R GOAL / STATUS / HAS OPEN CAMPAIGNS. Adapt cube segment shape (no `goal` field — use `tag` array or skip). |

### Segments detail — restyle, function-preserved

| Status | Source | Destination | Modifications |
|---|---|---|---|
| 🟡 | `src/pages/Segments/detail/detail-view.tsx` | (in-place edit) | Restyle: header uses T tokens, KPI strip uses Hermes `Kpi` look (mono numbers, uppercase labels). Tab strip switches to Hermes `Tabs` primitive style. **Keep** all 5 tab bodies functional (Monitor / Insights / Members / Definition / Activation). |
| 🟡 | `src/pages/Segments/detail/cards/kpi-card.tsx` | (in-place edit) | Adopt Hermes Kpi shape: `T.fDisp` 36px number, uppercase label, sparkline. |
| 🟢 | `src/pages/Segments/detail/tabs/*.tsx` | (no change) | All 5 tabs unchanged. AntD inner widgets keep their behavior. |

### Vendor design-reference

| Status | Source | Destination | Modifications |
|---|---|---|---|
| 🟢 | `hermes/design-reference/` | `cube-playground/design-reference/` | Copy whole tree. Add `"design-reference"` to `.gitignore` (or commit if you want traceability). Add `design-reference/**` to `tsconfig.json` `exclude` AND `vite.config.ts` `build.rollupOptions.external` so it never lands in the bundle. |

### Header deletion

| Status | Source | Destination | Modifications |
|---|---|---|---|
| ⚪ | `src/components/Header/*` | DELETE | All files except `game-picker.tsx`, `use-game-context.ts`, and the sub-components actually reused. Move `game-picker.tsx` to `src/shell/topbar/game-picker.tsx` (file-move only — content unchanged). Move sub-components used inside game picker if any. Re-mount via `useTopbarTrailing` in App.tsx. |

---

## Imports requiring cube substitutions

| Hermes import | cube substitute |
|---|---|
| `useT` from `'../../i18n/i18n-provider'` | `useTranslation` from `'react-i18next'` |
| `useI18n` from `'../../i18n/i18n-provider'` | not needed (drop) |
| `allSegments` from `'../../data/catalog/segments'` | `segmentsClient.list()` cached at module scope OR fetched via `useEffect` |
| `allFeatures`, `allCampaigns` | n/a (cube has no features/campaigns) |
| `HermesFeature` from `'@hermes/contracts'` | n/a (Data Model section uses cube meta shape) |
| `getSidebarSectionForPath` from `'../../utils/recent-items-store'` | new local impl with cube routes (see `sidebar-section-store.ts` row) |
| `useTopbarTrailing` from `'../../utils/topbar-trailing-context'` | local (verbatim port) |

---

## Risk-mitigation checks before Phase 1 starts

- [ ] Confirm `react-router-dom@5` `NavLink` accepts `to`, `style`, `onClick`, `children` props (verified in cube `nav-pill.tsx` line 13 — yes).
- [ ] Confirm cube `ThemeContext` exposes a `toggle()` API (or document the workaround).
- [ ] Confirm cube `SecurityContextProvider` exposes an `openModal()` API for the API Settings BottomRow row (or note: render a button that dispatches an event the modal listens to).
- [ ] Confirm cube `SmartSearchProvider` exposes `openOverlay()` for the SearchTrigger button.
- [ ] Confirm cube `i18n` has `nav.chat`, `nav.dataModel`, `nav.metricsCatalog`, `nav.advanced`, `nav.dataModelNew` keys (or add in Phase 1).

---

## Order of operations

1. **Tokens** (1 PR): patch `tokens.css`, add `src/shell/theme.tsx`.
2. **Stores & utils** (1 PR): `sidebar-collapsed-store`, `sidebar-section-store`, `recent-items-store`, `topbar-trailing-context`.
3. **Sidebar primitives** (1 PR): `sidebar-item`, `sidebar-section`, `sidebar-subheader`, `workspace-pill`, `recent-items`, `collapse-toggle`, `bottom-row`.
4. **Topbar primitives** (1 PR): `breadcrumb` (cube-shaped resolver), `search-trigger`, `avatar-menu`, `topbar.tsx`.
5. **Custom sections** (1 PR): `sidebar-data-model-section`, `sidebar.tsx`.
6. **App shell + routes** (1 PR): rewrite `App.tsx`, edit `index.tsx`, add `chat-placeholder-page.tsx`, delete `Header/*`, move `game-picker` to topbar.
7. **Segments library rewrite** (1 PR): `library-view`, `library-segment-row`, `library-filter-rail`.
8. **Segments detail restyle** (1 PR): in-place edits to detail-view + kpi-card.
9. **Visual + E2E validation** (1 PR): Playwright pixel-diff + smoke specs.

Each step is independently mergeable; cube keeps shipping while we cut over.
