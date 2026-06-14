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

import {
  listConnectors,
  getConnector,
  schemaForGame,
  isProfilerConfigured,
  WORKED_EXAMPLE_CONNECTOR_ID,
} from '../services/trino-profiler-config.js';
import { CUBE_RELATIONSHIPS } from '../types/cube-model.js';
import { getProfiler, ProfilerUnavailableError } from '../services/profiler-interface.js';
import { listSourceTypes } from '../services/source-type-registry.js';
import { readExistingModel } from '../services/existing-model-reader.js';
import { testConnection, provisionConnector, updateConnectorProfile } from '../services/connector-provisioning.js';
import { getConnectorMeta, disableConnector, listConnectorAudit } from '../services/connector-store.js';
import { crossSourceVerdict } from '../services/cross-source-advisor.js';
import {
  createCrossSourceLink,
  listCrossSourceLinks,
  disableCrossSourceLink,
} from '../services/cross-source-link-store.js';
import { HostNotAllowedError } from '../services/connector-host-guard.js';
import { inferSchema } from '../services/raw-schema-inference.js';
import { scaffoldCubeModel, addCrossGameJoin, toYaml } from '../services/cube-model-scaffolder.js';
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
  // fired. Re-check against the workspace this request targets (req.workspace,
  // set upstream by workspace-header). Skip in AUTH_DISABLED dev (no req.user).
  return !!req.user && !userCanAccessGame(req.user, req.workspace.id, game);
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

const COLUMN_RE = /^[a-z_][a-z0-9_]*$/i;
const CrossGameJoinBody = z.object({
  draftId: z.number().int().positive(),
  targetGame: z.string().min(1),
  targetCube: z.string().min(1),
  fromColumn: z.string().regex(COLUMN_RE, 'fromColumn must be a bare column identifier'),
  toColumn: z.string().regex(COLUMN_RE, 'toColumn must be a bare column identifier'),
  relationship: z.enum(CUBE_RELATIONSHIPS),
});

const TestConnectorBody = z.object({
  sourceType: z.string().min(1),
  fields: z.record(z.string(), z.unknown()).default({}),
});

const CreateConnectorBody = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/i, 'id must be a slug').optional(),
  label: z.string().min(1).max(120),
  sourceType: z.string().min(1),
  workspaceId: z.string().min(1).default('local'),
  fields: z.record(z.string(), z.unknown()).default({}),
});

const UpdateConnectorBody = z.object({
  label: z.string().min(1).max(120).optional(),
  fields: z.record(z.string(), z.unknown()).default({}),
});

/** Map a thrown provisioning error to a route reply (shared create/update). */
function sendProvisionError(reply: import('fastify').FastifyReply, err: unknown) {
  if (err instanceof HostNotAllowedError) {
    return reply.status(400).send({ error: { code: 'HOST_NOT_ALLOWED', message: err.message } });
  }
  const message = (err as Error).message;
  if (message.startsWith('VALIDATION:')) {
    return reply.status(400).send({ error: { code: 'VALIDATION', message: message.slice('VALIDATION:'.length).trim() } });
  }
  if (message.startsWith('NOT_FOUND:')) {
    return reply.status(404).send({ error: { code: 'NOT_FOUND', message: message.slice('NOT_FOUND:'.length).trim() } });
  }
  if (message.startsWith('READ_ONLY:')) {
    return reply.status(403).send({ error: { code: 'READ_ONLY', message: message.slice('READ_ONLY:'.length).trim() } });
  }
  return reply.status(500).send({ error: { code: 'PROVISION_FAILED', message } });
}

const CrossSourceLinkBody = z.object({
  leftCube: z.string().min(1),
  leftConnector: z.string().min(1),
  rightCube: z.string().min(1),
  rightConnector: z.string().min(1),
  key: z.object({ fromColumn: z.string().min(1), toColumn: z.string().min(1) }),
  relationship: z.enum(CUBE_RELATIONSHIPS),
  rationale: z.string().max(2000).optional(),
  workspaceId: z.string().min(1).default('local'),
});

/** Resolve a connector's source type from the public list (DB + bootstrap + example). */
function sourceTypeOf(connectorId: string): string | null {
  return listConnectors().find((c) => c.id === connectorId)?.sourceType ?? null;
}

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
      return sendProvisionError(reply, err);
    }
  });

  // ── Edit a connector (non-secret config + optional secret/label) ────────────
  // Body = { label?, fields }. The source type is taken from the stored row, so
  // an edit never switches a connector's driver. A blank secret field keeps the
  // existing sealed credential (no blank-overwrite). The read-only worked example
  // is refused. Write-role gated by the global preHandler.
  app.patch<{ Params: { id: string } }>('/api/onboarding/connectors/:id', async (req, reply) => {
    const { id } = req.params;
    if (id === WORKED_EXAMPLE_CONNECTOR_ID) {
      return reply.status(403).send({ error: { code: 'READ_ONLY', message: 'the worked-example connector is not editable' } });
    }
    const meta = getConnectorMeta(id);
    if (!meta || meta.status !== 'active') {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'connector not found' } });
    }
    const parsed = UpdateConnectorBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: parsed.error.message } });
    }
    try {
      const result = await updateConnectorProfile({
        id,
        label: parsed.data.label,
        sourceType: meta.sourceType,
        workspaceId: meta.workspaceId,
        fields: parsed.data.fields,
        actor: actorOf(req),
      });
      return {
        connector: listConnectors().find((c) => c.id === id) ?? null,
        liveTested: result.liveTested,
        note: result.note,
      };
    } catch (err) {
      return sendProvisionError(reply, err);
    }
  });

  // ── Disable (soft-delete) a connector — drops out of the list, keeps audit ──
  app.post<{ Params: { id: string } }>('/api/onboarding/connectors/:id/disable', async (req, reply) => {
    const { id } = req.params;
    if (id === WORKED_EXAMPLE_CONNECTOR_ID) {
      return reply.status(403).send({ error: { code: 'READ_ONLY', message: 'the worked-example connector cannot be disabled' } });
    }
    const ok = disableConnector(id, actorOf(req));
    if (!ok) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'connector not found or already disabled' } });
    }
    return { disabled: true, id };
  });

  // ── Connector lifecycle audit (create/update/disable/test) ──────────────────
  app.get<{ Params: { id: string } }>('/api/onboarding/connectors/:id/audit', async (req) => ({
    audit: listConnectorAudit(req.params.id),
  }));

  // ── Cross-source links (ADVISORY) ───────────────────────────────────────────
  // Declare a relationship between cubes on DIFFERENT connectors/dataSources.
  // Cube cannot execute this as a live SQL join — the link is modeling intent +
  // a capability verdict (rollupJoin-eligible? or ETL), never compiled to YAML.
  app.get<{ Querystring: { workspaceId?: string } }>('/api/onboarding/cross-source-links', async (req) => {
    const links = listCrossSourceLinks(req.query.workspaceId).map((link) => ({
      ...link,
      verdict: crossSourceVerdict(
        sourceTypeOf(link.leftConnector) ?? 'unknown',
        sourceTypeOf(link.rightConnector) ?? 'unknown',
      ),
    }));
    return { links };
  });

  app.post('/api/onboarding/cross-source-links', async (req, reply) => {
    const parsed = CrossSourceLinkBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: parsed.error.message } });
    }
    const d = parsed.data;
    const leftSt = sourceTypeOf(d.leftConnector);
    const rightSt = sourceTypeOf(d.rightConnector);
    if (!leftSt || !rightSt) {
      return reply.status(404).send({ error: { code: 'CONNECTOR_NOT_FOUND', message: 'one or both connectors are unknown' } });
    }
    // Same connector ⇒ this is an executable same-source join, not a cross-source
    // advisory link. Steer the caller to the executable path.
    if (d.leftConnector === d.rightConnector) {
      return reply.status(400).send({
        error: { code: 'SAME_SOURCE', message: 'both cubes share a connector — use an executable join, not a cross-source link' },
      });
    }
    const link = createCrossSourceLink({
      workspaceId: d.workspaceId,
      leftCube: d.leftCube,
      leftConnector: d.leftConnector,
      rightCube: d.rightCube,
      rightConnector: d.rightConnector,
      key: d.key,
      relationship: d.relationship,
      rationale: d.rationale ?? null,
      createdBy: actorOf(req),
    });
    return reply.status(201).send({ link, verdict: crossSourceVerdict(leftSt, rightSt) });
  });

  app.delete<{ Params: { id: string } }>('/api/onboarding/cross-source-links/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'invalid link id' } });
    }
    const ok = disableCrossSourceLink(id);
    if (!ok) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'link not found or already removed' } });
    return { removed: true, id };
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

  // ── Cross-game join: add an executable join to a cube in another game that ──
  // lives under the SAME Trino connector (federated schemas, one data_source).
  // Dual-game grant: the user must hold BOTH the initiating and the target game.
  // Cross-`dataSource` links are NOT executable here — they go to Phase C
  // (declare + flag), so a non-Trino initiating connector is refused.
  app.post('/api/onboarding/cross-game-join', async (req, reply) => {
    const parsed = CrossGameJoinBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: parsed.error.message } });
    }
    const { draftId, targetGame, targetCube, fromColumn, toColumn, relationship } = parsed.data;

    const draft = getDraft(draftId);
    if (!draft) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'draft not found' } });

    // Dual-game grant intersection — initiating game and target game.
    if (gameForbidden(req, draft.game)) {
      return reply.status(403).send({ error: { code: 'GAME_FORBIDDEN', message: `game "${draft.game}" not granted` } });
    }
    if (gameForbidden(req, targetGame)) {
      return reply.status(403).send({ error: { code: 'GAME_FORBIDDEN', message: `target game "${targetGame}" not granted` } });
    }

    // Same-`dataSource` guard: only Trino's federated catalog can execute this
    // join. The initiating connector must resolve to Trino; a non-Trino OR an
    // unresolvable/disabled connector is refused (it can't back an executable
    // cross-game join) — those go to Phase C (declare a cross-source link).
    const connector = getConnector(draft.connectorId);
    if (!connector || connector.sourceType !== 'trino') {
      return reply.status(409).send({
        error: { code: 'CROSS_SOURCE', message: 'cross-dataSource joins are not executable — declare a cross-source link instead' },
      });
    }
    if (!schemaForGame(targetGame)) {
      return reply.status(400).send({ error: { code: 'SCHEMA_REQUIRED', message: `target game "${targetGame}" has no mapped Trino schema` } });
    }

    // The target cube must exist in the other game's committed model.
    const targetModel = readExistingModel(targetGame);
    if (!targetModel.cubes.some((c) => c.name === targetCube)) {
      return reply.status(404).send({ error: { code: 'TARGET_CUBE_NOT_FOUND', message: `cube "${targetCube}" not found in game "${targetGame}"` } });
    }

    let updatedModel;
    try {
      updatedModel = addCrossGameJoin(draft.model, draft.cubeName, { targetCube, fromColumn, toColumn, relationship });
    } catch (err) {
      return reply.status(400).send({ error: { code: 'JOIN_INVALID', message: (err as Error).message } });
    }

    // Persist back into the same draft (keyed on game+cubeName); preserves status.
    const updated = upsertDraft({
      game: draft.game,
      connectorId: draft.connectorId,
      schemaName: draft.schemaName,
      cubeName: draft.cubeName,
      model: updatedModel,
      yaml: toYaml(updatedModel),
      profiles: null,
      inference: draft.inference,
      source: draft.source,
      createdBy: actorOf(req),
    });
    return { draft: updated, note: 'Cross-game join staged on the draft. Validate live after approval/write.' };
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
