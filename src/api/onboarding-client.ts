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
  sourceType: string;
  catalog: string;
  host: string;
  configured: boolean;
  /** Non-secret coordinates (host/port/user/catalog/ssl + extras) for edit prefill. */
  config?: Record<string, unknown>;
  /** Read-only worked example (committed cube-dev model); never live-introspected. */
  readOnly?: boolean;
}

export interface ConnectorAuditRow {
  id: number;
  connectorId: string;
  action: 'create' | 'update' | 'disable' | 'test';
  actor: string | null;
  detail: string | null;
  ts: string;
}

export interface ConnectorsResponse {
  configured: boolean;
  connectors: Connector[];
}

// ── Cross-source links (advisory — never executable) ────────────────────────
export interface CrossSourceVerdict {
  executable: false;
  rollupJoinEligible: boolean;
  leftSourceType: string;
  rightSourceType: string;
  note: string;
}

export interface CrossSourceLink {
  id: number;
  workspaceId: string;
  leftCube: string;
  leftConnector: string;
  rightCube: string;
  rightConnector: string;
  key: { fromColumn: string; toColumn: string };
  relationship: string;
  rationale: string | null;
  status: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  /** Capability verdict, attached on the list endpoint. */
  verdict?: CrossSourceVerdict;
}

// ── Source types (drives the dynamic connect form) ──────────────────────────
export type SourceFieldType = 'text' | 'password' | 'number' | 'boolean' | 'select' | 'file';

export interface SourceField {
  key: string;
  label: string;
  type: SourceFieldType;
  required: boolean;
  secret?: boolean;
  placeholder?: string;
  default?: string | number | boolean;
  options?: Array<{ value: string; label: string }>;
  help?: string;
}

export interface SourceType {
  id: string;
  label: string;
  category: 'warehouse' | 'mmp' | 'adnetworks' | 'others';
  driverType: string;
  fields: SourceField[];
  caps: { introspect: boolean; sameSourceJoins: boolean; crossSourceRollupJoin: boolean };
}

export interface TestConnectorResult {
  ok: boolean;
  latencyMs?: number;
  code?: string;
  message?: string;
}

export interface ProvisionConnectorResult {
  connector: Connector | null;
  liveTested: boolean;
  note?: string;
}

// ── Existing model (read-only worked example) ───────────────────────────────
export interface ExistingDimension { name: string; type: string; sql?: string; primaryKey?: boolean; description?: string }
export interface ExistingMeasure { name: string; type: string; sql?: string; description?: string }
export interface ExistingJoin { name: string; relationship: string; sql: string }
export interface ExistingCube {
  name: string;
  sqlTable: string;
  title?: string;
  description?: string;
  file: string;
  dimensions: ExistingDimension[];
  measures: ExistingMeasure[];
  joins: ExistingJoin[];
}
export interface ExistingModel {
  game: string;
  configured: boolean;
  cubes: ExistingCube[];
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

  sourceTypes(): Promise<{ sourceTypes: SourceType[] }> {
    return apiFetch<{ sourceTypes: SourceType[] }>('/api/onboarding/source-types');
  },

  exampleModel(game: string): Promise<ExistingModel> {
    return apiFetch<ExistingModel>('/api/onboarding/example-model', { query: { game } });
  },

  testConnector(sourceType: string, fields: Record<string, unknown>): Promise<TestConnectorResult> {
    return apiFetch<TestConnectorResult>('/api/onboarding/connectors/test', {
      method: 'POST',
      body: { sourceType, fields },
    });
  },

  provisionConnector(input: {
    label: string;
    sourceType: string;
    workspaceId?: string;
    fields: Record<string, unknown>;
  }): Promise<ProvisionConnectorResult> {
    return apiFetch<ProvisionConnectorResult>('/api/onboarding/connectors', {
      method: 'POST',
      body: input,
    });
  },

  /** Edit a connector. Blank/omitted secret field keeps the stored credential. */
  updateConnector(
    id: string,
    body: { label?: string; fields: Record<string, unknown> },
  ): Promise<ProvisionConnectorResult> {
    return apiFetch<ProvisionConnectorResult>(`/api/onboarding/connectors/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body,
    });
  },

  disableConnector(id: string): Promise<{ disabled: boolean; id: string }> {
    return apiFetch<{ disabled: boolean; id: string }>(
      `/api/onboarding/connectors/${encodeURIComponent(id)}/disable`,
      { method: 'POST' },
    );
  },

  connectorAudit(id: string): Promise<{ audit: ConnectorAuditRow[] }> {
    return apiFetch<{ audit: ConnectorAuditRow[] }>(
      `/api/onboarding/connectors/${encodeURIComponent(id)}/audit`,
    );
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

  /**
   * Add an executable cross-game join to a draft cube (same Trino connector).
   * Requires grants for both the initiating and the target game (server 403s
   * otherwise). Returns the updated draft with the join staged.
   */
  crossGameJoin(input: {
    draftId: number;
    targetGame: string;
    targetCube: string;
    fromColumn: string;
    toColumn: string;
    relationship: 'many_to_one' | 'one_to_many' | 'one_to_one';
  }): Promise<{ draft: DraftModelRow; note?: string }> {
    return apiFetch<{ draft: DraftModelRow; note?: string }>('/api/onboarding/cross-game-join', {
      method: 'POST',
      body: input,
    });
  },

  // ── Cross-source links (advisory) ──────────────────────────────────────────
  crossSourceLinks(workspaceId?: string): Promise<{ links: CrossSourceLink[] }> {
    return apiFetch<{ links: CrossSourceLink[] }>('/api/onboarding/cross-source-links', {
      query: { workspaceId },
    });
  },

  declareCrossSourceLink(input: {
    leftCube: string;
    leftConnector: string;
    rightCube: string;
    rightConnector: string;
    key: { fromColumn: string; toColumn: string };
    relationship: 'many_to_one' | 'one_to_many' | 'one_to_one';
    rationale?: string;
    workspaceId?: string;
  }): Promise<{ link: CrossSourceLink; verdict: CrossSourceVerdict }> {
    return apiFetch<{ link: CrossSourceLink; verdict: CrossSourceVerdict }>('/api/onboarding/cross-source-links', {
      method: 'POST',
      body: input,
    });
  },

  removeCrossSourceLink(id: number): Promise<{ removed: boolean; id: number }> {
    return apiFetch<{ removed: boolean; id: number }>(`/api/onboarding/cross-source-links/${id}`, {
      method: 'DELETE',
    });
  },
};
