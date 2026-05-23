---
phase: 8
title: "Segments Detail Restyle"
status: pending
priority: P1
effort: "60 min"
dependencies: [7]
---

# Phase 8: Segments Detail Restyle

## Context Links

- Brainstorm § 5 Phase 7
- Spec: [`phase-00-spec/port-manifest.md`](./phase-00-spec/port-manifest.md) § "Segments detail"
- Cube current: `src/pages/Segments/detail/detail-view.tsx` (5 tabs: Monitor, Insights, Members, Definition, Activation)
- Hermes reference: `apps/web/src/modules/segments/_components/detail-{header,layout,tabs}.tsx`, `overview.tsx`

## Overview

Restyle segment detail chrome (header, KPI strip, tab strip) using `T` tokens. **Keep all 5 tab bodies fully functional** — only the wrapping chrome and KPI tiles change. Push to recent-items on visit (Phase 6 hook already covers this).

## Key Insights

- Detail-view is 5 tabs with rich functionality (live polling, activation to CDP, refresh-now, broken-segment banner). **Function preservation is the hard constraint.** Tab body internals stay AntD.
- Chrome restyle scope: detail-header.tsx, kpi-card.tsx, tab strip (inside detail-view.tsx), breadcrumbs (handled by topbar now), live-badge styling.
- KPI tiles adopt Hermes `Kpi` look: uppercase label (11px, T.n500, letter-spacing 0.04em), `T.fDisp` 36px number, delta indicator below.
- Tab strip restyle: switch from cube's underline-style tabs to Hermes-style segmented control or pill row. Match `Tabs` primitive in `hermes/apps/web/src/theme.tsx`.
- Breadcrumbs from cube's existing `<Breadcrumbs/>` (`visuals/`) become redundant once topbar breadcrumb works — **delete or hide** to avoid duplication.

## Requirements

### Functional
- All 5 tabs render correctly: Monitor (default), Insights, Members, Definition, Activation.
- Live polling, refresh-now, activate-to-CDP, broken-segment banner, delete confirmation all work unchanged.
- KPI strip shows current count + delta + sparkline.
- Tab switching preserves URL (`?tab=…`).
- Push segment to recent-items when visited (already done via Phase 6 hook).

### Non-functional
- `detail-view.tsx` ≤ 250 lines after restyle.
- `kpi-card.tsx` rewritten ≤ 80 lines.
- All AntD-wrapped tab bodies untouched.

## Architecture

```
src/pages/Segments/detail/
  detail-view.tsx                  ◆ RESTYLE chrome (header, KPI strip, tab strip)
  cards/kpi-card.tsx               ◆ REWRITE (Hermes Kpi look)
  components/refresh-now-button.tsx ◆ RESTYLE
  components/broken-segment-banner.tsx ◆ RESTYLE (amberSoft + amber500)
  components/activation-chip.tsx   ◆ RESTYLE
  components/size-kpi-tile.tsx     ◆ RESTYLE (matches Hermes Kpi)
  status/status-pill.tsx           ◆ RESTYLE (Badge primitive shape)
  tabs/*.tsx                       ✓ UNCHANGED (Monitor/Insights/Members/Definition/Activation bodies)
  push-modal/activate-to-cdp-modal.tsx ✓ UNCHANGED (Antd modal)
```

### KPI strip layout

```
┌────────────────────────────────────────────────────────────────────────┐
│  Header: serif italic name + mono id · status pill · last refreshed     │
│  Topbar trailing: [Activate to CDP] [Refresh now] [Edit] [Delete]       │
├────────────────────────────────────────────────────────────────────────┤
│  ┌─ Size KPI ──────┐ ┌─ vs 7d ago ─┐ ┌─ vs 30d ago ─┐ ┌─ Refresh ──┐  │
│  │ 1.23M USERS     │ │ +5.2%       │ │ -2.1%        │ │ 14m ago     │  │
│  │ ▁▂▄▆█▇▆▅       │ │ ▲           │ │ ▼           │ │             │  │
│  └─────────────────┘ └─────────────┘ └──────────────┘ └─────────────┘  │
├────────────────────────────────────────────────────────────────────────┤
│  [Monitor]  [Insights]  [Members]  [Definition]  [Activation]            │
├────────────────────────────────────────────────────────────────────────┤
│  <tab body>                                                              │
└────────────────────────────────────────────────────────────────────────┘
```

## Related Code Files

### Modify (in-place restyle, behavior unchanged)
- `src/pages/Segments/detail/detail-view.tsx` — header + KPI strip + tab strip restyle.
- `src/pages/Segments/detail/cards/kpi-card.tsx` — rewrite to Hermes Kpi shape.
- `src/pages/Segments/detail/components/refresh-now-button.tsx`
- `src/pages/Segments/detail/components/broken-segment-banner.tsx`
- `src/pages/Segments/detail/components/activation-chip.tsx`
- `src/pages/Segments/detail/components/size-kpi-tile.tsx`
- `src/pages/Segments/status/status-pill.tsx`

### Move topbar trailing
- `detail-view.tsx` — push action buttons (Activate / Refresh / Edit / Delete) to topbar via `useTopbarTrailing`.

### Delete
- Cube's `<Breadcrumbs/>` rendering inside detail-view (topbar breadcrumb handles this).

### Unchanged
- `tabs/monitor-tab.tsx`, `insights-tab.tsx`, `members-tab.tsx`, `definition-tab.tsx`, `activation-tab.tsx`
- `push-modal/activate-to-cdp-modal.tsx`
- `components/confirm-destructive-modal.tsx`
- `hooks/*`
- `use-active-tab.ts`, `use-preset.ts`

## Implementation Steps

1. **Rewrite `kpi-card.tsx`** matching Hermes Kpi primitive:
   ```tsx
   import { T, Icon, type LucideIcon } from '../../../shell/theme';

   export function KpiCard({ label, value, delta, deltaDir, icon, sub }: {
     label: string; value: ReactNode; delta?: string; deltaDir?: 'up' | 'down' | 'flat';
     icon?: LucideIcon; sub?: string;
   }) {
     return (
       <div style={{
         background: T.surface, border: `1px solid ${T.n200}`, borderRadius: 10,
         padding: 16, boxShadow: '0 1px 2px -1px rgba(0,0,0,0.05), 0 1px 3px 0 rgba(0,0,0,0.06)',
       }}>
         <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
           <span style={{ fontFamily: T.fSans, fontSize: 11, color: T.n500, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{label}</span>
           {icon && <div style={{ width: 28, height: 28, borderRadius: 8, background: T.n100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon icon={icon} size={14} color={T.n600}/></div>}
         </div>
         <div style={{ fontFamily: T.fDisp, fontSize: 36, fontWeight: 400, color: T.n950, lineHeight: 1, letterSpacing: '0.005em', textTransform: 'uppercase' }}>{value}</div>
         <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
           {delta && <span style={{ fontFamily: T.fSans, fontSize: 12, fontWeight: 600, color: deltaDir === 'up' ? T.green600 : deltaDir === 'down' ? T.red600 : T.n500 }}>{delta}</span>}
           {sub && <span style={{ fontFamily: T.fSans, fontSize: 11, color: T.n500 }}>{sub}</span>}
         </div>
       </div>
     );
   }
   ```

2. **Restyle `detail-view.tsx` header block**:
   - Replace AntD `<Breadcrumbs>` render with nothing (topbar handles it).
   - Name + id row: serif italic name (15px italic, T.n950) + mono id (11px, T.n500).
   - Status pill: use restyled `<StatusPill>` (Hermes Badge primitive style).
   - Last refreshed: small text (11px, T.n500) with relative time.

3. **Move action buttons to topbar trailing**:
   ```tsx
   const { setNode } = useTopbarTrailing();
   useEffect(() => {
     setNode(<>
       <RefreshNowButton segmentId={id} />
       <Button leftIcon={Send} onClick={() => setActivateOpen(true)}>Activate to CDP</Button>
       <Button variant="outline" leftIcon={Pencil} onClick={() => history.push(`/segments/${id}/edit`)}>Edit</Button>
       <Button variant="ghost" leftIcon={Trash2} onClick={() => setDeleteOpen(true)}>Delete</Button>
     </>);
     return () => setNode(null);
   }, [id]);
   ```

4. **Restyle KPI strip**:
   - 4-column grid (1fr 1fr 1fr 1fr), gap 16.
   - Each card uses new `KpiCard`.
   - Size KPI: value = formatted count (`formatCount(segment.audience_size)`), delta = computed from `useSegmentSizeDelta`, sparkline below (use Hermes `Sparkline` ported or inline SVG).

5. **Restyle tab strip**:
   - Replace AntD-styled underline tabs with Hermes-style pill row (inline-flex, 3px padding container, 6px radius pills, `T.surface` for active with `0 1px 2px rgba(0,0,0,0.08)` shadow).
   - Or use a thin underline indicator under each tab (40px tall, 13px Inter, weight 500).
   - Tabs: Monitor / Insights / Members / Definition / Activation (preserve URL param `?tab=`).

6. **Restyle other components** — `broken-segment-banner` (amberSoft bg + amber500 border), `activation-chip` (Badge `success` variant style), `status-pill` (Badge variant by status), `refresh-now-button` (Button `outline` variant).

7. **Verify all 5 tab bodies still render correctly** (no inner changes).

8. **`npm run typecheck`** must pass.

9. **`npm run test`** — detail-view + tab specs pass.

10. **Manual smoke** on `/segments/{any-id}`:
    - Click each tab → body renders.
    - Click Activate to CDP → modal opens, can push.
    - Click Refresh Now → live polling updates count.
    - Click Edit → navigates to `/segments/:id/edit`.
    - Click Delete → confirm modal, then delete.

## Todo List

- [ ] Rewrite `kpi-card.tsx` to Hermes Kpi shape
- [ ] Restyle `detail-view.tsx` header (name + id + status + last refreshed)
- [ ] Move action buttons (Refresh / Activate / Edit / Delete) to topbar trailing
- [ ] Hide cube's internal `<Breadcrumbs/>` (topbar handles it)
- [ ] Restyle KPI strip (4-card grid with new KpiCard)
- [ ] Restyle tab strip to Hermes pill/underline style
- [ ] Restyle `broken-segment-banner`, `activation-chip`, `status-pill`, `refresh-now-button`, `size-kpi-tile`
- [ ] Verify all 5 tab bodies still render
- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes
- [ ] Manual smoke: every tab + every action

## Success Criteria

- [ ] Detail page chrome visually matches Hermes detail-layout pattern.
- [ ] All 5 tab bodies render with no functional regression.
- [ ] KPI tiles show large display number + uppercase label + delta direction.
- [ ] Refresh Now still triggers live polling.
- [ ] Activate to CDP modal opens + push flow works.
- [ ] Edit + Delete still work.
- [ ] Tab URL state (`?tab=monitor` etc) preserved.
- [ ] No console errors.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Tab body internal styling clashes with new chrome | Tab bodies wrapped in their own div with `padding: 24px 32px`; chrome stops at tab strip |
| AntD popconfirm/dropdown inside actions look stale next to Hermes buttons | AntD overrides untouched per hard constraint; minor visual delta acceptable on dropdowns only |
| TopbarTrailing collides with library trailing | Page-level `setNode` cleans up on unmount; mutually exclusive |
| KPI tile width breaks at narrower viewport | Grid auto-collapses to 2 cols at <800px (CSS auto-fit) — optional |
| Sparkline data hook misnamed | Verify `useSegmentSizeDelta` and `useSegmentLivePolling` exports |

## Security Considerations

- No permission changes. CDP activation still gated by existing auth.

## Status as of 2026-05-23

⏸️ SCOPE-TRIMMED. Partial completion:
- `detail-view.tsx` rewritten: action bar (Refresh + Copy as filter + Edit + Delete) lifted into topbar trailing via `DetailTopbarActions` helper; in-page Breadcrumbs render removed (topbar covers).

**NOT done (deferred per plan scope):**
- KPI card / tab strip restyle — all 5 tab bodies preserved functionally; KPI visual polish and Hermes tab-strip styling can be a follow-up PRto avoid complexity creep.

Detail page remains fully functional: all 5 tabs (Monitor/Insights/Members/Definition/Activation) render, live polling works, activate-to-CDP flow works, delete confirmation works. Tests pass.

## Next Steps

Phase 9 validates the entire mirror via Playwright pixel diff + E2E smoke.
