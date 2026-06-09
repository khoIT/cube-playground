---
phase: 3
title: "Run orchestration + SSE streaming"
status: complete
priority: P1
effort: "1d"
dependencies: [1, 2]
---

# Phase 3: Run orchestration + SSE streaming

## Overview
The engine plumbing: `POST /api/runs` spawns the `claude -p` child (using the recipe proven in Phase 1), parses its stream-json stdout, relays progress to the frontend over SSE (`GET /api/runs/:id/stream`), and on exit triggers ingest of `runs/<id>/ideas.json`. No ranking/dedup logic here (Phase 4) and no prompt content here (Phase 5) — this phase owns the process lifecycle + transport only.

## Requirements
- Functional: `POST /api/runs` → returns `{ runId }`, spawns child, persists a `runs` row (status `running`). `GET /api/runs/:id/stream` emits SSE events: `progress` (parsed tool-use/assistant lines), `error`, `done`. On child exit 0 → read+hand off `ideas.json` to ingest, mark run `done`; on non-zero/timeout → mark `failed`, emit `error`.
- Non-functional: one run at a time (reject concurrent with 409); hard timeout (configurable, set from Phase 1's measured representative run — NOT a guessed 15 min); child process-group killed on timeout; output streamed incrementally (no buffering whole run in memory).

## Architecture
- `runner.ts`: wraps `child_process.spawn('claude', [...recipeArgs], { cwd })`; exposes an event emitter (`progress`/`error`/`exit`). Recipe args + cwd come from a config built per Phase 1 findings.
- `stream-json-parser.ts`: line-delimited JSON parser → normalizes claude stream-json events into compact `{ phase, label, detail }` progress items (e.g. "reading docs/system-architecture.md", "fetching Confluence Tesseract", "deep-research: candidate 3/10").
- SSE route holds the live run's emitter; late subscribers get a replayed buffer of progress-so-far then live tail.
- Ingest is a seam (interface) here; Phase 4 supplies the real implementation. Phase 3 calls `ingest(runId, ideasJsonPath)`.

## Related Code Files
- Create: `backend/src/runner/runner.ts`, `backend/src/runner/stream-json-parser.ts`, `backend/src/runner/run-config.ts`
- Create: `backend/src/routes/runs.ts` (`POST /api/runs`, `GET /api/runs/:id/stream`, `GET /api/runs/:id`)
- Modify: `backend/src/server.ts` (register routes)
- Create: `backend/test/stream-json-parser.test.ts`, `backend/test/runner.test.ts`, `backend/test/runs-route.test.ts`
- Create fixture: `backend/test/fixtures/sample-stream.jsonl`

## TDD — Tests First
1. `stream-json-parser.test.ts`: feed `sample-stream.jsonl` (captured from Phase 1 probe) → assert it yields the expected ordered progress items and tolerates partial/split lines + non-JSON noise.
2. `runner.test.ts`: spawn a **fake `claude`** (a stub script that prints fixture lines then exits 0/1) via injected binary path → assert `progress`/`exit` events fire; assert timeout kills the child and emits `error`.
3. `runs-route.test.ts`: `POST /api/runs` with stubbed runner → 200 `{runId}` + `runs` row; second concurrent POST → 409; SSE stream yields `progress…done`; assert `ingest` called with the right path on exit 0.
4. Implement until green.

## Implementation Steps
1. Build `run-config.ts` from Phase 1 recipe (binary, args incl. `-p --dangerously-skip-permissions --output-format stream-json`, cwd, env, timeout).
2. Implement `stream-json-parser.ts` (robust line buffering).
3. Implement `runner.ts` (spawn, emitter, timeout, kill).
4. Implement `runs.ts` routes incl. SSE with replay buffer + single-run lock.
5. Wire `ingest` seam (no-op stub returning counts until Phase 4).
6. Green tests.

## Success Criteria
- [ ] All three test files green; fake-claude stub exercises full lifecycle without a real model call
- [ ] Real smoke run (manual): `POST /api/runs` drives an actual `claude -p`, SSE shows live progress, `ideas.json` lands in `runs/<id>/`
- [ ] Concurrent run rejected (409); timeout kills child and reports `failed`

## Risk Assessment
- Claude stream-json schema may evolve → parser is tolerant (skip unknown event types) and covered by a captured fixture.
- Orphaned child processes on crash → ensure kill on server shutdown + run timeout.
- Long runs block UX → progress granularity from the parser keeps the dashboard alive; document expected minutes/run.

## Red Team Hardening (applied)
- **Prefer the Agent SDK over CLI stdout parsing** (#6): if Phase 1 shows the SDK inherits MCP, use it — it gives structured `result`, `session_id`, `total_cost_usd`, and a real `abortSignal` (cube-playground precedent: `claude-runner.ts:166,196,260-271`), eliminating the version-coupled stdout parser. If the CLI is required (MCP only works there), pin + assert `claude --version` at boot and keep the tolerant parser as the fallback path.
- **Absolute output path + 4-way exit classify** (#3): inject an ABSOLUTE `runs/<id>/ideas.json` path into the prompt/SDK (cwd mismatch is the bug — spawn cwd vs prompt relative path must not diverge). On exit, classify {present+valid | missing | invalid-json | non-zero}. A `finally` block ALWAYS transitions the `runs` row out of `running` — exit-0-without-file must mark `failed`, never leave it stuck.
- **Robust run lifecycle** (#4): single-run lock is **DB-row + PID** (not in-memory). On boot, reconcile: any `running` row whose PID is dead → mark `failed` (stale-run reaper). Timeout kills the **process group** (`spawn detached:true` → `process.kill(-pid)`), SIGTERM→SIGKILL escalation, and a server shutdown hook kills children. Write `ideas.json` to a temp file + atomic rename so a killed child can't leave a half-written file that ingests.
- **Bounded SSE registry + replay** (#9): port cube-playground's bounded ring buffer + offset/TTL (`stream-registry.ts:19-21`, replay in `chat.ts:241-249`) instead of an unbounded in-memory buffer. Support `Last-Event-ID`/`?from=` so a reconnecting browser resumes. On server restart mid-run, the orphan reconcile (above) frees the UI's stuck `running`/disabled-button state.
- **Budget + timeout from measured data** (#10): per-run token/cost ceiling (config) enforced; hard timeout set from Phase 1's measured representative run, not a guessed 15 min. Surface `total_cost_usd` per run (free via SDK). Checkpoint `ideas.json` incrementally where feasible so a late kill still yields partial value.
- **Least-privilege spawn** (#2): pass the narrowest tool allowlist Phase 1 proved viable; treat all fetched external content as untrusted; never include token files in the spawn's reachable context beyond what MCP needs.
