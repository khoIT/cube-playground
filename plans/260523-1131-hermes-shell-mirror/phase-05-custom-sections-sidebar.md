---
phase: 5
title: "Custom Sections & Sidebar"
status: pending
priority: P1
effort: "60 min"
dependencies: [3]
---

# Phase 5: Custom Sections & Sidebar

## Context Links

- Spec: [`phase-00-spec/pixel-spec.md`](./phase-00-spec/pixel-spec.md) § "Sidebar IA (final, cube-specific)"
- Spec: [`phase-00-spec/port-manifest.md`](./phase-00-spec/port-manifest.md) § "Shell — sidebar" (`sidebar-data-model-section`, `sidebar.tsx` rows)
- Hermes reference: `apps/web/src/components/sidebar/sidebar-feature-store-section.tsx`

## Overview

Assemble the IA: build cube-specific `sidebar-data-model-section.tsx` (mirrors Hermes Feature Store shape), then assemble `sidebar.tsx` with 6 sections (Chat / Playground / Data Model / Metrics Catalog / Segments / Advanced). Add 5 i18n keys.

## Key Insights

- Data Model section mirrors Hermes Feature Store structurally: header → `+ New data model` CTA → RECENTLY VIEWED subheader → recent items.
- Cube has no "pinned" or "new this month" concepts for cubes/views; **only render Recently Viewed** initially.
- Recent cubes/views populated when user visits `/catalog/data-model/{cubeName}` (push to recent-items-store via Phase 8 catalog page or via Phase 6 route-listener hook).
- Sidebar auto-expand-on-route uses `getSidebarSectionForPath` from Phase 2.
- 5 new i18n keys land in `src/i18n/locales/{en,vi}.json`.

## Requirements

### Functional
- Sidebar renders 6 sections in correct order: Chat / Playground / Data Model / Metrics Catalog / Segments / Advanced.
- Each section's expand state persists across reloads via `sidebar-section-store`.
- Visiting `/segments/identity-map` auto-expands **Advanced** (longest-prefix match).
- Data Model section's `+ New data model` row links to `/data-model/new?v=2`.
- `Playground` row is flat (no expand caret).
- `Chat` section shows "No recent items" placeholder (chats are placeholder feature).
- Sidebar respects `getCollapsed()` from store; transitions 260↔60.

### Non-functional
- `sidebar.tsx` ≤ 200 lines.
- `sidebar-data-model-section.tsx` ≤ 100 lines.
- No AntD; only `T`, lucide icons, RR5 NavLink, local stores.

## Architecture

```
src/shell/sidebar/
  sidebar.tsx                          ← assembles all sections
  sidebar-data-model-section.tsx       ← cube-specific (mirrors FS shape)

src/i18n/locales/
  en.json    ← + 5 keys
  vi.json    ← + 5 keys
```

### Section render order in `sidebar.tsx`

```tsx
<SidebarSection id="chats" icon={MessageSquare} label={t('nav.chat')} to="/chat">
  {/* Placeholder — empty state row */}
  <SidebarItem label="No recent items" indent muted to="/chat" />
</SidebarSection>

<SidebarSection id="playground" icon={LayoutDashboard} label={t('nav.playground')} to="/build" flat />

<SidebarDataModelSection collapsed={collapsed} />     {/* Custom */}

<SidebarSection id="metrics-catalog" icon={BookOpen} label={t('nav.metricsCatalog')} to="/catalog/metrics">
  <RecentItems module="metrics-catalog" seeAllTo="/catalog/metrics" />
</SidebarSection>

<SidebarSection id="segments" icon={Users} label={t('nav.segments')} to="/segments">
  <RecentItems module="segments" seeAllTo="/segments" />
</SidebarSection>

<SidebarSection id="advanced" icon={MoreHorizontal} label={t('nav.advanced')} collapsed={collapsed} hideLabelWhenExpanded>
  <SidebarItem icon={FileText}   label="Digest"        to="/catalog/digest"        indent />
  <SidebarItem icon={Bell}       label="Notifications" to="/catalog/notifications" indent />
  <SidebarItem icon={Bookmark}   label="Saved views"   to="/catalog/saved-views"   indent />
  <SidebarItem icon={Building2}  label="Workspaces"    to="/catalog/workspaces"    indent />
  <SidebarItem icon={Network}    label="Identity Map"  to="/segments/identity-map" indent />
</SidebarSection>
```

## Related Code Files

### Create
- `src/shell/sidebar/sidebar.tsx`
- `src/shell/sidebar/sidebar-data-model-section.tsx`

### Modify
- `src/i18n/locales/en.json` — add 5 keys
- `src/i18n/locales/vi.json` — add 5 keys

### Delete
- None

## Implementation Steps

1. **Add i18n keys** to `src/i18n/locales/en.json`:
   ```json
   "nav.chat": "Chat",
   "nav.dataModel": "Data Model",
   "nav.metricsCatalog": "Metrics Catalog",
   "nav.advanced": "Advanced",
   "nav.dataModelNew": "+ New data model"
   ```
   And to `vi.json`:
   ```json
   "nav.chat": "Trò chuyện",
   "nav.dataModel": "Mô hình dữ liệu",
   "nav.metricsCatalog": "Thư viện chỉ số",
   "nav.advanced": "Nâng cao",
   "nav.dataModelNew": "+ Mô hình mới"
   ```

2. **Create `sidebar-data-model-section.tsx`**:
   ```tsx
   import { Grid, Plus } from 'lucide-react';
   import { useTranslation } from 'react-i18next';
   import { SidebarSection } from './sidebar-section';
   import { SidebarItem } from './sidebar-item';
   import { SidebarSubheader } from './sidebar-subheader';
   import { getRecent } from './recent-items-store';
   // ...
   export function SidebarDataModelSection({ collapsed }: { collapsed?: boolean }) {
     const { t } = useTranslation();
     const [recent, setRecent] = useState(() => getRecent('data-model'));
     useEffect(() => {
       const handler = () => setRecent(getRecent('data-model'));
       window.addEventListener('gds-cube:recent-changed', handler);
       return () => window.removeEventListener('gds-cube:recent-changed', handler);
     }, []);
     return (
       <SidebarSection id="data-model" icon={Grid} label={t('nav.dataModel')} to="/catalog/data-model" collapsed={collapsed}>
         <SidebarItem icon={Plus} label={t('nav.dataModelNew')} to="/data-model/new?v=2" indent primary />
         {recent.length > 0 && (
           <>
             <SidebarSubheader>Recently viewed</SidebarSubheader>
             {recent.slice(0, 5).map(it => (
               <SidebarItem key={it.id} label={it.title} to={it.href ?? `/catalog/data-model/${it.id}`} indent />
             ))}
           </>
         )}
       </SidebarSection>
     );
   }
   ```

3. **Create `sidebar.tsx`** — port `hermes/apps/web/src/components/sidebar/sidebar.tsx` with these changes:
   - Replace `useT` → `useTranslation` (cube)
   - Replace path-to-section import: from local `./sidebar-section-store` (Phase 2)
   - Replace event names: `hermes:*` → `gds-cube:*`
   - Drop `SidebarFeatureStoreSection` import + render
   - Drop `Boards / Campaigns` sections (not in cube)
   - Drop `Playbooks / Funnels / Retentions / Knowledge` from Advanced; instead use cube's 5 advanced items (see Architecture above)
   - Drop `CANONICAL_SEGMENT_IDS` + `isCanonicalSegmentRecent` filter (cube uses simpler segment shape — let all recents through, Phase 7 controls what gets pushed)
   - Drop `allSegments` import + reference
   - `<WorkspacePill />` and `<BottomRow />` and `<CollapseToggle />` already in Phase 3
   - Render order per Architecture above

4. **`npm run typecheck`** must pass.

5. **Smoke**: temporarily mount `<Sidebar />` in App.tsx during dev → verify all 6 sections render, route-active highlighting works, collapse toggle works.

## Todo List

- [ ] Add 5 i18n keys to en.json
- [ ] Add 5 i18n keys to vi.json
- [ ] Create `sidebar-data-model-section.tsx`
- [ ] Create `sidebar.tsx` with cube IA
- [ ] `npm run typecheck` passes
- [ ] Smoke: sidebar renders correctly in dev

## Success Criteria

- [ ] Sidebar shows 6 sections in correct order.
- [ ] Active highlight follows current route (3px brand bar on top-level).
- [ ] Visiting `/segments/identity-map` auto-expands Advanced section.
- [ ] Visiting `/catalog/data-model/{cube}` auto-expands Data Model section.
- [ ] Click `+ New data model` → navigates to `/data-model/new?v=2`.
- [ ] Click Chat section header → navigates to `/chat`.
- [ ] Section expand state persists across reload.
- [ ] Recent items appear when present, hidden when empty (except Chat which shows placeholder).

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Recent items push not wired anywhere yet → empty sections always | Phase 6 adds a route-listener hook that pushes to recent-items on cube/view/segment visits |
| 5 sections + Advanced 5 sub-items overflow at 600px viewport height | Sidebar nav already has `overflowY: auto`; tested by Hermes at 768px |
| i18n key collisions with existing cube keys | Existing keys: `nav.playground`, `nav.segments`, `nav.catalog`, `nav.newDataModel`. New 5 are distinct. |
| Cube i18n missing `vi.json` file | Verify before Phase 5; if missing, only update en.json (cube falls back to keys) |

## Security Considerations

- None — pure UI assembly.

## Next Steps

Phase 6 mounts `<Sidebar/>` in the rewritten `App.tsx`, adds route-listener hook to push recents, deletes old `Header/` dir.
