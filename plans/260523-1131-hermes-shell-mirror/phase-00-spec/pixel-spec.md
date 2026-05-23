# Pixel Spec — magic numbers reference

Every dimension copied verbatim from `hermes/apps/web/src/components/sidebar/*` + `topbar/*` + `App.tsx`. Use this table during implementation — no need to re-grep Hermes source.

---

## Outer shell (`App.tsx`)

| Property | Value |
|---|---|
| Container `height` | `100vh` |
| Container `overflow` | `hidden` |
| Container `background` | `T.shell` (`--hermes-shell`) |
| Container `display` | `flex` |
| Container `flexDirection` | `row` |
| Container `alignItems` | `stretch` |
| Container `padding` | `10` (px, all sides) |
| Container `gap` | `8` (px, between sidebar/main/rail) |
| Container `boxSizing` | `border-box` |
| `<main>` `flex` | `1` |
| `<main>` `minWidth` / `minHeight` | `0` |
| `<main>` `background` | `T.surface` |
| `<main>` `borderRadius` | `18` |
| `<main>` `overflow` | `hidden` |
| `<main>` inner scroll | `flex: 1; overflow: auto` |

---

## Sidebar (`sidebar.tsx`)

| Property | Value |
|---|---|
| Width — expanded | `260` |
| Width — collapsed | `60` |
| `flexShrink` | `0` |
| `height` | `100%` |
| `background` | `T.sidebar` (`--hermes-sidebar`) |
| `borderRadius` | `18` |
| `display` / `flexDirection` | `flex` / `column` |
| `fontFamily` | `T.fSans` |
| `overflow` | `visible` (allows seam button to pop out) |
| `position` | `relative` |
| Width transition | `width 0.16s ease` |
| `<nav>` `flex` | `1` |
| `<nav>` `overflowY/X` | `auto` / `hidden` |
| `<nav>` `padding` | `4px 0 12px` |

---

## WorkspacePill (`workspace-pill.tsx`)

| Property | Value (expanded) | Value (collapsed) |
|---|---|---|
| Height | `56` | `56` |
| Width | `100%` | `100%` |
| Padding | `0 12px` | `0` |
| `borderRadius` | `18px 18px 0 0` | `0` |
| Background | `transparent` (hover: `rgba(0,0,0,0.04)`) | `transparent` |
| Glyph box | `24×24`, `borderRadius: 5`, `background: T.brand` | same |
| Glyph text | `T.fDisp`, `11px`, weight `400`, color `#fff`, `uppercase`, `letterSpacing: 0.02em` | same |
| Title text | `T.fSans`, `13px`, weight `600`, color `T.n900` (cube "Cube Playground") | hidden |
| Subtitle text | `T.fSans`, `10px`, weight `500`, color `T.n500` (cube "Self-serve data exploration") | hidden |
| Gap | `8` | n/a |

---

## SidebarItem — top-level row (`sidebar-item.tsx`)

| Property | Value |
|---|---|
| Padding | `7px 12px` |
| `display` / `gap` | `flex` / `8` |
| `position` | `relative` |
| `cursor` | `pointer` |
| `userSelect` | `none` |
| `background` (idle) | `transparent` |
| `background` (hover) | `rgba(0,0,0,0.04)` |
| `background` (indent + active) | `rgba(0,0,0,0.05)` |
| `transition` | `background .12s` |
| Active left bar | `position: absolute, left: 0, top: 4, bottom: 4, width: 3, background: T.brand, borderRadius: '0 2px 2px 0'` |
| Icon size (top-level) | `16` |
| Icon size (indent) | `12` |
| Icon `strokeWidth` | `1.75` (lucide default via `<Icon>`) |
| Icon color (idle) | `T.n600` |
| Icon color (active) | `T.n950` |
| Label `fontSize` | `13` (top-level) / `12` (indent muted) |
| Label `fontWeight` (idle) | `500` |
| Label `fontWeight` (active or primary) | `600` |
| Label color (idle) | `T.n800` |
| Label color (active) | `T.n950` |
| Label color (muted) | `T.n500` |
| Label overflow | `hidden`, `ellipsis`, `nowrap` |
| Caret (`expandable`) | `ChevronDown` / `ChevronRight`, size `12`, color `T.n400` |

---

## SidebarItem — indent sub-row

| Property | Value |
|---|---|
| Padding | `5px 12px 5px 28px` |
| Active background | `rgba(0,0,0,0.05)` (no left-bar) |
| Icon size | `12` |
| Label `fontSize` | `12` if `muted`, `13` otherwise |

---

## SidebarItem — collapsed (60px) row

| Property | Value |
|---|---|
| Height | `32` |
| Width | `100%` |
| `display` | `flex center center` |
| Background (idle) | `transparent` |
| Background (hover, not active) | `rgba(0,0,0,0.04)` |
| Icon size | `18` |
| Active left bar | identical to expanded (3px brand) |
| Tooltip — position | `fixed`, `top: r.top + r.height/2`, `left: r.right + 8` |
| Tooltip — transform | `translateY(-50%)` |
| Tooltip — background | `T.n900` |
| Tooltip — color | `#fff` |
| Tooltip — padding | `4px 8px` |
| Tooltip — `borderRadius` | `4` |
| Tooltip — fontFamily | `T.fSans` |
| Tooltip — fontSize | `11` |
| Tooltip — fontWeight | `500` |
| Tooltip — `whiteSpace` | `nowrap` |
| Tooltip — `pointerEvents` | `none` |
| Tooltip — `zIndex` | `50` |

---

## SidebarSection — tree-line guide

| Property | Value |
|---|---|
| `position` | `absolute` |
| `left` | `23` |
| `top`/`bottom` | `4` |
| `width` | `1` |
| `background` | `rgba(0,0,0,0.08)` |
| `pointerEvents` | `none` |

---

## SidebarSubheader

| Property | Value |
|---|---|
| `fontFamily` | `T.fMono` |
| `fontSize` | `9.5` |
| `fontWeight` | `600` |
| `color` | `T.n400` |
| `textTransform` | `uppercase` |
| `letterSpacing` | `0.08em` |
| `padding` | `8px 16px 4px 32px` |
| Overflow | `nowrap`, `ellipsis`, `hidden` |

---

## BottomRow

| Property | Value |
|---|---|
| Border-top | `1px solid rgba(0,0,0,0.06)` |
| Padding | `6px 0 8px` |
| Custom user row padding | `8px 12px` |
| User-row gap | `8` |
| User avatar | `22×22`, `borderRadius: 9999`, bg `T.brand`, color `#fff` |
| User avatar text | `T.fSans`, `11px`, weight `700` |
| User name | `T.fSans`, `13px`, weight `500` (`600` if active route), color `T.n800` |
| User role | `T.fSans`, `10px`, color `T.n500` |

**Adaptation for cube-playground:** Replace `Data` (→/data) + `Settings` (→/settings) + `Account` rows with:
- **API Settings** trigger (opens existing `SecurityContextProvider` modal — no route)
- **Theme toggle** (icon button — Sun ↔ Moon — wires to existing `ThemeContext`)

Both rendered using `SidebarItem` shape for visual parity (icon + label, hover bg, collapsed-mode tooltip).

---

## CollapseToggle (seam button)

| Property | Value |
|---|---|
| Button size | `28×28` |
| Strip width | `16` (`-STRIP_WIDTH/2` right offset) |
| Strip zIndex | `20` |
| Button `position` | `sticky` |
| Button `top` | `50vh` |
| Button `marginLeft` | `(STRIP_WIDTH - BUTTON_SIZE) / 2` = `-6` |
| Button `borderRadius` | `50%` |
| Button background | `T.surface` |
| Button border | `1px solid T.n200` |
| Button shadow | `0 1px 4px rgba(0,0,0,0.08)` |
| Button color | `T.n700` |
| Button opacity (hidden) | `0` |
| Button opacity (visible) | `1` |
| Transition | `opacity 0.15s ease, background 0.12s, color 0.12s` |
| Icon | `ChevronLeft` / `ChevronRight`, size `14` |

---

## Topbar (`topbar.tsx`)

| Property | Value |
|---|---|
| `position` | `sticky` |
| `top` | `0` |
| `zIndex` | `20` |
| `height` | `56` |
| `padding` | `0 24px` |
| `display` / `alignItems` / `gap` | `flex` / `center` / `16` |
| `background` | `T.topbar` (`--hermes-topbar`, translucent) |
| `backdropFilter` | `blur(8px)` |
| `WebkitBackdropFilter` | `blur(8px)` |
| Border bottom | `1px solid T.n200` |
| Font | `T.fSans` |

### Breadcrumb

- gap `6`, fontSize `13`, fontFamily `T.fSans`, flex `1`
- Chevron separator: `ChevronRight`, size `12`, color `T.n400`
- Non-last link: color `T.n600`, hover `T.n900`, fontWeight `500`, maxWidth `240`, ellipsis
- Last crumb: color `T.n950`, fontWeight `600`, maxWidth `320`, ellipsis

### SearchTrigger

| Property | Value |
|---|---|
| Flex | `0 1 420px` |
| Height | `36` |
| Padding | `0 12px` |
| Gap | `8` |
| Background | `T.surface` |
| Border | `1px solid T.n200` (hover `T.n300`) |
| `borderRadius` | `8` |
| Icon | `Search`, size `14`, color `T.n500` |
| Placeholder text | `T.n500`, `13px`, "Search" |
| Kbd hint | `T.fMono`, `10px`, color `T.n500`, bg `T.n100`, padding `2px 6px`, `borderRadius: 4` |

### AvatarMenu — adapt to cube-playground

Reuse cube's existing user-menu component. Wrap in a `T`-styled trigger button (`32×32` circle, `T.brand` background, `#fff` initials).

### Trailing slot

`TopbarTrailingContext` exposes `{ node, setNode }`. Pages call `useTopbarTrailing()` to register an action node. Mount **GamePicker** here so it sits left of SearchTrigger. Also mount cube's RightCluster bits (theme/lang/help/notif) if not relocated into BottomRow/AvatarMenu.

---

## Active-state matchers (route prefix logic)

From `sidebar-item.tsx`:

```ts
const prefix = matchPrefix ?? to;
const isActive = !!prefix && (
  prefix === '/'
    ? location.pathname === '/'
    : location.pathname === prefix || location.pathname.startsWith(prefix + '/')
);
```

Use exact same logic in cube — uses cube's `useLocation` from `react-router-dom@5`, API identical.

---

## Sidebar IA (final, cube-specific)

```
Workspace pill                  [GDS]  Cube Playground / Self-serve data exploration
─────────────────────────────────────────────────────────────────────────────────
SidebarSection  id: chats           icon: MessageSquare   to: /chat
SidebarSection  id: playground      icon: LayoutDashboard to: /build      flat
SidebarSection  id: data-model      icon: Grid            to: /catalog/data-model
   ├─ + New data model       to: /data-model/new?v=2   primary
   ├─ subheader: RECENTLY VIEWED
   └─ recent items (cube/view names)

SidebarSection  id: metrics-catalog icon: BookOpen        to: /catalog/metrics
   └─ recent items (metric names)

SidebarSection  id: segments        icon: Users           to: /segments
   └─ recent items (segment names)

SidebarSection  id: advanced        icon: MoreHorizontal  (expand-only, hideLabelWhenExpanded)
   ├─ Digest            → /catalog/digest
   ├─ Notifications     → /catalog/notifications
   ├─ Saved views       → /catalog/saved-views
   ├─ Workspaces        → /catalog/workspaces
   └─ Identity Map      → /segments/identity-map
─────────────────────────────────────────────────────────────────────────────────
BottomRow:  API Settings | Theme toggle
CollapseToggle (seam button, hover-revealed)
```

---

## Z-index map

| Layer | z-index |
|---|---|
| Topbar | `20` |
| CollapseToggle strip | `20` |
| Tooltip (collapsed sidebar) | `50` |
| CmdK modal (SmartSearch) | `100+` (cube's existing) |

No conflicts with existing AntD Modal/Dropdown z-indices (AntD uses 1000+).

---

## Color cheats — when to use which token

| Use case | Token | Hex (light) |
|---|---|---|
| Sidebar background | `T.sidebar` | `#f9f6f2` |
| Topbar background | `T.topbar` | `rgba(249,246,242,0.92)` |
| Main panel background | `T.surface` | `#ffffff` |
| Outer shell gap | `T.shell` | `#efe9e0` |
| Hairline borders | `T.n200` | `#e5e5e5` |
| Subtle borders | `rgba(0,0,0,0.06)` | (literal) |
| Hover bg | `rgba(0,0,0,0.04)` | (literal) |
| Active indent bg | `rgba(0,0,0,0.05)` | (literal) |
| Tree-line guide | `rgba(0,0,0,0.08)` | (literal) |
| Primary text | `T.n800` → `T.n950` active | `#262626` → `#0a0a0a` |
| Secondary text | `T.n500` / `T.n600` | `#737373` / `#525252` |
| Brand accent | `T.brand` | `#f05a22` |
