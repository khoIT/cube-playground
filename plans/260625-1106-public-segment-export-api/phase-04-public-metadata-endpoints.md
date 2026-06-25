# Phase 04 — Public metadata endpoints

## Context
- Depends on Phase 01 (api-key scope). Sibling to Phase 03 in `public-export.ts`.
- Segment row shape + hydrate: `server/src/routes/segments.ts` (reuse field names).

## Overview
- Priority: P1. Read-only metadata so a consumer can discover segments and decide
  when/what to pull — WITHOUT the FE app-JWT.

## Requirements
- `GET /api/public/v1/segments` — list segments visible to the key (scope-filtered):
  id, name, game_id, size (`uid_count`), status, last_refreshed_at, identity field.
  Paged (`?cursor=`/`?limit=`). Metadata only — never members.
- `GET /api/public/v1/segments/:id` — one segment's metadata + freshness +
  whether a daily snapshot partition exists (so consumers know table vs live path)
  + the export URL.
- Detail response advertises `available_fields` (the columns this key may request
  via `?fields=` on the export endpoint). v1 first ship = `["uid"]`; as fields are
  added this list grows, so consumers discover new fields without a doc change.
- Stable, documented JSON envelope; ISO timestamps; explicit `truncated`/`status`
  semantics so consumers pull only when `status === 'fresh'`.

## Architecture
- Add the two GET handlers to `routes/public-export.ts` (same prefix + api-key
  preHandler). Reuse the segments table query; filter by `canKeyAccessSegment`.
- A small `toPublicSegment(row)` mapper (in `segment-export-stream.ts` or a new
  `public-segment-dto.ts`) so the public shape is decoupled from the internal row
  and can't accidentally leak internal columns.

## Related code files
- Edit: `routes/public-export.ts`.
- Create: `services/public-segment-dto.ts` (mapper) if it keeps files <200 LoC.
- Read: `routes/segments.ts` (row columns), `lakehouse-trino-connector.ts`.

## Implementation steps
1. `toPublicSegment` mapper — explicit allowlist of fields.
2. List handler: scope-filtered query + keyset paging.
3. Detail handler: mapper + partition-exists probe (cheap `max(snapshot_date)`),
   include export URL + recommended path.
4. Tests: scope filtering hides other workspaces/segments; shape stability.

## Todo
- [ ] public-segment-dto mapper (field allowlist)
- [ ] GET /segments (list, scoped, paged)
- [ ] GET /segments/:id (detail + partition probe)
- [ ] tests (scope hide + shape)

## Success criteria
- A key sees only its scoped segments; detail tells the consumer the size, freshness,
  and which pull path to use; no internal-only fields leak.

## Risks
- Field leakage via spread — enforce explicit allowlist mapper, not `{...row}`.
- Partition probe per detail call hits Trino — cache briefly or make it optional.

## Security
- Scope-filtered list = no cross-tenant enumeration. Metadata only; members are
  exclusively the streaming endpoint (Phase 03).
