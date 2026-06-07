# Phase 2 — Implement header/action-row + rename to "Open in Playground"

## Context Links
- Chosen variant: `plans/260607-1331-segment-detail-ui-redesign/design/variants.html` (record selected id here after Phase 1)
- Action row: `src/pages/Segments/detail/detail-view.tsx:183-231`
- Styles: `src/pages/Segments/detail/segments.module.css` (`.detailActions`, `.detailTitleRow`, `.detailHeader`, sticky header)
- Deeplink handler (already exists, keep): `buildPlaygroundDeeplink` imported at `detail-view.tsx:33`, called `:190`
- i18n: `src/i18n/locales/en.json:171`, `src/i18n/locales/vi.json:148` (key `segments.detail.actions.copyAsFilter`)

## Overview
- Priority: P1. Status: pending. Blocked by Phase 1 (user pick).
- Implement chosen header/action-row layout in React. Rename "Copy as filter" → "Open in Playground" (label only; handler unchanged).

## Requirements
- Match chosen variant: action grouping, sizing, primary/overflow split. Tokens only, `var(--font-sans)`, scale spacing.
- Preserve existing behaviors: ShareSegmentControl, RefreshNowButton, Edit predicate/Convert to Live (primary, `can_administer` gating + ownerOnly title), Delete (danger, admin-only), disabled-when-empty on the playground button (`uid_list.length === 0`).
- Rename label: add new i18n key `segments.detail.actions.openInPlayground` (en: "Open in Playground", vi: localized) and switch `detail-view.tsx:201` to it. Keep old `copyAsFilter` key only if still referenced elsewhere — grep confirms it is NOT (`saved-analyses-tab.tsx` does not exist `[UNVERIFIED]` scout claim) → safe to remove old key from both locale files.

## Related Code Files
- Modify: `src/pages/Segments/detail/detail-view.tsx` (action-row JSX, label key, optional overflow-menu wiring)
- Modify: `src/pages/Segments/detail/segments.module.css` (action-row/title-row classes per variant)
- Modify: `src/i18n/locales/en.json`, `src/i18n/locales/vi.json` (add `openInPlayground`, remove `copyAsFilter`)
- If overflow menu chosen: may add small `header-actions.tsx` (< 200 LOC) — modularize if detail-view grows.

## Implementation Steps
1. Confirm chosen variant id; translate its layout to JSX, reusing existing controls.
2. Add `openInPlayground` to en.json + vi.json; remove `copyAsFilter` from both.
3. Update `detail-view.tsx:201` to `t('segments.detail.actions.openInPlayground', { defaultValue: 'Open in Playground' })`.
4. If variant uses an overflow menu (antd `Dropdown`), group secondary actions; keep primary inline.
5. Update CSS classes; verify sticky-header still works.
6. `npx tsc --noEmit` build check.

## Todo List
- [ ] Record chosen variant id
- [ ] Implement action-row JSX
- [ ] Add openInPlayground i18n (en+vi), remove copyAsFilter
- [ ] Update label call site
- [ ] CSS update + sticky header verify
- [ ] tsc passes

## Success Criteria
- Action row matches chosen variant; all original handlers fire; disabled/admin gating preserved.
- Button reads "Open in Playground"; clicking still routes via `buildPlaygroundDeeplink`.
- No raw hex, one font, scale spacing. tsc clean.

## Risk Assessment
- R: removing `copyAsFilter` key breaks an unseen reference (Low/Med) → grep `copyAsFilter` repo-wide before delete; only `detail-view.tsx:201` found.
- R: overflow menu hides a destructive action too deeply (Low/Med) → keep Delete reachable, confirm modal unchanged.

## Rollback
- Revert detail-view.tsx + segments.module.css + locale diffs; handler untouched so no data-path risk.

## Next Steps
- Independent of P3/P4/P5. P6 runs tests after.
