/**
 * Onboarding agent HTTP surface: introspect → generate draft → list/accept/
 * reject (RBAC-gated) → validate → approve-and-write into cube-dev.
 *
 * Mutations live under `/api/onboarding/*` and inherit the global
 * `enforce-write-roles` gate (viewer → 403). Routes that take `game` from the
 * query/body re-check `userCanAccessGame` explicitly — the upstream game gate
 * keys off the `x-cube-game` header, which these requests don't send.
 *
 * Approval gate: generator ≠ approver in prod (`403 SELF_APPROVE_FORBIDDEN`);
 * self-approve allowed only when NODE_ENV=dev/development.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { listConnectors, getConnector, schemaForGame, isProfilerConfigured } from '../services/trino-profiler-config.js';
import { getProfiler, ProfilerUnavailableError } from '../services/profiler-interface.js';
import { listSourceTypes } from '../services/source-type-registry.js';
import { readExistingModel } from '../services/existing-model-reader.js';
import { testConnection, provisionConnector } from '../services/connector-provisioning.js';
import { HostNotAllowedError } from '../services/connector-host-guard.js';
import { inferSchema } from '../services/raw-schema-inference.js';
import { scaffoldCubeModel, toYaml } from '../services/cube-model-scaffolder.js';
import {
  upsertDraft,
  listDrafts,
  getDraft,
  setDraftStatus,
  listDraftAudit,
} from '../services/onboarding-draft-store.js';
import { writeCubeModel, CubeModelWriteError } from '../services/cube-model-writer.js';
import { enrichCube, isEnrichmentEnabled } from '../services/cube-model-enrichment.js';
import { getGoldenIndex, memberSeenCount } from '../services/golden-query-seeder.js';
import { getSetting } from '../services/app-settings-store.js';
import { loadWithCtx } from '../services/cube-client.js';
import { userCanAccessGame } from '../auth/authz-decisions.js';
import type { TableProfile, OnboardingMode } from '../types/raw-schema.js';

function gameForbidden(req: FastifyRequest, game: string): boolean {
  // Game comes from query/body here, so the header-keyed upstream gate never
  // fired. Re-check; skip in AUTH_DISABLED dev (no req.user).
  return !!req.user && !userCanAccessGame(req.user, game);
}

function isDev(): boolean {
  return process.env.NODE_ENV !== 'production';
}

function actorOf(req: FastifyRequest): string | null {
  return req.user?.email ?? req.owner ?? null;
}

const GenerateBody = z.object({
  connectorId: z.string().optional(),
  game: z.string().min(1),
  schema: z.string().optional(),
  tables: z.array(z.string().min(1)).min(1),
  mode: z.enum(['cold', 'warm']).default('cold'),
});

const StatusBody = z.object({ reason: z.string().max(2000).optional() });

const TestConnectorBody = z.object({
  sourceType: z.string().min(1),
  fields: z.record(z.unknown()).default({}),
});

const CreateConnectorBody = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/i, 'id must be a slug').optional(),
  label: z.string().min(1).max(120),
  sourceType: z.string().min(1),
  workspaceId: z.string().min(1).default('local'),
  fields: z.record(z.unknown()).default({}),
});

/** Derive a slug connector id from a label when one isn't supplied. */
function slugifyId(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 63) || 'connector'
  );
}

export default async function onboardingRoutes(app: FastifyInstance): Promise<void> {
  // ── Connectors (secret-free) ───────────────────────────────────────────────
  app.get('/api/onboarding/connectors', async () => ({
    configured: isProfilerConfigured(),
    connectors: listConnectors(),
  }));

  // Source-type catalog (field schemas + caps) that drives the dynamic connect
  // form + server validation. Secret-free by construction.
  app.get('/api/onboarding/source-types', async () => ({ sourceTypes: listSourceTypes() }));

  // Existing committed cube-dev model for a game — the read-only worked example.
  // Authoring view (YAML on disk), not the compiled /meta view.
  app.get<{ Querystring: { game?: string } }>(
    '/api/onboarding/example-model',
    async (req, reply) => {
      const game = req.query.game;
      if (!game) {
        return reply.status(400).send({ error: { code: 'GAME_REQUIRED', message: 'game is required' } });
      }
      if (gameForbidden(req, game)) {
        return reply.status(403).send({ error: { code: 'GAME_FORBIDDEN', message: `game "${game}" not granted` } });
      }
      return readExistingModel(game);
    },
  );

  // ── Test a connection (validate + SSRF guard + bounded live probe) ──────────
  // POST (a write-role action) but non-mutating; returns a redacted result.
  app.post('/api/onboarding/connectors/test', async (req, reply) => {
    const parsed = TestConnectorBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: parsed.error.message } });
    }
    const result = await testConnection(parsed.data.sourceType, parsed.data.fields);
    return result; // { ok, latencyMs? } | { ok:false, code, message } — never leaks secrets
  });

  // ── Provision a connector (persist + dataSource registry entry) ─────────────
  app.post('/api/onboarding/connectors', async (req, reply) => {
    const parsed = CreateConnectorBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: parsed.error.message } });
    }
    const { label, sourceType, workspaceId, fields } = parsed.data;
    const id = parsed.data.id ?? slugifyId(label);
    try {
      const result = await provisionConnector({ id, label, sourceType, workspaceId, fields, createdBy: actorOf(req) });
      return reply.status(201).send({
        connector: listConnectors().find((c) => c.id === id) ?? null,
        liveTested: result.liveTested,
        note: result.note,
      });
    } catch (err) {
      if (err instanceof HostNotAllowedError) {
        return reply.status(400).send({ error: { code: 'HOST_NOT_ALLOWED', message: err.message } });
      }
      const message = (err as Error).message;
      if (message.startsWith('VALIDATION:')) {
        return reply.status(400).send({ error: { code: 'VALIDATION', message: message.slice('VALIDATION:'.length).trim() } });
      }
      return reply.status(500).send({ error: { code: 'PROVISION_FAILED', message } });
    }
  });

  // ── Introspect: list tables for a connector + schema (or game→schema) ───────
  app.get<{ Querystring: { connectorId?: string; schema?: string; game?: string } }>(
    '/api/onboarding/introspect',
    async (req, reply) => {
      const { connectorId, game } = req.query;
      if (game && gameForbidden(req, game)) {
        return reply.status(403).send({ error: { code: 'GAME_FORBIDDEN', message: `game "${game}" not granted` } });
      }
      const connector = getConnector(connectorId);
      if (!connector) {
        return reply.status(503).send({ error: { code: 'PROFILER_NOT_CONFIGURED', message: 'no Trino connector configured' } });
      }
      const schema = req.query.schema ?? (game ? schemaForGame(game) : null);
      if (!schema) {
        return reply.status(400).send({ error: { code: 'SCHEMA_REQUIRED', message: 'schema or a mapped game is required' } });
      }
      try {
        const tables = await getProfiler(connector).listTables(connector, schema);
        return { connectorId: connector.id, schema, tables };
      } catch (err) {
        if (err instanceof ProfilerUnavailableError) {
          return reply.status(501).send({ error: { code: err.code, message: err.message } });
        }
        return reply.status(502).send({ error: { code: 'INTROSPECT_FAILED', message: (err as Error).message } });
      }
    },
  );

  // ── Generate: profile selected tables → infer → scaffold → stage drafts ─────
  app.post('/api/onboarding/generate', async (req, reply) => {
    const parsed = GenerateBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: parsed.error.message } });
    }
    const { connectorId, game, tables, mode } = parsed.data;
    if (gameForbidden(req, game)) {
      return reply.status(403).send({ error: { code: 'GAME_FORBIDDEN', message: `game "${game}" not granted` } });
    }
    const connector = getConnector(connectorId);
    if (!connector) {
      return reply.status(503).send({ error: { code: 'PROFILER_NOT_CONFIGURED', message: 'no Trino connector configured' } });
    }
    const schema = parsed.data.schema ?? schemaForGame(game);
    if (!schema) {
      return reply.status(400).send({ error: { code: 'SCHEMA_REQUIRED', message: 'schema or a mapped game is required' } });
    }

    let profiles: TableProfile[];
    try {
      const profiler = getProfiler(connector);
      profiles = await Promise.all(tables.map((t) => profiler.profileTable(connector, schema, t)));
    } catch (err) {
      if (err instanceof ProfilerUnavailableError) {
        return reply.status(501).send({ error: { code: err.code, message: err.message } });
      }
      return reply.status(502).send({ error: { code: 'PROFILE_FAILED', message: (err as Error).message } });
    }

    const actor = actorOf(req);
    const taken = new Set(listDrafts({ game }).map((d) => d.cubeName));
    const out = [];
    // Stamp the cube's dataSource so multiple connectors co-exist in one model.
    // The default Trino source stays unstamped (legacy cube behavior).
    const dataSource = connector.sourceType === 'trino' ? undefined : connector.id;
    // One cube per table — infer each in the context of the full dataset (so
    // cross-table joins resolve) but stage one draft per cube for triage.
    const fullInference = inferSchema(profiles, mode as OnboardingMode);
    for (const cube of fullInference.cubes) {
      const single = { ...fullInference, cubes: [cube] };
      const { model, cubeName } = scaffoldCubeModel(single, taken, dataSource);
      taken.add(cubeName);
      const draft = upsertDraft({
        game,
        connectorId: connector.id,
        schemaName: schema,
        cubeName,
        model,
        yaml: toYaml(model),
        profiles: profiles.filter((p) => p.table === cube.sqlTable),
        inference: single,
        source: mode as OnboardingMode,
        createdBy: actor,
      });
      out.push(draft);
    }
    return { drafts: out };
  });

  // ── List / get drafts ───────────────────────────────────────────────────────
  app.get<{ Querystring: { game?: string; status?: string } }>('/api/onboarding/drafts', async (req) => {
    const status = req.query.status as 'pending' | 'accepted' | 'rejected' | 'written' | undefined;
    return { drafts: listDrafts({ game: req.query.game, status }) };
  });

  app.get<{ Params: { id: string } }>('/api/onboarding/drafts/:id', async (req, reply) => {
    const draft = getDraft(Number(req.params.id));
    if (!draft) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'draft not found' } });
    return { draft, audit: listDraftAudit(draft.id) };
  });

  // ── Accept / reject (write-role gated by the global preHandler) ─────────────
  // These derive `game` from the draft row (not a header), so the header-keyed
  // upstream game gate never fired — re-check the grant before mutating, else an
  // editor with game-A grants could flip another game's draft state.
  async function transition(
    req: FastifyRequest,
    reply: import('fastify').FastifyReply,
    id: number,
    status: 'accepted' | 'rejected',
  ) {
    const existing = getDraft(id);
    if (!existing) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'draft not found' } });
    if (gameForbidden(req, existing.game)) {
      return reply.status(403).send({ error: { code: 'GAME_FORBIDDEN', message: `game "${existing.game}" not granted` } });
    }
    const body = StatusBody.safeParse(req.body ?? {});
    const draft = setDraftStatus(id, status, actorOf(req), { reason: body.success ? body.data.reason : undefined });
    return { draft };
  }

  app.post<{ Params: { id: string } }>('/api/onboarding/drafts/:id/accept', (req, reply) =>
    transition(req, reply, Number(req.params.id), 'accepted'),
  );
  app.post<{ Params: { id: string } }>('/api/onboarding/drafts/:id/reject', (req, reply) =>
    transition(req, reply, Number(req.params.id), 'rejected'),
  );

  // ── Validate: structural always; live /load count once written ──────────────
  app.post<{ Params: { id: string } }>('/api/onboarding/drafts/:id/validate', async (req, reply) => {
    const draft = getDraft(Number(req.params.id));
    if (!draft) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'draft not found' } });
    if (gameForbidden(req, draft.game)) {
      return reply.status(403).send({ error: { code: 'GAME_FORBIDDEN', message: `game "${draft.game}" not granted` } });
    }
    // Structural validity is guaranteed by the scaffolder's CubeModelSchema.parse,
    // so the draft persisted in the store is structurally valid by construction.
    const structural = { ok: true, cubes: draft.model.cubes.map((c) => c.name) };

    // Live validation only meaningful after the cube exists in /meta (post-write).
    if (draft.status !== 'written') {
      return { structural, live: null, note: 'live validation available after approval/write' };
    }
    try {
      const ctx = req.buildCubeCtxForGame(draft.game);
      const cube = draft.model.cubes[0];
      const result = (await loadWithCtx({ measures: [`${cube.name}.count`] }, ctx)) as { data?: unknown[] };
      return { structural, live: { ok: true, rowCount: result.data?.length ?? 0 } };
    } catch (err) {
      return { structural, live: { ok: false, error: (err as Error).message } };
    }
  });

  // ── Approve → write YAML into cube-dev → status 'written' ───────────────────
  app.post<{ Params: { id: string } }>('/api/onboarding/drafts/:id/approve', async (req, reply) => {
    const draft = getDraft(Number(req.params.id));
    if (!draft) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'draft not found' } });
    if (gameForbidden(req, draft.game)) {
      return reply.status(403).send({ error: { code: 'GAME_FORBIDDEN', message: `game "${draft.game}" not granted` } });
    }

    // Staging gate: only an accepted draft may be written. Without this the
    // pending→accept→approve flow collapses — a never-reviewed (or rejected)
    // draft could be POSTed straight to /approve and written to disk.
    if (draft.status !== 'accepted') {
      return reply.status(409).send({
        error: { code: 'INVALID_STATE', message: `draft must be 'accepted' to approve (is '${draft.status}')` },
      });
    }

    const approver = actorOf(req);
    // generator ≠ approver in prod; self-approve allowed only in dev.
    if (!isDev() && approver && draft.createdBy && approver === draft.createdBy) {
      return reply.status(403).send({
        error: { code: 'SELF_APPROVE_FORBIDDEN', message: 'the generator cannot approve their own draft' },
      });
    }

    const ctx = req.buildCubeCtxForGame(draft.game);
    try {
      const result = await writeCubeModel({
        game: draft.game,
        cubeName: draft.cubeName,
        yaml: draft.yaml,
        cubeApiUrl: ctx.cubeApiUrl,
        token: ctx.token,
        actor: approver,
      });
      const updated = setDraftStatus(draft.id, 'written', approver, { approvedBy: approver });
      return { draft: updated, written: result };
    } catch (err) {
      if (err instanceof CubeModelWriteError) {
        const status = err.code === 'write-disabled-in-production' ? 403 : err.code === 'model-dir-not-configured' ? 500 : 502;
        return reply.status(status).send({ error: { code: err.code.toUpperCase().replace(/-/g, '_'), message: err.message } });
      }
      return reply.status(500).send({ error: { code: 'WRITE_FAILED', message: (err as Error).message } });
    }
  });

  // ── Phase 07: LLM enrichment (flag-gated, suggestions only) ─────────────────
  app.post<{ Params: { id: string } }>('/api/onboarding/drafts/:id/enrich', async (req, reply) => {
    const draft = getDraft(Number(req.params.id));
    if (!draft) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'draft not found' } });
    if (gameForbidden(req, draft.game)) {
      return reply.status(403).send({ error: { code: 'GAME_FORBIDDEN', message: `game "${draft.game}" not granted` } });
    }
    if (!isEnrichmentEnabled()) {
      return { enabled: false, suggestions: [] };
    }
    const cube = draft.inference?.cubes[0];
    if (!cube) return { enabled: true, suggestions: [] };
    const suggestions = await enrichCube(cube);
    return { enabled: true, suggestions };
  });

  // ── Phase 07: golden-query seeding — "seen in N real queries" badges ────────
  app.get<{ Params: { id: string } }>('/api/onboarding/drafts/:id/golden', async (req, reply) => {
    const draft = getDraft(Number(req.params.id));
    if (!draft) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'draft not found' } });
    if (gameForbidden(req, draft.game)) {
      return reply.status(403).send({ error: { code: 'GAME_FORBIDDEN', message: `game "${draft.game}" not granted` } });
    }
    if (getSetting<boolean>('onboarding.goldenSeeding', false) !== true) {
      return { enabled: false, members: {}, totalQueries: 0 };
    }
    const index = getGoldenIndex();
    const cube = draft.model.cubes[0];
    const members: Record<string, number> = {};
    for (const d of cube.dimensions) members[d.name] = memberSeenCount(d.name, index);
    for (const m of cube.measures) members[m.name] = memberSeenCount(m.name, index);
    return { enabled: true, members, totalQueries: index.totalQueries };
  });
}
