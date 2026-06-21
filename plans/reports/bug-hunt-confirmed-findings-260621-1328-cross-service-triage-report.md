# Cross-Service Bug Hunt — Confirmed Findings (Triage)

**Run:** `wf_50678829-2f7` · **Date:** 2026-06-21 · **Plan:** `plans/260621-1328-exhaustive-cross-service-bug-hunt/`
**Harness:** 9 finders × 3 rounds → 3-skeptic adversarial verify (kill on majority-refute) · 133 agents · 5.88M tokens
**Result:** 40 fresh findings → **19 confirmed** (13 high / 4 med / 2 low) across D1, D2, D3, D4, D9.
**D5–D8 re-run (`wo1smm888`, 2026-06-21):** 7 rounds · 280 agents · 24.7M tokens → 84 fresh → **38 confirmed** (2 crit / 15 high / 18 med / 3 low). Combined hunt total: **57 confirmed.** See [§ D5–D8 re-run results](#d5d8-re-run-results-confirmed).

## ✅ Coverage caveat — RESOLVED (D5–D8 re-run complete)

The original run hit the session limit at 4:50pm (Asia/Saigon) mid-run; D5/D6/D7/D8 were dropped unverified and re-run separately (`wo1smm888`). **All four seams now tested** — 38 additional confirmed findings folded in below.

Re-run data quality: loop-until-dry ran a full **7 rounds** (true convergence, not false-dry). 37/38 confirmations carry a complete 3-skeptic adversarial panel; **1** (`resolve-coverage-range.ts:49`, med) has a partial panel — late-round skeptics hit the session limit again, but those failures fell on retry/duplicate spawns, not on the recorded verdicts. Treat that one finding as lower-confidence.

---

## Fix clusters (19 findings → ~7 root causes)

Several findings share one root cause. Group fixes accordingly.

### Cluster A — balance-error discriminator drops `is_error` (D1, root cause × 3 sites)
The canonical detector `balanceErrorTextOf` (claude-runner.ts:99-102) uses `is_error === true || (subtype && subtype !== 'success')`. Three peripheral call sites copied only the `subtype` half. Live LiteLLM gateway 400 arrives as `subtype:'success' + is_error:true` → these guards are all **false on a real exhaustion**.

| # | Sev | Site | Blast radius |
|---|---|---|---|
| 1 | HIGH | `chat-service/src/api/turn/salvage-timeout-answer.ts:119` | **Worst.** Raw "credit balance is too low" string persisted + streamed as the user-facing salvaged answer; drained key never rotated (salvage is the canary path). |
| 2 | HIGH | `chat-service/src/api/segment-brief.ts:63` | Drained key not reported (failover defeated for this route) + 502 mis-attributed as `invalid_llm_response`. *Note: one skeptic refuted the "error text as brief body" claim — `parseBriefResponse` JSON.parse blocks the leak. The failover-defeat is the real bug; impact is narrower than the finder stated.* |
| 14 | MED | `chat-service/src/api/turn/maybe-summarise-title.ts:82` | Key not reported from title path; session title overwritten with error string. Fire-and-forget → lower sev. |

**Fix:** extract the discriminator into one shared helper, replace all three (and audit for a 4th). One change, three sites.

### Cluster B — segment-movement stale-on-error fallback is dead code (D2)
| # | Sev | Site |
|---|---|---|
| 3 | HIGH | `server/src/routes/segment-movement.ts:260` (+346/416/539) |

Four primary endpoints (kpi-trend, movement, state-distribution, state-distribution-trend) write `cacheSet(cacheKey,…)` on success but read `cacheGet(cacheKey+':stale')` on error — **a key only snapshot-ledger/coverage ever populate.** Stale fallback always null → hard 502 on any Trino blip, despite a docstring promising graceful degradation. CS-polled surfaces. **Fix:** catch reads the bare `cacheKey` (live entry persists for TTL), or write both keys on success.

### Cluster C — tokenless redaction no-op under AUTH_DISABLED (D2) 🔴 security
| # | Sev | Site |
|---|---|---|
| 4 | HIGH | `server/src/middleware/authenticate.ts:170` |

Redaction gates key on `Boolean(req.user)`. Under AUTH_DISABLED the onRequest hook sets `req.user = devUser()` (synthetic admin) for **every** request incl. tokenless curl → `Boolean(req.user)` always true → redaction never fires. Leaks full payer/CS/VIP dossier (billing, ltv, vip, csat) to anyone on the VPN with a segment UUID. Members route doesn't even call `guardSegment` → cross-workspace pull. **Live on local + playground (AUTH_DISABLED, non-prod NODE_ENV); prod real-auth NOT affected** (boot guard blocks AUTH_DISABLED+prod). **Fix:** tokenless routes must distinguish the dev synthetic admin from a real verified token (explicit flag, not identity presence).

### Cluster D — cube-proxy disconnect/telemetry (D3)
| # | Sev | Site | Issue |
|---|---|---|---|
| 5 | HIGH | `server/src/routes/cube-proxy.ts:199` | Client disconnect mid-fetch → AbortError → mapped to 504 timeout (can't distinguish from real timeout). The 499 guard only runs *before* the next fetch. Pollutes query-perf with phantom timeouts; masks disconnect signal. |
| 16 | MED | `server/src/routes/cube-proxy.ts:330` | Deduped followers each re-run `putCachedLoad` + `emitQueryPerf` + `emitQueryRun` → N telemetry rows per 1 upstream round-trip, with followers' latency mis-measured (their wait, not upstream's). |

### Cluster E — chat-service cache key/lifecycle (D4)
| # | Sev | Site | Issue |
|---|---|---|---|
| 6 | HIGH | `chat-service/src/cache/kv-cache-store.ts:172` | `kvSweepExpired` has **zero callers** — never scheduled. No size cap. kv_cache grows unbounded (load/session/disambig rows accumulate forever; turn_detail has no TTL). SQLite bloat + degrading lookups. **Fix:** wire kvSweepExpired into a cron sweep + add max-row cap. |
| 7 | HIGH | `chat-service/src/services/load-cube-rows.ts:68` | `getMetaVersion(...).catch(()=>null)` → metaHash null → key collapses to `h:''`. Key has **no workspace component** (relies on schema hash). Empty hash → two workspaces same gameId+shape collide → cross-workspace/model row leak during meta outages. |
| 17 | MED | `chat-service/src/cache/load-cache-adapter.ts:49` | Same root as #7: `loadCacheKey` omits workspace AND ownerId; even without failure, hash-identical schemas collide. Server proxy key (cube-proxy.ts:271) correctly includes workspace.id first-class — mirror it. |

**Fix #7+#17 together:** add `workspace` (and `ownerId`) as first-class key components; don't degrade silently on null hash.

### Cluster F — cube-dev rollup `build_range_end` missing LEAST cap (D9, × 4 games)
Documented rule (docs/lessons-learned.md:64): tz-carrying timestamp time_dimension → `build_range_end` must `LEAST(MAX(ts), current_timestamp)`. UTC+7 query tz pushes open-partition end past UTC now → CubeStore rejects ("second time provided was later than self") → current month never seals → full-scan fallthrough. cfm etl_login:295 shows correct pattern.

| # | Sev | Site | Column |
|---|---|---|---|
| 10 | HIGH | `cube-dev/cube/model/cubes/jus/recharge.yml:293` | `MAX(pay_time)` |
| 11 | HIGH | `cube-dev/cube/model/cubes/muaw/recharge.yml:216` | `MAX(recharge_time)` |
| 12 | HIGH | `cube-dev/cube/model/cubes/ptg/recharge.yml:221` | `MAX(rechargetime)` |
| 13 | HIGH | `cube-dev/cube/model/cubes/pubg/recharge.yml:235` | `MAX(dteventtime)` |

**Note:** cube-dev is a submodule — fixes land there + need a rollup rebuild to verify (per cube-preagg-build-mechanics memory). Same one-line LEAST wrap × 4.

### Cluster G — D9 metrics reference non-existent measures
| # | Sev | Site | Issue |
|---|---|---|---|
| 8 | HIGH | `server/src/presets/business-metrics/paying_role.yml:11` | `ref: mf_users.paying_roles` — no mf_users cube defines it (only a `user_roles` *segment* by that name). Runtime "member not found" for non-cfm games. |
| 9 | HIGH | `server/src/presets/business-metrics/new_paying_role.yml:13` | `ref: mf_users.new_paying_roles` — defined nowhere. Needs the measure modeled first; ref is wrong cube. |

### Standalone (D2 medium/low)
| # | Sev | Site | Issue |
|---|---|---|---|
| 15 | MED | `server/src/routes/segments.ts:721` | Predicate-segment profile snapshot served fresh with no staleness/cohort-version check. After a refresh where cohort shrank but profile recompute failed, serves OLD enriched rows (departed members) with NEW total_count, `truncated:false`, no stale flag. Mirror manual path's `snapshotCurrent()` guard. |
| 18 | LOW | `chat-service/src/core/anthropic-key-failover.ts:105` | Persisted mode='subscription' silently falls back to full gateway ladder if OAuth token later removed from env + restart. Silent reversal of explicit admin intent (only a console.warn). |
| 19 | LOW | `server/src/routes/segment-movement.ts:142` | Inverted date range (from>to) → negative spanDays bypasses max-span cap, reaches Trino. Not injection (regex-validated), returns empty, but defeats guard intent. Add `from <= to` check → 400. |

---

## Fixes applied (2026-06-21)

Per-finding gated; each cluster has a huashu-design problem+fix illustration. Verified: typecheck clean both services; touched-area tests pass; +9 new regression tests; 0 new suite failures (pre-existing: server `concept-reverse-index` ×2 — `mf_users.acu` coverage gap, same class as #8/#9; chat-service `mode-prompts.snapshot` ×2 — prompt-snapshot drift, unrelated).

| Cluster | Findings | Change | Tests | Illustration |
|---|---|---|---|---|
| **C** | #4 | **REVERTED per user decision.** Initially gated redaction on a new `req.tokenVerified`; reverted to `Boolean(req.user)`. User intent: the admin must see ALL data on local + the VPN-gated playground (`playground.gds.vng.vn`), both AUTH_DISABLED. Accepted trade-off: anonymous VPN callers on the playground see full data (trusted internal admin tool). | +2 (`...auth-disabled-redaction.test.ts`) now **pin admin-sees-everything** (fail if redaction is re-applied to the synthetic admin) | (illustration now describes the reverted approach) |
| **A** | #1 #2 #14 | Promoted `balanceErrorTextOf` + new `isFailureResultMessage` to `anthropic-key-failover.ts`; claude-runner + 3 sites route through the one detector (catches `subtype:'success'+is_error:true`) | +5 (`anthropic-key-failover.test.ts`) | [link](https://claude.ai/code/artifact/e71298cc-fb88-4fc4-9905-38c640781f49) |
| **F** | #10–13 | `LEAST(MAX(ts), current_timestamp)` cap on jus/muaw/ptg/pubg recharge rollups (ptg capped inside COALESCE) | rollup-rebuild verify pending (Trino) | [link](https://claude.ai/code/artifact/c305b20b-9bc2-4e35-be34-88d2a490bbc2) |
| **B** | #3 | `cacheSetWithStale` (writes both keys) + `cacheGetStale` (TTL-bypassing read) across all 6 movement endpoints | +2 (`segment-movement-stale-on-error.test.ts`) | [link](https://claude.ai/code/artifact/cc11d048-fb43-4bef-b600-c3258fa20327) |

**Cluster B note:** the naive parity fix (write `:stale`) was insufficient — fresh + `:stale` share one TTL, and the fresh-hit short-circuit means a TTL-bound stale read expires exactly when needed. The TTL-bypassing `cacheGetStale` is the load-bearing half; the regression test (advance clock 11min → reader error → `stale:true`) proves it.

**Cluster F note:** YAML mirrors the verified-correct `cfm/etl_login.yml` pattern; confirming the partition re-seals needs a cube-dev rollup build against Trino (separate run).

Remaining confirmed (not yet fixed): D — #5 #16 (cube-proxy disconnect/telemetry); E — #6 #7 #17 (cache key/lifecycle); G — #8 #9 (non-existent measures); #15 #18 #19.

### Fixes applied — D5–D8 clusters (2026-06-21)

D6 cluster (H, R1–R13) **accepted as posture, not fixed** (prod single-trusted-admin — see decision box). Clusters I/J/K fixed via the gated flow.

| Cluster | Fixed | Change | Tests | Illustration | Deferred (rationale) |
|---|---|---|---|---|---|
| **I** (D5 coverage-snap) | R14 R15 R16 R18 R19 R21 R23 | emit passes **raw** query to covered loader (R14, the dead re-anchor); `applied = retryRows>0` + honest disclosure (R15); single ISO date = explicit pin (R16); transient probe timeout no longer cached 1h-null (R18); snapped width capped to analysis clamp — defensive, clamp already bounded it (R19); calendar phrases sized correctly (R21); single-date width=1 (R23) | +9 (`resolve-coverage-range` helpers ×7, `emit-query-artifact-chart-fallback` snap-path ×2) | [link](https://claude.ai/code/artifact/eacac269-e4ff-40bd-907d-32d667b11451) | R17 (re-anchor off LLM-chart path — perf); R20 (starter stale-seed pin — needs freshness signal, regression risk); R22 (filter-induced empty — mitigated by R15 disclosure) |
| **J** (D7 SSE registry) | R24 R25 R26 R27 R28 R29 | `writeSseEvent` no-ops on destroyed/ended socket — preserves replay buffering, kills dead-socket writes (R24); turn catch emits `turn_aborted` not a spurious error when aborted (R25); sweeper reaps `running` entries past `maxRunningMs`=30min so a pre-stream throw can't wedge the cap (R26/R27); `pruneOrphanAliases` keeps aliases a live sibling still needs (R28); replay `from` validated → 400 `bad_offset` (R29) | +6 (registry reaper + alias survival/orphan-prune ×3, sse destroyed-socket ×2, replay bad-offset ×1) | [link](https://claude.ai/code/artifact/ce9d07b0-5feb-4f03-865a-7376a7556582) | — (R25 turn-integration test deferred: heavy harness; verified by typecheck + mirrors tested graceful-abort block) |
| **K** (D8 FE streaming) | R30 R35 R37 | guarded `JSON.parse` of `?query=` deeplink — no more app white-screen (R30); synthesize a completed chip for an orphan `tool_result` so a ring-evicted tool round-trip still renders (R35); prune idle/unsubscribed stream entries + orphan aliases on `startTurn` so the maps stay bounded (R37) | +4 (reducer orphan tool_result ×2, store prune ×2; R30 by-construction guard) | [link](https://claude.ai/code/artifact/d6e34f3d-7177-4dda-a88a-7912d783e359) | — (initially deferred R31/R38/R32/R34/R36/R33 — now all shipped, see Cluster K* below) |
| **K\*** (D8 deferred — now done) | R31 R32 R33 R34 R36 R38 | **R31** thrown-abort branch in `turn.ts` now persists the partial via `appendTurn` (mirrors graceful path) → both abort paths refresh-consistent; **R38** store `cancel()` keeps partial as `aborted` (empty → idle fallback), New chat reroutes to `reset()` (now refCount-preserving); commit-on-`done`-or-`aborted` in **both** surfaces. **R32/R34** panel attaches `disambigOptions`+selected-pin to live/committed/persisted msgs + `onDisambigPick`; **R36** panel skips wipe on `null→new-id` promotion; **R33** page chip handlers thread sticky flags | +5 FE (store cancel keep/idle-fallback ×2, panel aborted-commit + disambig-from-persisted + null→id-keep ×3) | [link](https://claude.ai/code/artifact/2d1cc227-1d7d-4471-b52c-e29b6d17763b) | R31 server thrown-abort persist verified-by-construction (identical `appendTurn` to integration-tested graceful path); harness can't interleave a mid-request cancel — coverage gap noted |

---

<a id="d5d8-re-run-results-confirmed"></a>
## D5–D8 re-run results (38 confirmed)

38 findings, numbered `R##` to avoid collision with #1–19. Grouped by seam. **Most severe = 2 crit cross-tenant reads on the prod prefix workspace — flagged for your decision (see 🔴 box), not auto-fixed.**

### ✅ DECISION (2026-06-21) — ACCEPTED, prod is single-trusted-admin

**User decision: the prod prefix workspace (`playground.gds.vng.vn`) is single-trusted-admin** — everyone who reaches it (VPN-gated) is trusted to see all games. R1/R2 and the entire D6 cluster (H, R3–R13) are therefore **within the accepted trade-off, NOT bugs to fix.** Per-game grants are not treated as a cross-tenant security boundary on prod at this stage. Documented here so a later audit doesn't silently reverse it; revisit only if/when prod onboards untrusted per-game users (the Keycloak-RBAC workspace-isolation work). **No code change.**

Context: this extends the AUTH_DISABLED "admin sees everything" call. The `prod` prefix workspace (`authMode:'none'`, `gameModel:'prefix'`) shares one tokenless backend across games; the header gate is the only game scope. Verified-real as a mechanism, accepted as posture.

| # | Site | Bug |
|---|---|---|
| R1 | `server/src/routes/cube-proxy.ts:364` | `/load`, `/sql`, `/dry-run` forward the query body **verbatim** with no body-vs-prefix check. Game gate is on the `x-cube-game` **header** only; body can select another prefix's cubes. A `cfm_vn`-only grantee sends `x-cube-game: cfm_vn` (gate passes) + body selecting `jus_recharge.revenue_vnd` → prod returns jus_vn revenue. Meta filter is cosmetic; data path has no equivalent guard. |
| R2 | `server/src/middleware/workspace-header.ts:122` | Omitting `x-cube-game` entirely skips the per-game RBAC gate → full multi-game catalog + data. |

**Why this needs you, not an auto-fix:** if prod playground is effectively single-admin (everyone who reaches it is trusted), this is *within* your accepted trade-off and needs only a note. If prod genuinely scopes users to specific games (the workspace-isolation work implies it does), this is a real cross-tenant exfil regression and the body must be validated against the granted prefix. **Verified-real either way; the question is whether prod's threat model treats per-game grants as load-bearing.**

### Cluster H — D6 workspace/token RBAC & secret handling (11 more: 6 high / 5 med) — ✅ ACCEPTED, NOT FIXED
> Per the decision above: prod is single-trusted-admin, so these per-game/token-scoping gaps are within the accepted posture. Listed for completeness + future-RBAC reference; **no code change** this round.
| # | Sev | Site | Issue |
|---|---|---|---|
| R3 | HIGH | `server/src/middleware/workspace-header.ts:122` | Server game-RBAC keys off `x-cube-game` header while `/cube-token` scopes the token from a different source — header/token decoupled. |
| R4 | HIGH | `server/src/middleware/workspace-header.ts:107` | Workspace RBAC gate skipped when no `x-cube-workspace` header → falls to default workspace unguarded. |
| R5 | HIGH | `server/src/routes/cube-proxy.ts:389` | `/sql` leaks compiled Trino SQL (schema, table names) for any game on tokenless prod — schema/query leak even if `/load` were gated. |
| R6 | HIGH | `server/src/care/game-scope.ts:27` | `resolveGameScope` validates game *validity* but NOT user *grant* — per-user game RBAC absent across Care. |
| R7 | HIGH | `server/src/routes/care-cases.ts:243` | Care sweep/reset **actuation** runs against any `?game=` with no per-user grant check (write-path, not just read). |
| R8 | HIGH | `server/src/services/sign-cube-token.ts:34` | Minted Cube JWT carries no workspace/audience binding — a token minted for one workspace replays on another. |
| R9 | HIGH | `server/src/routes/cube-token.ts:38` | Token endpoint does no game-grant authz of its own; relies entirely on the header gate. |
| R10 | MED | `server/src/services/sign-cube-token.ts:42` | Minted Cube JWTs never set `exp` — eternal bearer tokens handed to the browser. |
| R11 | MED | `server/src/services/resolve-cube-token.ts:128` | minted-mode silently downgrades to service env token / `CUBE_TOKEN` fallback when `CUBEJS_API_SECRET` absent. |
| R12 | MED | `server/src/auth/auth-storage.ts:37` | `cubeProxyAuthorization` falls back to forwarding the minted Cube token as the proxy `Authorization`. |
| R13 | MED | `server/src/services/workspaces-config-loader.ts:94` | Any parse/FS error on `workspaces.config.json` silently caches the **fallback (local)** config — prod config error → silent local posture. |

### Cluster I — D5 empty-range re-anchor / coverage-snap (10: 3 high / 6 med / —)
| # | Sev | Site | Issue |
|---|---|---|---|
| R14 | HIGH | `chat-service/src/tools/emit-query-artifact.ts:205` | Passes the **normalized** query as `rawQuery`, so relative month/quarter/year ranges lose their original form before re-anchor. |
| R15 | HIGH | `chat-service/src/services/load-cube-rows.ts:193` | `snap.applied=true` even when the snapped re-run returns zero rows — card discloses a window that has no data. |
| R16 | HIGH | `chat-service/src/services/resolve-coverage-range.ts:30` | A single explicit ISO-date `dateRange` string is mis-classified as relative and silently snapped — explicit pins must stay put. |
| R17 | MED | `chat-service/src/tools/emit-query-artifact.ts:201` | Re-anchor only runs when the LLM omits an inline chart; LLM-supplied charts ship un-anchored. |
| R18 | MED | `chat-service/src/services/resolve-coverage-range.ts:96` | Transient coverage-probe timeout cached as `latest=null` for 1h → suppresses all empty-range re-anchoring for that hour. |
| R19 | MED | `chat-service/src/services/load-cube-rows.ts:188` | Snapped re-run drops the analysis-window clamp AND inherits original filters/dimensions. |
| R20 | MED | `chat-service/src/tools/disambiguate-starter-passthrough.ts:132` | Seeded starter chip anchors a 30-day window on a **stale** coverage date with no re-anchor. |
| R21 | MED | `chat-service/src/services/resolve-coverage-range.ts:68` | Calendar-period phrases (today/yesterday/this week/month/last…) mis-handled in classification. |
| R22 | MED | `chat-service/src/services/load-cube-rows.ts:182` | Snap probes cube-wide latest but re-runs the **filtered** query → filter-induced emptiness mis-snapped. |
| R23 | MED | `chat-service/src/services/resolve-coverage-range.ts:49` | Snapped width for a single-date string defaults to 30 days, widening a 1-day pin. **(partial verify panel — lower confidence.)** |

### Cluster J — D7 SSE stream-registry / disconnect (6: 3 high / 2 med / 1 low)
| # | Sev | Site | Issue |
|---|---|---|---|
| R24 | HIGH | `chat-service/src/api/turn.ts:523` | Primary turn stream has **no client-disconnect handler** — runaway turn keeps writing to a dead socket. |
| R25 | HIGH | `chat-service/src/api/turn.ts:803` | A thrown SDK `AbortError` routes through the generic error path, dropping the `turn_aborted` reason. |
| R26 | HIGH | `chat-service/src/api/turn.ts:234` | Exception between `register()` and the main try/finally leaks a permanent `'running'` registry entry. |
| R27 | MED | `chat-service/src/core/stream-registry.ts:110` | Overflow cap counts only `'running'` entries; `register()` is the only guard → aborted-but-leaked entries evade the cap. |
| R28 | MED | `chat-service/src/core/stream-registry.ts:227` | TTL sweeper over-deletes compact aliases still needed by a different live turn on the same session. |
| R29 | LOW | `chat-service/src/api/replay.ts:51` | Replay `from` offset: negative/NaN client value silently coerces (spurious replay or empty). |

### Cluster K — D8 FE streaming parity / robustness (9: 2 high / 5 med / 2 low)
| # | Sev | Site | Issue |
|---|---|---|---|
| R30 | HIGH | `src/components/PlaygroundQueryBuilder/QueryBuilderContainer.tsx:470` | Unguarded `JSON.parse` of `?query=` deeplink param crashes the whole app. |
| R31 | HIGH | `src/stores/chat-stream-store-actions.ts:250` | Server-timeout `turn_aborted` leaves the turn stuck in `'aborted'` — no commit, no banner, partial answer lost. |
| R32 | MED | `src/shell/chat-overlay/chat-panel.tsx:198` | Docked chat panel never renders disambiguation chips (parity gap with main `/chat`). |
| R33 | MED | `src/pages/Chat/chat-thread-page.tsx:354` | Main `/chat` follow-up + disambig chip clicks drop sticky web-search / research-mode / bypass flags. |
| R34 | MED | `src/shell/chat-overlay/use-panel-chat-state.ts:179` | Docked panel never threads `disambigOptions` into any message (streaming or committed). |
| R35 | MED | `src/stores/chat-stream-store-actions.ts:183` | `tool_result` without a preceding `tool_call` silently dropped (reachable on ring-buffer eviction). |
| R36 | MED | `src/shell/chat-overlay/use-panel-chat-state.ts:100` | Panel wipes committed messages (incl. just-sent user bubble) when a new session is injected. |
| R37 | LOW | `src/stores/chat-stream-store.ts:113` | `streams` + `aliases` Maps never pruned — unbounded growth across SPA session. |
| R38 | LOW | `src/pages/Chat/hooks/use-cancel-turn.ts:43` | User-cancel path can never reach `'aborted'` — `cancelLocal()` resets to idle first. |

**Cross-cutting note:** R32/R34 (docked-panel disambig parity) and R33 (sticky-flag drop) match the [[chat-feature-parity-two-surfaces]] memory exactly — every new chat feature must render in BOTH `/chat` and the docked panel. R35 (orphan `tool_result`) + R37 (unbounded Maps) are the FE mirror of the D7 registry-lifecycle bugs.

---

## Recommended triage order

1. **C (#4)** — security, leaks real payer data on the playground host. Fastest high-value fix.
2. **A (#1,2,14)** — one shared-helper fix kills 3 failover bugs.
3. **F (#10-13)** — 4× one-line LEAST cap, mechanical, restores rollup serving (perf).
4. **B (#3)** — availability regression, CS-facing.
5. **E (#6,7,17)** — cache correctness/growth.
6. **G (#8,9)**, **D (#5,16)**, **#15/#18/#19** as capacity allows.

## Unresolved questions

1. ~~**🔴 prod cross-tenant reads (R1/R2, crit)**~~ — **RESOLVED**: user confirmed `playground.gds.vng.vn` prefix workspace is single-trusted-admin; per-game grants are NOT a cross-tenant boundary at this stage. R1/R2 + D6 cluster H accepted as posture, not fixed (locked in decision box + [[prod-cross-tenant-reads-accepted]] memory). Revisit only when Keycloak RBAC lands.
2. **D6 token-hardening scope (R8–R12)** — JWT `exp`, workspace/audience binding, and minted-token-as-proxy-auth fallback are defensible hardening but touch the auth path that powers the admin-sees-everything posture. Fix all, subset, or defer? *(part of the accepted-posture cluster; not yet greenlit)*
3. **Finding #2 impact** — verified narrower than the finder claimed (no error-text leak; failover-defeat is the real bug). Keep as HIGH or downgrade to MED?
4. **Cluster F verification** — confirming the rollup actually re-seals requires a cube-dev build run (submodule). In scope for the fix phase?
5. ~~Per fix policy: each authorized fix gets a huashu-design illustration before code.~~ **RESOLVED**: I/J/K shipped + committed; the 6 deferred K items (R31/R38 + R32/R34/R36/R33) now also shipped (Cluster K* row) with illustration. **One remaining coverage gap**: the server thrown-abort persist (R31) has no integration test — the harness can't interleave a mid-request cancel to drive a live thrown `AbortError`; verified-by-construction against the integration-tested graceful `appendTurn`. Worth a dedicated harness if abort persistence becomes load-bearing.
6. **Remaining confirmed clusters not yet authorized to fix** — D (#5 #16), E (#6 #7 #17), G (#8 #9), and standalone #15/#18/#19 from the original 19. Fix next, or close out the bug hunt here?
