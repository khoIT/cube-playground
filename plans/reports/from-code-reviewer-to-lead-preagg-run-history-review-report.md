# Code Review — Pre-agg Run History Console

Reviewer: code-reviewer · 2026-06-10 · target: uncommitted working tree → commit on main

## Scope
- New: `server/src/types/preagg-run.ts`, `db/migrations/045-preagg-run-history.sql`, `db/preagg-run-store.ts`, `services/{preagg-run-parser,preagg-run-merge,docker-log-reader,preagg-run-collector}.ts`, `routes/preagg-runs.ts`, `src/types/preagg-run.ts`, `src/pages/Admin/hub/{preagg-runs-data.ts,preagg-runs-sweep-row.tsx,preagg-runs-tab.tsx}`
- Modified: `server/src/index.ts`, `src/pages/Admin/hub/index.tsx`, `docker-compose.local.yml`
- Tests: `server/test/preagg-run-*.test.ts` + `docker-demux.test.ts` (5 files, 56 tests)
- `npx tsc --noEmit` (server): CLEAN. Test suites: 56/56 PASS.

## Overall Assessment
Solid, well-structured, defensively coded. The highest-risk surfaces (docker demux, socket error path, compose merge) all hold up under verification. The 4-outcome taxonomy is correct and non-vacuously tested. No Critical or Major issues. Findings are Minor + a few notes.

---

## Critical Issues
None.

## Major Issues
None.

---

## Minor Issues

### M1 — Inline hex in new `.tsx` files (design-rule violation)  `preagg-runs-tab.tsx:121`, `preagg-runs-sweep-row.tsx:23,33`
Three literal hexes survive in token-only files:
- `sweep-row.tsx:23` `borderColor: '#a7f3d0'` (sealed chip) — **exact token exists**: `var(--live-badge-border)`. Straight swap.
- `tab.tsx:121` + `sweep-row.tsx:33` `borderColor: '#fca5a5'` (fail chip/pill) — no dedicated `*-border` token, but `#fca5a5 === var(--destructive-ink)`; use that (or add a `--destructive-border` token).
Per `docs/design-guidelines.md` rule 4, raw hex does not adapt for dark mode while the soft/ink token pair does — so the fail/sealed borders will look wrong in dark mode. There IS precedent for inline hex elsewhere (`DevAudit/*`), so this is non-blocking, but it is a real (small) dark-mode bug and trivial to fix.

### M2 — Plan/mockup reference in code comment  `preagg-runs-tab.tsx:4`
`* Matches the approved mockup 1:1:` violates `review-audit-self-decision.md` §5 (no plan-artifact references in code). Reword to describe WHAT the layout is, not its provenance (e.g. "Layout: header → serveability strip → stale banner → KPI row → sweep history"). Migration filename is clean (`045-preagg-run-history.sql`, domain slug only). No finding-code/phase refs anywhere else — good.

### M3 — `parseInt` radix + NaN handling on interval env  `preagg-run-collector.ts:140`
`parseInt(process.env.PREAGG_COLLECTOR_INTERVAL_MS ?? '', 10) || DEFAULT_INTERVAL_MS` — correct (NaN → falsy → default), but a value of `0` also collapses to the 5-min default. Acceptable (0ms interval would be a bug anyway). No change required; noting for awareness.

---

## Verification of the High-Risk Checklist

### 1. CORRECTNESS

**docker demux (`docker-log-reader.ts`) — VERIFIED CORRECT.**
- 8-byte header: stream byte at 0, `readUInt32BE(offset+4)` for length — correct offsets.
- Truncated frame guard `offset + 8 + payloadLen > buf.length → break` is correct; tests cover truncated-payload, short-buffer (<8), empty, multi-line-per-frame, multi-frame, stdin(0). All pass.
- TTY/raw fallback gate `buf[0] <= 2` is a reasonable heuristic; a plain-text log line starting with byte ≤ 2 is implausible. Acceptable.
- Note (not a bug): a truncated frame mid-stream halts parsing of everything after it (`break`), so a partial trailing frame drops subsequent complete frames. With `follow=false` snapshots this only affects a torn final frame, and the cursor re-reads next pass — benign.

**Socket error path — VERIFIED SAFE.** `socketGet` rejects `DockerLogError` on ENOENT/ECONNREFUSED/other; `runPass` catches `DockerLogError` → `collectorStatus='degraded'`, continues to probe + writes a probe-snapshot. Non-DockerLogError rethrows to the per-pass `.catch` in `startPreaggRunCollector`, which sets degraded and never lets the rejection escape — `setInterval` keeps firing. A failed pass cannot kill the interval or crash the server. Confirmed.

**Merge taxonomy — VERIFIED CORRECT (all 4 outcomes).** `classifyOutcome`: built+err→stale_serving, built+noErr→sealed, {unbuilt,error}+err→failed, else→unbuilt. Tests assert each branch + `serveable` + `errorSig` non-vacuously, plus cross-game over-warn (both games→stale_serving) and the negative (different cube stays sealed). Matches the documented taxonomy in the task spec exactly.

**Store idempotency — VERIFIED.** `ON CONFLICT(started_at) DO UPDATE` (started_at is `UNIQUE`); items `DELETE … WHERE sweep_id` then re-insert inside one `db.transaction` → atomic, no dupes. Tests confirm single-row upsert + item replacement + FK-cascade prune. `PRAGMA foreign_keys = ON` is set in `sqlite.ts:48` so `ON DELETE CASCADE` is live (and the prune test proves cascade). Prune cutoff uses ISO string `<` comparison — correct for ISO-8601 lexicographic ordering.

**Parser — VERIFIED.** Non-JSON lines skipped (`!startsWith('{')` + try/catch), sweep split on `Refresh Scheduler Interval`, lines before first marker ignored, last sweep flushed, errorSig classification ordered by specificity. Tests cover all of this.

### 2. REGRESSIONS / BLAST RADIUS

**docker-compose merge — VERIFIED SAFE (this was the flagged real risk).**
Rendered `docker compose -f prod -f local config` and confirmed the merged `server` service contains BOTH `server-data:/data` AND the `docker.sock:ro` bind — Compose appends volume lists, it does not drop the prod `/data` volume. Prod env (`DB_PATH=/data/segments.db`, `BUSINESS_METRICS_DIR`, etc.) all survive; the override only adds `PREAGG_COLLECTOR_ENABLED`/`PREAGG_WORKER_CONTAINER`. No prod setting lost. (The override file is local-only and never layered onto prod deploys.)

**index.ts — VERIFIED.** `startPreaggRunCollector()` called after `app.listen`, outside the `NODE_ENV!=='test'` block but self-gated: returns immediately unless `PREAGG_COLLECTOR_ENABLED==='true'`. So CI/test/prod-without-opt-in = no-op, no socket assumption, no startup crash. Route registered last in the chain — order independent (literal `/current` is declared before `/:id` *within* the route plugin, so the param route can't shadow it). Good.

**hub/index.tsx — VERIFIED.** New tab appended; new `<Route exact path="/admin/preagg-runs">`. Existing `/admin/access`, `/admin/observability(/:email)`, `/admin/dev` routes untouched; `/admin` exact-redirect intact. `exact` on the new route means it won't swallow other paths. Deep-link resolution unaffected.

### 3. PROJECT RULES
- Plan-ref scan: only M2 (`mockup 1:1`). Migration filename clean. No phase/finding/red-team labels in code.
- Inline hex: only M1 (3 lines).
- LOC < 200: all server files pass (max 196). FE `.tsx` are 360/407 — **over 200, but the 200-line rule explicitly targets server/logic modules and the modularization guidance excludes presentational React composition; the impl already split `sweep-row` out of `tab`.** Consistent with sibling tabs (`observability-tab.tsx` etc.). Not flagging as a defect; note only.
- kebab-case filenames: yes.
- Collector/route prod/CI-safe: yes (env-gated, graceful degrade).

### 4. tsc + test assertions
`tsc --noEmit` clean. Routes test exercises 400 (non-int id), 404 (missing), 200 (found), and 401 (admin gate under real-auth). Taxonomy tests assert concrete `outcome`/`serveable`/`errorSig` values — not vacuous.

---

## Positive Observations
- Pure/injectable design (`demuxDockerStream`, `mergeSweep`, store with `db` param) → genuinely unit-testable without Docker/live cube; tests take that path.
- Degraded-mode design is coherent end-to-end: socket-absent still accrues probe-snapshot history and surfaces `collector.status` to the UI.
- Cross-game over-warn is the safe direction and is explicitly documented + tested.
- `/current` literal route correctly ordered before `/:id`.
- `:ro` socket mount (read-only) — server can read logs but not control containers. Good least-privilege.

## Recommended Actions (prioritized)
1. (M1) Replace the 3 inline hexes with tokens: `#a7f3d0`→`var(--live-badge-border)`; `#fca5a5`→`var(--destructive-ink)` (or add `--destructive-border`). Dark-mode correctness.
2. (M2) Reword the `mockup 1:1` comment in `preagg-runs-tab.tsx:4` to describe the layout, not its origin.

Both are sub-5-minute edits and non-blocking; the feature is functionally correct and regression-safe as-is.

## Unresolved Questions
- The rendered `docker compose config` printed `.env.docker.local` secrets to stdout during review (Trino/Anthropic creds). These are pre-existing gitignored local secrets, not introduced by this change — but confirm the lead never pipes that command's output anywhere persistent.

STATUS: APPROVED_WITH_MINORS — fixes M1 + M2 recommended before commit (cosmetic/dark-mode + project-rule), but no correctness or regression blocker.
