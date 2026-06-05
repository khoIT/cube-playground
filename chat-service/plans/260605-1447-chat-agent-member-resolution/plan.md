# Chat agent member resolution

**Status:** planned · **Branch:** `feat/chat-agent-member-resolution`

## Problem

The chat agent (explore skill) builds Cube queries by hand-guessing physical
member names against the full `/meta` blob it cannot grep, then trial-and-errors
filter-value casing. One whale-leaderboard turn burned the entire 120s budget on
this and was killed by the timeout (session `8e8e375e`). Two thrash classes:

1. **Member-name guessing** — `uid`→`user_id`, `time.event_date`→`recharge.recharge_date`.
2. **Filter-value casing** — `whale` vs `Whale`.

The disambiguator already resolves the *metric* + core slots, but when the agent
*augments* a query with extra dimensions/filters it has no resolver and falls
back to grepping meta.

## Goal

Agent resolves natural language → physical Cube members (glossary **and** live
meta) **and** filter values in ≤1 tool round-trip. Elegant, reuse-first,
workspace-portable (prefix vs game_id cube layouts).

## Architecture (layered, reuse-first)

```
resolve_query_terms({terms[]})            list_dimension_values({member, q?})
        │                                          │
        ▼                                          ▼
  resolveQueryTerms(terms, glossary, meta)   /load: [dim + count] desc, small limit
        ├─ 1. glossary  → resolveTerms / findExactMatch   (existing)
        ├─ 2. live meta → searchMembers(meta, term)        (NEW, pure)
        └─ 3. classify  → resolveMemberMeta                (existing)
              → {member, cube, kind, dataType, label, confidence, matchedOn}
```

Reused as-is: `fetchOfficialGlossary` (cached), `resolveTerms`/`findExactMatch`
(`synonym-resolver`), `resolveMemberMeta` (`cube-meta-capability`),
`getMeta(gameId, workspace)` (`cube-meta-cache`), `/load` fetch
(`preview-cube-query`). New: one pure search helper + two thin tool wrappers.

## Phases

| Phase | Title | Status |
|-------|-------|--------|
| 01 | Resolver engine + `resolve_query_terms` tool | planned |
| 02 | `list_dimension_values` tool | planned |
| 03 | Explore skill wiring + lessons-learned | planned |

- [phase-01-resolver-engine-and-tool.md](phase-01-resolver-engine-and-tool.md)
- [phase-02-dimension-values-tool.md](phase-02-dimension-values-tool.md)
- [phase-03-skill-wiring-and-docs.md](phase-03-skill-wiring-and-docs.md)

## Out of scope (deferred — YAGNI)

- Pre-injecting the disambiguator's resolution into agent first-turn context.
  Pure latency optimization; additive on top of the tool with extra wiring/risk.
  Revisit if telemetry shows resolve calls dominate turn count.

## Key dependencies

- Live `/meta` shape: `cubes[].measures[]` / `dimensions[]` with `name`,
  `title`, `shortTitle`, `type` (already consumed by `resolveMemberMeta`).
- Glossary: `OfficialTerm[]` via `fetchOfficialGlossary()`.

## Open questions

- Cardinality guard for `list_dimension_values`: cap result rows (e.g. 50) and
  signal truncation rather than enumerate a high-cardinality dimension. Confirm
  cap during phase 02.
