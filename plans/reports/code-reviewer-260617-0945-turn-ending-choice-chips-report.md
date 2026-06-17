# Code Review — turn-ending choice chips + brand chip colors

Scope: offer_choices tool + disambig_options slot widening + DisambigChips/ConceptChip styling.
Reviewed (changes only): chat-service `offer-choices.ts`, `registry.ts`, `types.ts`, `mode-prompts.ts`, 4 SKILL.md, snapshot test, tool test; FE `chat-sse-client.ts`, `disambig-chips.tsx`, `assistant-message.tsx`, `concept-chip.tsx`, suppression + concept-chip tests. Excluded per instructions: `concept-hover-card.tsx`, unrelated `plans/reports/*`.

## Overall Assessment
Clean, low-risk, well-scoped. Reuses the existing disambig_options channel additively; no new SSE event, no schema/contract break. The implementation mirrors `disambiguate-query.ts` emit shape and existing ConceptChip/scoped-style patterns. All five acceptance criteria verified against source.

## Acceptance criteria — verified

1. **offer_choices emit/validation** — PASS. `offer-choices.ts:53-65` emits exactly one `disambig_options` frame, `slot:'choice'`, agent prompt preserved, options map label/pinText verbatim + descending confidence. zod `inputSchema` (`:40-43`) enforces options 2–6 and pinText 1–300, prompt 1–200; `<2`/`>6`/over-long rejected (test `:76-96`). No emitter → `{emitted:false}`, no throw (`:49-51`, test `:62-74`).
2. **Precedence** — PASS. `assistant-message.tsx:492` `hasExplicitOptions` is slot-agnostic (`disambigOptions.options.length > 0`), so engine slots AND `choice` both suppress FollowupChips (`:569`). Normal turn (no payload) still renders followups. Store handler (`chat-stream-store-actions.ts:203-206`) stores `event.data` untyped-by-slot, so `choice` flows through with zero slot-specific branching. Tests cover all three paths.
3. **Concept chip brand tone** — PASS. `concept-chip.tsx:107-109` brand overrides bg/ink/border; default unchanged (info-soft/info-ink). The removed redundant `background: bg` on the button branch is safe — `chipStyle` already sets `background` and is the single style object passed to both `<Link>` and `<button>`. Tests assert both tones (`:78-91`).
4. **pinText injection safety** — PASS. pinText is rendered only as React text children (`disambig-chips.tsx:110` `{opt.label}` is shown; pinText is passed to `onPick` and committed as a plain user-message string `chat-thread-page.tsx:334-338`). No `dangerouslySetInnerHTML`, no HTML interpolation anywhere in the path. React escapes. Server caps length at 300.
5. **No engine-path break** — PASS. Slot union widened additively in both `types.ts:84` and `chat-sse-client.ts:140`; `DisambigOptionsPayload = SseDisambigOptions['data']` propagates automatically. `disambiguate-query.ts` emit (`:350-358`) untouched; identical frame shape (slot/prompt/options{label,pinText,confidence}).

## Blast radius / regression — clear
- `disambig_options` consumers: only `chat-stream-store-actions.ts:203` (slot-agnostic store) and `disambig-chips.tsx` (handles `choice` branch). No other consumer.
- ConceptChip callers in catalog/builder: `tone` defaults to `'default'`, so unchanged. Only chat (`assistant-message.tsx:141`) passes `tone="brand"`.
- FollowupChips: still renders on normal turns; suppression gate is purely additive.
- mode-prompts gating: `OFFER_CHOICES_GUIDANCE` injected only when `skillMeta.allowedTools.includes('offer_choices')` (`mode-prompts.ts:92`); snapshot test asserts both presence (explore) and absence (no-tool skill).

## Design-token compliance — clear
All colors use tokens: `--brand`, `--brand-soft`, `--brand-hover`, `--text-on-brand` (choice chips), `--info-soft`/`--info-ink` + `--brand`/`--brand-soft` (concept chip). All four brand tokens + info tokens verified present in `tokens.css` for both light and dark themes. No raw hex introduced.

## Minor observations (non-blocking, Low)
- **L1 — `key={opt.label}` in DisambigChips (`:68`):** React key uses the option label. If the agent emits two options with an identical `label` (zod does not enforce uniqueness), React will warn and may misrender. Low likelihood (agent-authored, distinct labels expected) but a `${label}-${idx}` key would be free insurance. Pre-existing pattern concern, not introduced uniquely here.
- **L2 — `--brand-hover` as rest *text* color on `--brand-soft` fill (`disambig-chips.tsx:37`):** orange-700 on orange-50 (light) is high-contrast; in dark mode `--brand-soft` becomes `rgba(240,90,34,0.12)` and `--brand-hover` stays `--orange-700` (only defined in `:root`, not overridden for dark). Worth a quick visual check that orange-700 text is legible on the translucent dark fill — likely fine but unverified visually here.
- **L3 — committed choice chips persist after pick:** once clicked, the chip row remains on the committed assistant turn (re-clickable). This mirrors existing engine-disambig behavior (snapshotted into the committed message), so it is consistent, not a regression — flagging only in case product wants choice chips to disable after selection.

## Unresolved questions
- L2: has the dark-mode legibility of `--brand-hover` text on translucent `--brand-soft` been visually confirmed? (tsc/tests can't catch contrast.)
- Is re-clickability of already-picked choice chips (L3) the intended behavior, or should a picked choice set collapse?

---
**Status:** DONE_WITH_CONCERNS
**Summary:** All 5 acceptance criteria verified in source; additive, no contract/blast-radius regressions; token-compliant. Three Low observations (key-by-label, dark-mode brand-hover text contrast, persistent re-clickable chips) — none blocking.
**Concerns/Blockers:** L1 key-by-label collision risk; L2 unverified dark-mode contrast; L3 re-clickable picked chips (behavioral, confirm with product).
