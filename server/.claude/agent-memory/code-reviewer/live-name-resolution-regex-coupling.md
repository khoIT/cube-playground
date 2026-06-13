---
name: live-name-resolution-regex-coupling
description: NAME_COLUMN_RE in resolve-member-names-live duplicates assembly's name heuristic; broad /name/i can mis-flag id-containing columns
metadata:
  type: project
---

`server/src/services/resolve-member-names-live.ts` resolves uid→in-game-name for displayed CS-care/360 members below the top-1000 profile snapshot, via one bounded identity-IN Cube query (fail-soft, per-segment 60s cooldown, MAX_LIVE_NAME_UIDS=60).

Latent fragility worth watching:
- `NAME_COLUMN_RE = /ingame.?name|player.?name|display.?name|name/i` is duplicated from `resolveMemberInfo` in `segment-cs-care-assembly.ts`. Two copies can drift.
- The bare `|name/i` alternative matches ANY column key/field containing "name" (e.g. a future `username`/`screen_name` measure column would be (mis)flagged name-ish by `memberColumnIsNameish`, and `nameCol` selection picks the first match with no ingame-name-first ordering — unlike assembly which prefers ingame/player/display before bare name).
- Today only `mf-users-hub.yml` preset has a single name-ish memberColumn (`ingame_name`), so no real ambiguity. `etl-game-detail.yml` / `recharge-events.yml` have none → query correctly skipped (account_id does not match the regex).

**Why:** if a future preset adds a second name-ish column or a measure whose id contains "name", the service could resolve the wrong column or mis-skip. **How to apply:** if extending member columns, share one regex + the ingame-first ordering between assembly and the live resolver. See [[jus-vn-mf-users-duplicate-identity-rows]] (single-row identity is what makes limit=capped.length safe here).
