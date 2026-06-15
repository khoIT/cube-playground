---
phase: 4
title: "Enforcement & Cleanup"
status: completed
priority: P2
effort: "1d"
dependencies: [0, 2, 3]
---
<!-- Updated: Validation Session 1 - enforce via pre-push git hook (no in-repo CI exists); final gate run = Phase 0 visual harness -->


# Phase 4: Enforcement & Cleanup

## Overview

Lock in the centralization: delete the now-dead raw scales and compat aliases, then add a lint rule enforced by a pre-push git hook that fails on any new raw-token or inline-hex reference. No lint tooling (and no in-repo CI) exists today, so this phase stands it up from scratch.

## Key Insights

- After Phases 2–3 nothing references `--hermes-*` or `T.*` colors, and `--neutral-*` survives only as the (private) primitive layer feeding semantic tokens — or can be folded into theme-agnostic primitive names per the Phase 1 target model.
- The repo has **no eslint/stylelint, no `lint` script, and no in-repo CI** (`.gitlab-ci.yml` / `.github/workflows` absent) — adding lint is itself a small infra task; keep config minimal and targeted at the drift we just removed.
- Deploy happens by pushing the `second` GitLab remote (auto-deploys). With no server-side CI in the repo, the enforceable gate is a **pre-push git hook** running `npm run lint`.
- The guard must allow tokens to be *defined* (in `tokens.css`) and the chart/data-viz allowlist from Phase 3, while banning raw refs everywhere else.

## Requirements

- Functional: `npm run lint` exists and flags (a) inline hex in `src/**/*.{ts,tsx}`, (b) `var(--neutral-*)` / `var(--hermes-*)` outside `tokens.css`, (c) `T.<color>` (should already be gone). A **pre-push git hook** runs it and blocks the push on violations.
- Non-functional: lint runs fast; allowlist is explicit and documented; design-guidelines reflects the final contract.

## Architecture

- **stylelint** for `.css` (ban raw custom-property refs outside `tokens.css`) + **eslint** rule for `.tsx/.ts` inline hex (e.g. `no-restricted-syntax` / a regex-based rule on string literals, or a small custom rule). Pick the lightest combination that catches the three patterns; a single eslint regex rule on string/template literals may cover hex + `var(--neutral|hermes` if CSS-in-JS dominates.
- Allowlist: data-viz/3rd-party files via eslint-disable scoped comments or a config ignore list, documented in `docs/design-guidelines.md`. (Note: `CHART` is no longer an allowlist case — Phase 1 promoted it to `--chart-1..8` tokens.)
- Gate: install a pre-push hook (husky or simple-git-hooks — pick the lighter; check `package.json` for an existing `prepare` script to extend) that runs `npm run lint`. No in-repo CI to wire into; a server-side CI step can be added later if the deploy pipeline gains repo config.

## Related Code Files

- Create: `eslint.config.js` (or `.eslintrc`) and/or `.stylelintrc.json`; `package.json` `lint` script + devDeps; pre-push hook config (husky `.husky/pre-push` or `simple-git-hooks` field).
- Modify: `src/theme/tokens.css` (remove `--hermes-*` aliases; collapse/rename neutrals to primitive layer per Phase 1 target).
- Modify: `src/shell/theme.tsx` (final state: no color members; confirm nothing imports removed members).
- Modify: `docs/design-guidelines.md` (final contract + allowlist + "how to add a token").

## Implementation Steps

1. Grep-confirm zero references to `--hermes-*`, `T.<color>`, and non-primitive `--neutral-*`; delete the dead aliases/scale from `tokens.css`.
2. Add eslint (+ stylelint if needed) with a minimal config and the drift rules; add `lint` script + devDeps to `package.json`.
3. Run lint; fix any stragglers it surfaces (expected: a few missed hex). Confirm a deliberately-inserted raw ref fails lint, then revert that test.
4. Install the pre-push hook running `npm run lint`; confirm the gate blocks a push containing a violation.
5. Update `docs/design-guidelines.md`: final three-tier model, allowlist, and the rule "components read semantic tokens only; primitives & raw values live in tokens.css."

## Success Criteria

- [x] `--hermes-*` removed; `--neutral-*` only as private primitives; `tokens.css` is the sole home of raw values.
- [x] `npm run lint` passes clean and **fails** on an injected inline-hex / raw-var reference.
- [x] Pre-push hook runs lint and blocks a push that contains a violation.
- [x] `docs/design-guidelines.md` documents the final contract + allowlist + token-adding workflow.
- [x] tsc clean (no new errors); Phase 0 visual gate passes 22/22 (light + dark; `/build` excluded — known live-data route).

## Outcome

Decision (user-confirmed via huashu visual comparison): **Option 1** for the raw `--neutral-*` migration — invariant fills for the theme-invariant greys + surface-token fix for the dual-meaning ones. Lower risk than full adaptive migration; same footgun killed; light byte-identical.

**Cleanup**
- Migrated the 5 last live `var(--hermes-*)` refs → `--surface-*` / `--shell-brand*` (byte-identical aliases) and **deleted the 84-token `--hermes-*` scale** from `tokens.css`. (`87c4759`)
- Added single-meaning component primitives (`--surface-inset/-strong/-inverse`, `--text-inverse/-dim`, `--fill-muted/-faint`) and migrated **24 component files** off raw `var(--neutral-*)`. `--neutral-*` is now referenced only inside `src/theme/`. Dual-meaning surfaces now resolve dark correctly (near-white bug fixed); `segments-dark` baseline re-captured. (`4d923bd`)
- `src/theme/antd-overrides.css` keeps its `var(--neutral-700)` dark-tooltip refs — it is part of the theme layer, exempt by design.

**Enforcement**
- `scripts/lint-theme-tokens.mjs` (no eslint/stylelint — a scoped bespoke linter, zero new deps) bans inline hex (outside `HEX_ALLOWLIST`), raw `--neutral-*`/`--hermes-*` outside `src/theme/`, and `T.<color>`. Wired to `npm run lint` + `scripts/git-hooks/pre-push` (`core.hooksPath` already set by `prepare`). Verified: clean on HEAD, exit 1 on injected drift, hook blocks. (`b67bedf`)
- `docs/design-guidelines.md` §11/§12 record the final contract, component primitives, allowlist, and how-to-add-a-color. (`33dd187`)

**Deferred (documented, allowlisted):** `metric-list-row.tsx` trust hues (`#0f7a3a`/`#8a5a05`) — converging to the trust-badge token canon needs a light re-baseline.

## Risk Assessment

- **Risk:** standing up eslint from scratch flags large volumes of pre-existing unrelated issues. **Mitigation:** scope the config to the drift rules only (no broad ruleset); expand later separately.
- **Risk:** pre-push hook is bypassable (`--no-verify`) and only local. **Mitigation:** accept as the available gate given no in-repo CI; document that a server-side CI step should be added if/when the deploy pipeline gains repo config. Run lint on `src/**` only to keep it fast.
- **Risk:** removing neutrals breaks a missed reference. **Mitigation:** grep-gate before deletion; `tsc` + lint + visual pass catch the rest.
