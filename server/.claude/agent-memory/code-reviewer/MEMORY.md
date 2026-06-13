# Code Reviewer Memory — cube-playground

- [Authz architecture](authz-architecture.md) — DB-authoritative authz model: how role/grants resolve per-request, fail-closed contract, known guard gaps.
- [Prefix workspace /meta is a union](prefix-workspace-meta-is-union.md) — on prod, game-less /meta returns ALL games' cubes; per-game member-presence checks collapse to workspace-global. CI (game_id) hides it.
- [Care reset clears before mutex](care-reset-clear-before-mutex.md) — POST /api/care/cases/reset DELETEs before acquiring sweep mutex; 409-busy resweep still wiped data.
- [Snapshot manual-trigger cross-gateway race](snapshot-manual-trigger-cross-gateway-race.md) — per-process running flag can't serialize shared-Trino DELETE→INSERT; overlap duplicates partition rows.
- [Live name-resolution regex coupling](live-name-resolution-regex-coupling.md) — resolve-member-names-live NAME_COLUMN_RE dups assembly heuristic; broad /name/i can mis-flag id columns; single name col today.
