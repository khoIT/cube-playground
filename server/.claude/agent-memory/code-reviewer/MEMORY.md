# Code Reviewer Memory — cube-playground

- [Authz architecture](authz-architecture.md) — DB-authoritative authz model: how role/grants resolve per-request, fail-closed contract, known guard gaps.
- [Prefix workspace /meta is a union](prefix-workspace-meta-is-union.md) — on prod, game-less /meta returns ALL games' cubes; per-game member-presence checks collapse to workspace-global. CI (game_id) hides it.
- [Care reset clears before mutex](care-reset-clear-before-mutex.md) — POST /api/care/cases/reset DELETEs before acquiring sweep mutex; 409-busy resweep still wiped data.
