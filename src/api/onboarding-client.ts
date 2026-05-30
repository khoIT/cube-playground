/**
 * Typed client for /api/onboarding/* — the cube-model onboarding agent.
 * All calls go through apiFetch (adds X-Owner + x-cube-workspace headers,
 * parses error envelopes). POSTs are write-role gated server-side; the UI
 * mirrors that gate cosmetically (viewers see read-only). Mirrors the style of
 * `dashboards-client.ts`.
 */

import { apiFetch } from './api-client';

// ── Connectors ──────────────────────────────────────────────────────────────
export interface Connector {
  id: string;
  label: string;
  workspaceId: string;
  catalog: string;
  host: string;
  configured: boolean;
}

export interface ConnectorsResponse {
  configured: boolean;
  connectors: Connector[];
}

// ── Introspection ─────────────────────────────────────────────────────────────
export interface ColumnMeta {
  name: string;
  dataType: string;
  position: number;
  nullable: boolean;
}

export interface TableMeta {
  schema: string;
  table: string;
  columns: ColumnMeta[];
}

export interface IntrospectResponse {
  connectorId: string;
  schema: string;
  tables: TableMeta[];
}

// ── Inference / draft model ─────────────────────────────────────────────────
export type FieldRole = 'dimension' | 'measure' | 'time' | 'primary_key' | 'ignore';

export interface InferredField {
  column: string;
  dataType: string;
  role: FieldRole;
  confidence: number;
  rationale: string;
  agg?: string;
}

export interface InferredJoin {
  fromColumn: string;
  toCube: string;
  toColumn: string;
  relationship: string;
  confidence: number;
  rationale: string;
}

export interface InferredCube {
  name: string;
  sqlTable: string;
  primaryKey: string;
  fields: InferredField[];
  joins: InferredJoin[];
}

export interface InferredSchema {
  schema: string;
  mode: 'cold' | 'warm';
  cubes: InferredCube[];
}

export interface CubeModelDimension {
  name: string;
  sql?: string;
  type: string;
}
export interface CubeModelMeasure {
  name: string;
  type: string;
  sql?: string;
}
export interface CubeModelJoin {
  name: string;
  relationship: string;
  sql: string;
}
export interface CubeModelCube {
  name: string;
  sql_table: string;
  description?: string;
  dimensions: CubeModelDimension[];
  measures: CubeModelMeasure[];
  joins?: CubeModelJoin[];
}
export interface CubeModel {
  cubes: CubeModelCube[];
}

export type DraftStatus = 'pending' | 'accepted' | 'rejected' | 'written';

export interface DraftModelRow {
  id: string;
  game: string;
  connectorId: string;
  schemaName: string;
  cubeName: string;
  model: CubeModel;
  yaml: string;
  profiles: unknown;
  inference: InferredSchema | null;
  status: DraftStatus;
  source: 'cold' | 'warm';
  createdBy: string;
  approvedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DraftAuditRow {
  id: string;
  draftId: string;
  action: string;
  actor: string;
  reason?: string | null;
  createdAt: string;
}

export interface ValidateResponse {
  structural: { ok: boolean; cubes: number };
  live: { ok: true; rowCount: number } | { ok: false; error: string } | null;
  note?: string;
}

export interface ApproveResponse {
  draft: DraftModelRow;
  written: boolean;
}

export interface GenerateInput {
  connectorId?: string;
  game: string;
  schema?: string;
  tables: string[];
  mode: 'cold' | 'warm';
}

export const onboardingClient = {
  connectors(): Promise<ConnectorsResponse> {
    return apiFetch<ConnectorsResponse>('/api/onboarding/connectors');
  },

  introspect(opts: { connectorId: string; schema?: string; game?: string }): Promise<IntrospectResponse> {
    return apiFetch<IntrospectResponse>('/api/onboarding/introspect', {
      query: { connectorId: opts.connectorId, schema: opts.schema, game: opts.game },
    });
  },

  generate(input: GenerateInput): Promise<{ drafts: DraftModelRow[] }> {
    return apiFetch<{ drafts: DraftModelRow[] }>('/api/onboarding/generate', {
      method: 'POST',
      body: input,
    });
  },

  drafts(opts: { game?: string; status?: DraftStatus } = {}): Promise<{ drafts: DraftModelRow[] }> {
    return apiFetch<{ drafts: DraftModelRow[] }>('/api/onboarding/drafts', {
      query: { game: opts.game, status: opts.status },
    });
  },

  draft(id: string): Promise<{ draft: DraftModelRow; audit: DraftAuditRow[] }> {
    return apiFetch<{ draft: DraftModelRow; audit: DraftAuditRow[] }>(
      `/api/onboarding/drafts/${encodeURIComponent(id)}`,
    );
  },

  accept(id: string, reason?: string): Promise<{ draft: DraftModelRow }> {
    return apiFetch<{ draft: DraftModelRow }>(`/api/onboarding/drafts/${encodeURIComponent(id)}/accept`, {
      method: 'POST',
      body: { reason },
    });
  },

  reject(id: string, reason?: string): Promise<{ draft: DraftModelRow }> {
    return apiFetch<{ draft: DraftModelRow }>(`/api/onboarding/drafts/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      body: { reason },
    });
  },

  validate(id: string): Promise<ValidateResponse> {
    return apiFetch<ValidateResponse>(`/api/onboarding/drafts/${encodeURIComponent(id)}/validate`, {
      method: 'POST',
    });
  },

  approve(id: string): Promise<ApproveResponse> {
    return apiFetch<ApproveResponse>(`/api/onboarding/drafts/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
    });
  },
};
