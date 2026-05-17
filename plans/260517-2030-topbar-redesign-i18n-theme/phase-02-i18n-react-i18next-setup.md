---
phase: 2
title: "i18n react-i18next setup"
status: completed
priority: P1
effort: "3h"
dependencies: []
---

# Phase 2: i18n react-i18next setup

## Overview

Install `react-i18next` + `i18next` + `i18next-browser-languagedetector`. Wire `I18nextProvider`, expose `useTranslation`. Extract header + main-nav strings to `en.json` / `vi.json`. Toggle persists to localStorage.

## Requirements
- Functional: `t('nav.playground')` returns English by default; switching language flips header pills, mobile menu items, user-dropdown labels, brand badge, and notification popover empty state. Choice persists. `lang` attribute on `<html>` updates.
- Non-functional: no SSR; pure client. Bundle delta < 25 KB gzipped. Existing untranslated strings keep current copy (no key explosion).

## Architecture
- `src/i18n/index.ts` — initialize i18next, register resources, configure detector (order: localStorage → navigator → fallback `en`).
- `src/i18n/locales/en.json`, `src/i18n/locales/vi.json` — header + nav keys only.
- Namespaces: single `common` namespace this round.
- `src/i18n/use-lang.ts` — thin wrapper exposing `{ lang, setLang, toggle }` over `i18n.changeLanguage` + `useTranslation`.

## Related Code Files
- Create: `src/i18n/index.ts`, `src/i18n/locales/en.json`, `src/i18n/locales/vi.json`, `src/i18n/use-lang.ts`
- Modify: `src/index.tsx` (import `./i18n` for side-effects, mount `<I18nextProvider i18n={i18n}>`), `package.json` (deps)

## Implementation Steps
1. `npm install --legacy-peer-deps react-i18next i18next i18next-browser-languagedetector`.
2. Create `src/i18n/index.ts` initializing i18next with en + vi resources, detector caches `gds-cube:lang`.
3. Author `en.json` with keys: `brand.platform`, `nav.playground`, `nav.newMetric`, `nav.catalog`, `tabs.models`, `tabs.catalog`, `user.settings.securityContext`, `user.settings.legacyNewMetric`, `user.settings.addRollup`, `user.theme.light`, `user.theme.dark`, `user.language.en`, `user.language.vi`, `user.theme.label`, `user.language.label`, `notifications.empty`, `notifications.title`, `search.placeholder`, `help.tooltip`.
4. Author `vi.json` mirror with Vietnamese strings (e.g. `nav.playground = "Sân chơi"`, `nav.newMetric = "Chỉ số mới"`, `nav.catalog = "Danh mục"`, `tabs.models = "Mô hình"`, `user.settings.securityContext = "Bảo mật"`, `notifications.empty = "Không có thông báo"`, etc.).
5. In `src/index.tsx` add `import './i18n'` before render. Optionally wrap with `I18nextProvider` if Suspense fallback needed (lib auto-handles when `useSuspense: false`).
6. Create `src/i18n/use-lang.ts` — returns `{ lang: i18n.language, setLang(l), toggle() }`. On change writes `document.documentElement.lang = l`.
7. Run `npm run typecheck` + `npm run build`.

## Success Criteria
- [ ] `i18n.changeLanguage('vi')` from devtools updates rendered header pill copy.
- [ ] Reload preserves last choice.
- [ ] No new lint / TS errors.
- [ ] No regressions in pages NOT translated yet (they keep their literal strings).

## Risk Assessment
- `--legacy-peer-deps` already global (per `.npmrc`); install should be clean.
- VN strings need a Vietnamese-fluent eyeball — initial keys are short and unambiguous; copy can iterate post-merge.

## Security Considerations
- None. Static JSON resources.

## Next Steps
- Phase 4 + 5 consume `useTranslation()` for header.
- Future phases can add per-feature namespaces without churning this setup.
