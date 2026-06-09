# Chat-service language-mirror guardrail

**Status:** ✅ complete (implemented, tested 1124/1124 + 23 targeted, code-reviewed DONE_WITH_CONCERNS → both medium items addressed: distinct-word dedupe applied; 'la' collision accepted as bounded)
**Scope:** chat-service only. Reply language must mirror the user's message language (vi↔vi, en↔en), never mix prose languages.

## Requirements (user-confirmed)

1. **Approach:** static prompt block in `compose()` **+** per-turn server-side detection injecting an explicit directive. Zero extra LLM calls.
2. **Ambiguity tie-break:** ambiguous/mixed turn → follow language of prior user turns in session; first turn ambiguous → default English.
3. **Identifiers exempt:** `{{field:...}}` chips, cube member names, SQL, code stay verbatim English inside Vietnamese prose.

## Acceptance criteria

- Vietnamese message → per-turn directive "respond entirely in Vietnamese" present in system prompt.
- English message → directive says English.
- Ambiguous message ("revenue cfm_vn 30d") with prior Vietnamese user turn → Vietnamese directive.
- Ambiguous first turn → English directive (explicit default, not absent).
- Static guardrail block present in every composed prompt (all 4 skills).
- Existing snapshot tests updated; full chat-service test suite green; no public contract changes (compose params grow optionally; ComposeResult unchanged).

## Files

| File | Change |
|---|---|
| `chat-service/src/core/turn-language.ts` | **NEW** — `detectMessageLanguage(text): 'vi'\|'en'\|null` (VN diacritic regex + small no-diacritic VN-stopword check; null when no signal) and `resolveTurnLanguage(message, priorUserTexts): 'vi'\|'en'` (current → walk prior user turns latest-first → default 'en') |
| `chat-service/src/core/mode-prompts.ts` | Add `LANGUAGE_MIRROR_GUIDANCE` const (always pushed, after FIELD_CHIP block); add optional `language?: 'vi'\|'en'` to `ComposeParams`; push 1-line per-turn directive when set |
| `chat-service/src/api/turn.ts` | Compute `resolveTurnLanguage(body.message, existingTurns user texts)` (existingTurns already fetched at line 240) and pass to `compose()` |
| `chat-service/.claude/commands/cube-playground.md` | Strengthen Tone line: never mix languages in one reply; identifiers stay verbatim |
| `chat-service/test/turn-language.test.ts` | **NEW** — unit tests: vi diacritics, plain en, no-diacritic vi stopwords, ambiguous + history fallback, ambiguous first-turn default en |
| `chat-service/test/mode-prompts.snapshot.test.ts` (+ compare-diagnose variant) | Update snapshots; add case asserting the directive line for `language: 'vi'` |

## Detection heuristic (KISS, no deps)

1. Strip `{{field:...}}` / `{{cite:...}}` tokens + backtick code spans before detection (identifier noise).
2. Vietnamese-specific diacritic chars (`ăâđêôơưáàảãạ…` class incl. đ/Đ) → `'vi'`.
3. Else tokenize lowercase words; ≥2 hits in a ~25-word no-diacritic Vietnamese stopword list (`cho, xem, bao, nhieu, doanh, thu, nguoi, choi, ngay, thang, cua, la, khong, giup, voi…`) → `'vi'`.
4. Else ≥2 ASCII alphabetic words → `'en'`.
5. Else `null` (emoji-only, numbers/member-names-only).

## Out of scope

- Languages other than vi/en; post-hoc output validation/retry; FE changes; segment-brief lang param (already has its own lang).

## Risks

- Snapshot churn: 2 snapshot test files — intended change, reviewed via diff.
- False 'en' on diacritic-free Vietnamese with no stopword hits → mitigated by history fallback (criterion 3).
