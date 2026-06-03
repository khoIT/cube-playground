---
phase: 2
title: "Repo scaffold + backend skeleton"
status: pending
priority: P1
effort: "0.5d"
dependencies: [1]
---

# Phase 2: Repo scaffold + backend skeleton

## Overview
Create the `../cube-advisor` sibling repo and a runnable Fastify backend (`:5181`) with SQLite (better-sqlite3) schema/migrations and a health endpoint. No business logic yet — just a booting, tested skeleton both later phases build on.

## Requirements
- Functional: `npm run dev` boots Fastify on `:5181`; `GET /api/health` returns `{ ok: true }`; SQLite DB initializes with `ideas`, `runs`, `idea_status_log` tables on first boot (idempotent).
- Non-functional: TS strict; mirrors cube-playground conventions (Fastify + better-sqlite3); env via `.env` (paths to cube-playground/cube-dev, ports).

## Architecture
- Monorepo-lite layout in `../cube-advisor`: `backend/` (Fastify), `frontend/` (Vite — scaffolded empty here, filled Phase 6), `prompts/`, `spikes/`, root `package.json` with workspace scripts.
- DB module: single better-sqlite3 connection, migrations as ordered SQL applied on boot (`PRAGMA user_version`).
- Tables (final shape used by Phase 4): `runs(id, started_at, finished_at, status, candidate_count)`, `ideas(id, run_first, run_last, category, title, one_liner, problem, proposal, impact, effort, confidence, status, fingerprint, dedup_verdict, payload_json, created_at, updated_at)`, `idea_status_log(id, idea_id, from_status, to_status, at)`.

## Related Code Files
- Create: `../cube-advisor/package.json`, `tsconfig.json`, `.env.example`, `.gitignore`, `README.md`
- Create: `../cube-advisor/backend/src/server.ts` (Fastify bootstrap + health route)
- Create: `../cube-advisor/backend/src/db/connection.ts`, `backend/src/db/migrations.ts`
- Create: `../cube-advisor/backend/test/server-boot.test.ts`, `backend/test/migrations.test.ts`

## TDD — Tests First
1. `migrations.test.ts`: run migrations on a temp DB → assert all three tables + indexes exist, and re-running is a no-op (idempotent).
2. `server-boot.test.ts`: build the Fastify app, inject `GET /api/health` → assert 200 `{ ok: true }`; inject unknown route → 404.
3. Implement until green.

## Implementation Steps
1. `git init ../cube-advisor`; add root `package.json` (workspaces or simple prefix scripts mirroring cube-playground's style), TS strict `tsconfig`, vitest config.
2. Implement `db/connection.ts` + `db/migrations.ts` (user_version-gated).
3. Implement `server.ts` with health route + DB init on boot.
4. `.env.example`: `PORT=5181`, `CUBE_PLAYGROUND_DIR=../cube-playground`, `CUBE_DEV_DIR=../cube-dev`, `DB_PATH=./data/advisor.db`.
5. Make tests green; confirm `npm run dev` boots.

## Success Criteria
- [ ] `migrations.test.ts` + `server-boot.test.ts` green
- [ ] `npm run dev` boots Fastify on :5181; `/api/health` returns ok
- [ ] DB file created with all tables; second boot doesn't error
- [ ] `.gitignore` excludes `data/`, `.env`, `runs/`, `node_modules/`

## Risk Assessment
- better-sqlite3 native build issues on the host → pin a known-good version (match cube-playground's); document `npm i` notes in README.
- Keep schema aligned with Phase 4's idea object now to avoid a migration churn later.

## Red Team Hardening (applied)
- **Loopback-only bind + shared secret** (#1): bind Fastify to `127.0.0.1` (NOT `0.0.0.0` — cube-playground binds `0.0.0.0` at `server/src/index.ts:195`; do NOT copy that). Require a shared-secret header (`ADVISOR_TOKEN` from `.env`) on all mutating routes (`POST /api/runs`, `PATCH`, handoff). **No reflective CORS** (cube-playground uses `cors {origin:true}` at `server/src/index.ts:68` — do not copy); restrict to the local frontend origin. Rationale: `POST /api/runs` triggers a privileged agent spawn — it must not be reachable unauthenticated or from the LAN.
- **Single package** (#A4/#SC6): root `package.json` serves both backend and the built frontend (Fastify static) — no separate frontend package. Shared schema lives at `src/shared/idea-schema.ts`, imported by backend and (via Vite path alias) frontend. Delete any "copied .d.ts" notion.
- **Schema columns final now** (#5): `ideas` table uses snake_case columns `run_first, run_last, status, first_seen_run, last_seen_run, dedup_verdict`; the canonical zod schema (Phase 4) is camelCase; a single explicit DTO↔column mapping layer lives in `repo.ts`. Index `fingerprint` (#7) for dedup lookups.
- **Boot-time exposure guard** (#6/S6): on boot, assert `data/`, `runs/`, `.env` are git-ignored (fail loud if a sensitive path is tracked) — email/Confluence content persists here. `.gitignore` correctness is verified by a test, not assumed.
- **Event-loop monitor** (#7): port cube-playground's `startEventLoopMonitor` pattern (`chat-service/src/index.ts:127`) so sync better-sqlite3 work during SSE is observable.
