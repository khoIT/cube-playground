---
name: prefix-workspace-meta-is-union
description: On prefix (prod) workspaces a game-less /meta returns ALL games' prefixed cubes; prefix-stripping flattens them into one union set, so any per-game availability/membership check that gates on member presence collapses to a workspace-global verdict.
metadata:
  type: project
---

On `prefix` (prod) workspaces, `/meta` is game-less and returns every game's prefixed cubes (`cfm_user_gameplay_daily`, `jus_mf_users`, ...). `extractLogicalMembers(meta, prefixes)` strips ALL prefixes via `logicalCubeAcross`, producing a UNION of every game's logical members.

**Why it matters when reviewing per-game features:** any resolver that decides "is member X present for game G?" by checking the prefix-stripped /meta member set will see members from OTHER games on prod and wrongly mark game G as having data it doesn't. On `game_id` (local) workspaces each game's /meta is isolated, so the bug is invisible in local tests and passes CI.

**How to apply:** when a route reads `getGameMembers`/`extractLogicalMembers` and feeds it to a per-game verdict (availability gating, member existence), check whether the workspace is `prefix`. If so, the member set must be filtered to the requested game's prefix BEFORE stripping (e.g. only strip the one matching prefix and drop cubes belonging to other prefixes), or the per-game claim is unsound on prod. Seen first in VIP-care `availability.ts` / `care-playbooks.ts`. Related: [[authz-architecture]] (introspection ctx is service-principal + game-less on prefix by design).
