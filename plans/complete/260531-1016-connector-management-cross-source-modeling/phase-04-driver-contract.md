# Phase D — registry → driver + secret-resolution contract (step 1 deliverable)

Status: **spec complete; cube-dev PR + driver-dep + deploy work pending explicit go-ahead.**

Phase D turns *saved* non-Trino connectors into *served* ones. Steps 2–6 modify the
**deployed sibling repo `cube-dev`** and add a runtime DB-driver dependency to the
playground — outward-facing + hard-to-reverse, so they are gated on an explicit decision.
This file is the written contract those steps implement (phase-04 step 1).

## What already exists (no change needed)
- `datasource-registry-writer.ts` emits a **secret-free** `datasources.config.json`:
  `{ dataSources: [{ id, sourceType, driverType, workspaceId, config, secretRef }] }`.
  `sanitize()` strips any `pass|secret|key|token|credential` key — the file is config-only.
- `connector-secret-vault.ts` seals/opens secrets with `CONNECTOR_SECRET_KEY` (AES-256-GCM).
- Each cube the onboarding writer stamps carries `data_source: <connectorId>` (Trino default unstamped).
- `cube-dev/cube/cube.js` today: a single Trino `driverFactory: ({ securityContext }) => ({…})`
  keyed only by game schema (`GAME_SCHEMA[gameFor(securityContext)]`).

## Contract: registry entry → driver
cube.js must generalize `driverFactory` to `({ securityContext, dataSource }) => Driver`:

1. `dataSource === undefined` (or `'default'`) → **existing Trino path, unchanged**
   (per-tenant schema swap via `GAME_SCHEMA`). This preserves every committed cube.
2. otherwise → look up the registry entry with `id === dataSource` in
   `datasources.config.json` (path via env, e.g. `DATASOURCES_CONFIG_PATH`):
   - build the driver for `entry.driverType` from `entry.config` (non-secret coordinates);
   - resolve the secret from the **operator secret export keyed by `entry.secretRef`**
     (env map / mounted vault export) — **NEVER** from the config file;
   - unknown `dataSource` → throw a clear error (fail closed, do not fall back to Trino).

## Contract: secret resolution (the deploy boundary)
- The playground **writes config only**; the operator **supplies secrets**.
- Delivery options (pick one in the PR): (a) env map `DS_SECRET_<secretRef>`; or
  (b) a mounted secret-export file `{ [secretRef]: secret }` read at boot, path via env.
- Rotation = re-run the secret export; config file is untouched (secretRef is stable).

## Contract: playground non-Trino runner
- Implement ONE concrete SQL driver runner behind `profiler-interface.ts` (ClickHouse or
  Postgres), replacing the `ProfilerUnavailableError('DRIVER_NOT_WIRED')` 501 for that type.
- Lazy-load the driver dependency per type so the dependency-free build isn't broadened
  for sources nobody provisioned.
- Flip `connector-provisioning.liveTested` to `true` for the now-served type(s); update the
  UI degraded note accordingly.

## Backward-compat invariants (regression gates for the PR)
- Trino queries byte-identical after generalization (default `dataSource`, per-game schema).
- A committed cube with no `data_source` still resolves to Trino.
- `datasources.config.json` stays secret-free (assert in a test).
- Adding another SQL source = a registry entry + (if a new driver) a lazy runner, **no cube.js edit**.

## Why this is gated (not auto-applied)
- Edits a **deployed sibling repo** (`cube-dev`) — a separate deploy surface.
- Adds a **runtime driver dependency** to a deliberately dependency-light build.
- Introduces a **secret-export deploy step** that must match the target environment.

## Open questions (for the go-ahead)
1. Which non-Trino driver to wire first — ClickHouse or Postgres (AppsFlyer-in-Postgres)?
2. Secret-delivery mechanism — env map vs mounted export file?
3. Does the cube-dev PR land in the same release as A–C, or a follow-up tag?
