# Phase 07 — VI glossary seed enrichment

## Context Links

- Current seed: `server/data/glossary.seed.json` (English-only, ~30 entries)
- Seed loader: `server/src/db/glossary-migrate.ts` (preserves user edits per phase-01 changes)
- Schema (post phase-01): bilingual columns + `status` + `source`
- Catalog conventions: `business_metrics/<slug>` IDs (see existing seed for canonical patterns)

## Overview

- Priority: P2 (gates Aggressive-mode usefulness for VI users; without this, VI synonym lookups largely miss).
- Status: pending.
- Add VI translations to all existing seed entries and add ~20 new finance/user/revenue terms common in VN game-ops vocabulary. All seed-shipped rows start as `status='official'` (these are authoritative).

## Key Insights

- Per phase-01, seed rows are tagged `source='seed'`. Seed UPSERT preserves user-touched rows (`editor_name IS NOT NULL`).
- Seed entries must declare `status: 'official'` explicitly — otherwise loader defaults to 'draft' and the chat agent (which reads Official-only) would miss them.
- Aliases must be lowercased and deduplicated; phrase aliases supported (synonym-resolver uses longest-match).
- Catalog refs (`primary_catalog_id`) for newly added terms must exist in the catalog or be marked nullable; otherwise the chat tool ref-guard flags them as missing.

## Requirements

### Functional

- Update seed JSON schema (interpreted by `glossary-migrate.ts`) to optionally include:
  - `label_vi: string`
  - `description_vi: string`
  - `aliases_vi: string[]`
  - `status: 'draft' | 'official'` (default 'official' for seed)
- Add VI fields to all existing entries (DAU, MAU, WAU, stickiness, D1/D7/D30 retention, etc.).
- Add new entries (target ~20):
  - **Revenue family**: `revenue`(doanh thu), `gross_revenue`(doanh thu gộp), `net_revenue`(doanh thu thuần), `arpu`(ARPU), `arppu`(ARPPU), `ltv`(LTV / giá trị vòng đời), `mrr`(doanh thu định kỳ).
  - **User family**: `paying_user`(người dùng trả phí), `payer`(payer), `new_user`(người dùng mới), `returning_user`(người dùng quay lại), `churned_user`(người dùng rời bỏ), `whale`(cá voi / chi tiêu cao).
  - **Behaviour**: `session_length`(thời lượng phiên), `session_count`(số phiên), `conversion_rate`(tỷ lệ chuyển đổi), `churn_rate`(tỷ lệ rời bỏ), `retention`(retention / giữ chân).
  - **Time periods**: `quarter`(quý) — not a metric, omit `primary_catalog_id`; pure synonym anchor.
- `category` for new entries: `revenue`, `user`, `engagement`, `retention`, `time`.

### Non-functional

- Seed JSON valid JSON; no comments.
- Diff stays reviewable (one entry per logical block, sorted by id alphabetically inside a category).
- Loader's purge behaviour (phase-01: `source='seed'` only) MUST be respected: removed seed entries DELETE; user rows untouched.

## Architecture

```
glossary.seed.json (data file)
  └─ migrateGlossarySeed (phase-01) → glossary_terms
      └─ chat-service nl-to-query/glossary-client (phase-05) reads status=official
```

No code change in this phase — purely data.

## Related Code Files

### Modify

- `server/data/glossary.seed.json` — add VI fields to all existing entries; add ~20 new entries; bump `version` to 2.

### Create

- None.

### Delete

- None.

## Implementation Steps

1. Bump `version` to 2 in the seed file.
2. For each existing entry, add:
   - `label_vi` — short VI label (often same acronym for DAU/MAU/WAU; or VI phrase).
   - `description_vi` — full VI description.
   - `aliases_vi` — lowercased VI alias list (include diacritic + non-diacritic where commonly typed without accents).
   - `status: "official"`.
3. Append the new entries listed above. Each must include `id`, `label`, `description`, `label_vi`, `description_vi`, `aliases`, `aliases_vi`, `category`, `status: "official"`, and `primary_catalog_id` when a catalog ref exists (else omit; loader handles null).
4. Verify alias hygiene:
   - All aliases lowercased.
   - No duplicates within an entry.
   - No alias appears in two different entries (ambiguity); script-check with a one-liner before commit (`jq` sufficient).
5. Restart server locally; confirm `/api/glossary?status=official` returns expected row count.
6. Open the Glossary index page; verify VI fields display correctly.

### Example new entry (revenue / doanh thu)

```json
{
  "id": "revenue",
  "label": "Revenue",
  "description": "Total monetary value collected from in-app purchases, net of platform fees varies by report.",
  "label_vi": "Doanh thu",
  "description_vi": "Tổng giá trị tiền thu được từ thanh toán trong ứng dụng. Một số báo cáo trừ phí nền tảng.",
  "primary_catalog_id": "business_metrics/revenue",
  "aliases": ["revenue", "rev", "gross revenue", "in-app revenue"],
  "aliases_vi": ["doanh thu", "doanh thu gộp", "doanh thu in-app", "tổng doanh thu"],
  "category": "revenue",
  "status": "official"
}
```

## Todo List

- [ ] Existing entries get VI fields
- [ ] ~20 new entries added (revenue/user/behaviour/time families)
- [ ] `version` bumped to 2
- [ ] Alias uniqueness verified (jq)
- [ ] Local boot verifies row count + UI render
- [ ] All status set to "official"

## Success Criteria

- `SELECT COUNT(*) FROM glossary_terms WHERE status='official'` ≥ 50 after boot.
- `disambiguate_query` test for "doanh thu trong Q1 2026" resolves metric to `business_metrics/revenue`.
- No alias collision across entries.
- Existing user-created draft rows survive a re-seed (verified via phase-01 logic).

## Risk Assessment

- **R7.1**: `primary_catalog_id` for newly added entries may not exist in current catalog → chat tool ref-guard returns `metric_draft`. Mitigation: only add `primary_catalog_id` where the catalog already has the entry; otherwise omit (the term is still recognised as a synonym anchor without a query target).
- **R7.2**: Translation accuracy — recommend a quick native review before merge; do not auto-translate via LLM in CI.
- **R7.3**: Alias bloat (>20/entry) breaks zod cap from phase-01 — keep aliases focused (3-8 each).
- **R7.4**: Seed delete on rename: if we rename an `id`, the old row is purged. Acceptable for seed-source rows; document in commit message.

## Security Considerations

- Seed JSON ships in repo — treat all strings as trusted at boot. UI still escapes on render (React text nodes).
- No PII; safe to log.

## Next Steps / Dependencies

- Phase 08 eval suite cites these entries; tuning depends on enriched aliases.

## Open questions

- Q7.1: Which currency / FX convention applies for `revenue` (USD vs local)? Plan currently uses generic monetary value. Confirm with finance before phase-08 calibration.
- Q7.2: Should `paying_user` be aliased to `payer` (treat as same term) or kept distinct? Default: alias to same term (single row). Confirm.
