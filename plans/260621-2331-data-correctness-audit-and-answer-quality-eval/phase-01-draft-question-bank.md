# Question Bank — FINAL scoped (awaiting go-ahead for eval fan-out)

**Status:** generated, scoped per confirmed decisions. Artifacts in `question-bank/`.
**Gate:** confirm this list → then Phase 02 audit + Phase 03 eval run. Nothing fanned out yet.

## Confirmed decisions

- Games: **cfm_vn + jus_vn** first. Env: **local cube-dev** (oracle + data), eval on **local dev**.
- Advisor/prescriptive questions: **included**, loose scoring (answered / non-empty / no-error).
- Catalog breadth: **split by phase** — all measures audited programmatically (Phase 02), eval bank stays NL-natural (asked + glossary).
- Locale: **en-all + vi-top-N**.

## What got generated (`question-bank/`)

| File | Purpose | Count |
|---|---|---|
| `cfm_vn-audit-targets.json` | Phase 02 — every public measure to value-verify vs cube-dev | **353** (32 cubes) |
| `jus_vn-audit-targets.json` | Phase 02 — same | **255** (33 cubes) |
| `cfm_vn-eval-bank.json` | Phase 03 — NL cases | **272** |
| `jus_vn-eval-bank.json` | Phase 03 — NL cases | **30** (+~80 when jus glossary live-resolved) |
| `generator-draft.py` | Offline draft generator (ports to in-repo TS in Phase 01 exec) | — |

**Phase 02 audit coverage: 608 measures. Phase 03 eval bank: ~302 cases now (~382 with jus live glossary).**

## Phase 03 eval bank composition

### cfm_vn (272)
- **asked** 179 — mined from `chat_turns` (game-scoped), frequency-weighted. Real usage. Golden ref unknown → loose score (top-N auto-labelled on first clean run).
- **synthesized-glossary** 84 — 21 certified glossary terms × 4 shapes (trend/aggregate/compare/breakdown). Deterministic golden refs from glossary snapshot.
- **synthesized-glossary-vi** 9 — vi for revenue/DAU/ARPU/ARPPU/ARPDAU/LTV/retention/WAU/MAU.

### jus_vn (30, +~80 pending)
- **asked** 30 — game-specific (role-class session time, character-class ARPPU, per-server DAU, billing). Golden ref loose.
- glossary-NL **deferred to live resolve** (no offline jus snapshot; refs resolve at runtime). Adds ~80 once the service is up — a Phase 01 execution step.

## Scoring per case (Phase 03)

1. **resolution** — emitted `cube.measure` == golden (synthesized cases; loose for asked/advisor).
2. **non-empty range** — artifact has rows.
3. **answered vs refused** — produced an artifact at all.
4. **trust-guard fired** — for caveated measures, the trust rail surfaced.

## Data-quality smells already surfaced (feed Phase 02)

- `Churner`, `Dormant user`, `Returning user` → all `active_daily.dau` (three states, one measure — suspicious).
- `Revenue`, `Spender`, `New spender`, `First-time payer` → all `recharge.revenue_vnd` (known duplicate-ref cluster).

## Decisions baked in (not silently — flagged)

- Headline/raw catalog measures are **NOT** synthesized as NL eval cases. Auto cube-ref phrasings (`active_daily.rows`, `trailing_wau`, `mau_prev_month`) are degenerate; full measure coverage lives in Phase 02's programmatic audit instead. (Reversal of the literal "synthesize from raw catalog as NL" reading, per the confirmed split-by-phase choice.)

## Next steps (on go-ahead)

1. Port `generator-draft.py` → in-repo `chat-service/test/eval/question-bank-builder.ts` (asked miner + glossary synth + audit-target emitter).
2. Live-resolve jus_vn glossary refs (+~80 eval cases).
3. Phase 02: extend `cube-parity-recorder` to value-verify the 608 audit targets.
4. Phase 03: run the 302-case bank through `/agent/turn` (subscription lane, local dev) → scorecard.

## Unresolved questions

- Q1: jus_vn glossary live-resolve — block the eval on it, or run cfm_vn full + jus_vn asked-only first, add jus glossary in a second pass? (lean: run now, add jus glossary next pass.)
- Q2: asked-question golden labels — auto-label top-N from first clean run, or hand-label before scoring? (lean: auto-label top-N, spot-check.)
