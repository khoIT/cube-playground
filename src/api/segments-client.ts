/**
 * Typed client functions for the segments service.
 * One function per endpoint. All calls go through apiFetch which adds the
 * X-Owner header and parses error envelopes.
 */

import { apiFetch } from './api-client';
import type {
  Segment,
  SegmentInput,
  SegmentPatch,
  SegmentAnalysis,
  CubeIdentityMapping,
  Preset,
  SegmentType,
  GamesConfig,
  RefreshLogRow,
  ActivationInput,
  PredicateNode,
} from '../types/segment-api';

export interface ListSegmentsParams {
  owner?: string;
  type?: SegmentType;
  q?: string;
  sort?: 'name' | 'recent' | 'size';
  game_id?: string;
}

/** One cached member-360 panel as served by the nightly precompute. */
export interface CachedMemberPanel {
  rows: Array<Record<string, unknown>>;
  fetched_at: string;
  status: 'ok' | 'error';
  error?: string;
}

export interface MemberPanelsResponse {
  segment_id: string;
  uid: string;
  panels: Record<string, CachedMemberPanel>;
  cached: boolean;
}

export interface MemberCacheStatusResponse {
  segment_id: string;
  /** Core panels the segment's game precomputes (ok === panel_count → ready). */
  panel_count: number;
  uids: Record<string, { ok: number; error: number; latest_fetched_at: string | null }>;
}

/** AI brief payload generated server-side per (definition hash, lang). */
export interface SegmentBriefPayload {
  label:
    | 'high_value_churn_risk'
    | 'upsell_candidate'
    | 'engaged_non_payer'
    | 'healthy_growth_cohort'
    | 'new_user_wave';
  narrative: string;
  signals: string[];
  data_coverage: 'full' | 'limited';
  generated_at: string;
  member_count: number;
  definition_hash: string;
}

export interface SegmentBriefResponse {
  segment_id: string;
  lang: string;
  status: 'ok' | 'error';
  /** Set when the served brief predates the current definition (LLM down). */
  stale?: boolean;
  brief: SegmentBriefPayload | null;
  error?: string;
  generated_at: string;
}

/** One enriched member row from the pull API. Beyond `uid`, keys follow the
 *  page's `columns` (snake_cased preset column ids: name, ltv, joined,
 *  last_active, …) — uid-only rows when no profile snapshot exists yet. */
export type SegmentMemberRow = { uid: string } & Record<string, unknown>;

/** Column descriptor for the enriched rows (`key` indexes into each row). */
export interface SegmentMemberColumn {
  key: string;
  label: string;
  field: string;
  format?: string;
}

/** One page from the tokenless member pull API (`GET /:id/members`).
 *  Rows are RANKED by `rank_measure` when a profile snapshot exists (cursor =
 *  numeric offset); otherwise uid-sorted with a uid keyset cursor. */
export interface SegmentMembersPage {
  segment_id: string;
  game_id: string | null;
  cube: string | null;
  computed_at: string | null;
  total_count: number;
  returned_count: number;
  truncated: boolean;
  rank_measure: string | null;
  columns: SegmentMemberColumn[];
  members: SegmentMemberRow[];
  next_cursor: string | null;
}

export const segmentsClient = {
  list(params: ListSegmentsParams = {}): Promise<Segment[]> {
    return apiFetch<Segment[]>('/api/segments', { query: params as Record<string, string | undefined> });
  },

  get(id: string): Promise<Segment> {
    return apiFetch<Segment>(`/api/segments/${encodeURIComponent(id)}`);
  },

  create(input: SegmentInput): Promise<Segment> {
    return apiFetch<Segment>('/api/segments', { method: 'POST', body: input });
  },

  update(id: string, patch: SegmentPatch): Promise<Segment> {
    return apiFetch<Segment>(`/api/segments/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: patch,
    });
  },

  delete(id: string): Promise<void> {
    return apiFetch<void>(`/api/segments/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  append(id: string, uids: string[]): Promise<{ uid_count: number }> {
    return apiFetch<{ uid_count: number }>(`/api/segments/${encodeURIComponent(id)}/append`, {
      method: 'POST',
      body: { uids },
    });
  },

  // Publish toggle (owner/admin only): share → visibility 'shared' + shared_at;
  // unshare → back to 'personal'. Returns the updated segment.
  share(id: string): Promise<Segment> {
    return apiFetch<Segment>(`/api/segments/${encodeURIComponent(id)}/share`, { method: 'POST' });
  },

  unshare(id: string): Promise<Segment> {
    return apiFetch<Segment>(`/api/segments/${encodeURIComponent(id)}/unshare`, { method: 'POST' });
  },

  // AI brief (server-cached per definition hash + lang; refresh is rate-limited)
  getBrief(id: string, lang: 'en' | 'vi', refresh = false): Promise<SegmentBriefResponse> {
    return apiFetch<SegmentBriefResponse>(`/api/segments/${encodeURIComponent(id)}/brief`, {
      query: { lang, ...(refresh ? { refresh: '1' } : {}) },
    });
  },

  refresh(id: string): Promise<{ status: string }> {
    return apiFetch<{ status: string }>(`/api/segments/${encodeURIComponent(id)}/refresh`, {
      method: 'POST',
    });
  },

  refreshLog(id: string, days = 7, limit = 200): Promise<RefreshLogRow[]> {
    return apiFetch<RefreshLogRow[]>(
      `/api/segments/${encodeURIComponent(id)}/refresh-log`,
      { query: { days: String(days), limit: String(limit) } },
    );
  },

  refreshLogs(ids: string[], days = 7): Promise<Record<string, RefreshLogRow[]>> {
    return apiFetch<Record<string, RefreshLogRow[]>>('/api/segments/refresh-logs', {
      method: 'POST',
      body: { ids, days },
    });
  },

  appendActivation(id: string, payload: ActivationInput): Promise<Segment> {
    return apiFetch<Segment>(`/api/segments/${encodeURIComponent(id)}/activations`, {
      method: 'POST',
      body: payload,
    });
  },

  removeActivation(id: string, activationId: string): Promise<Segment> {
    return apiFetch<Segment>(
      `/api/segments/${encodeURIComponent(id)}/activations/${encodeURIComponent(activationId)}`,
      { method: 'DELETE' },
    );
  },

  sqlFilter(id: string): Promise<{ filter: string }> {
    return apiFetch<{ filter: string }>(`/api/segments/${encodeURIComponent(id)}/sql-filter`);
  },

  // Runnable Trino SELECT reproducing the segment's membership (for the Pull API
  // tab). Live (predicate) segments only; identity-projection of the predicate.
  membershipSql(id: string): Promise<{
    sql: string;
    identity: string;
    catalog: string;
    schema: string | null;
  }> {
    return apiFetch(`/api/segments/${encodeURIComponent(id)}/membership-sql`);
  },

  // Bare member-ID pull: keyset-paginated identity values for a downstream app.
  members(
    id: string,
    params: { cursor?: string; limit?: number } = {},
  ): Promise<SegmentMembersPage> {
    return apiFetch<SegmentMembersPage>(`/api/segments/${encodeURIComponent(id)}/members`, {
      query: {
        cursor: params.cursor,
        limit: params.limit != null ? String(params.limit) : undefined,
      },
    });
  },

  // Member-360 precompute cache (read side of the nightly job)
  memberPanels(id: string, uid: string): Promise<MemberPanelsResponse> {
    return apiFetch<MemberPanelsResponse>(
      `/api/segments/${encodeURIComponent(id)}/members/${encodeURIComponent(uid)}/panels`,
    );
  },

  memberCacheStatus(id: string): Promise<MemberCacheStatusResponse> {
    return apiFetch<MemberCacheStatusResponse>(
      `/api/segments/${encodeURIComponent(id)}/member-cache-status`,
    );
  },

  // Analyses (subresource)
  listAnalyses(segmentId: string): Promise<SegmentAnalysis[]> {
    return apiFetch<SegmentAnalysis[]>(
      `/api/segments/${encodeURIComponent(segmentId)}/analyses`
    );
  },

  preview(predicateTree: unknown, primaryCube: string): Promise<{
    estimated_count: number | null;
    cube_query: unknown;
    sql_preview: string | null;
    took_ms: number;
    cached: boolean;
  }> {
    return apiFetch('/api/preview', {
      method: 'POST',
      body: { predicate_tree: predicateTree, primary_cube: primaryCube },
    });
  },

  /** Distribution histogram for a numeric member (Phase 03 endpoint). */
  distribution(body: {
    game_id: string;
    member: string;
    population_predicate?: unknown;
    buckets?: number;
  }): Promise<{
    buckets: Array<{ lo: number; hi: number; count: number }> | null;
    total?: number;
    p50?: number;
    p90?: number;
    took_ms: number;
    approx?: boolean;
    reason?: string;
  }> {
    return apiFetch('/api/distribution', { method: 'POST', body });
  },

  /** Pre-save cohort profile: top-k breakdown per dimension (Phase 05 endpoint). */
  profile(body: {
    game_id: string;
    cube: string;
    predicate: unknown;
    dimensions?: string[];
  }): Promise<{
    total: number | null;
    breakdowns: Array<{
      dimension: string;
      label: string;
      top: Array<{ value: string; count: number; pct: number }>;
    }>;
    took_ms: number;
    approx: boolean;
  }> {
    return apiFetch('/api/profile', { method: 'POST', body });
  },

  /** Candidate overlap against existing saved segments (Phase 06 endpoint). */
  overlapCandidate(body: {
    game_id: string;
    cube: string;
    predicate: unknown;
  }): Promise<{
    overlaps: Array<{
      segment_id: string;
      name: string;
      candidate_size: number;
      both_count: number;
      pct_of_candidate: number;
    }>;
    approx: true;
    took_ms: number;
  }> {
    return apiFetch('/api/overlap-candidate', { method: 'POST', body });
  },

  /**
   * Segmentability probe for the chat "Build segment from this" bridge. Runs the
   * server-side CubeQuery→predicate translator + gate. `segmentable:false` means
   * the explored query can't become a segment (aggregate-only, measure filter,
   * time-in-OR, …) — the bridge hides its button rather than emit a broken tree.
   */
  translateQuery(query: unknown): Promise<TranslateQueryResult> {
    return apiFetch<TranslateQueryResult>('/api/segments/translate-query', {
      method: 'POST',
      body: { query },
    });
  },

  /**
   * Distinct values of one grouping dimension, for the "Build segment from this"
   * seed picker (when translateQuery returns reason `breakdown_unfiltered`).
   * Best-effort — returns an empty list rather than throwing.
   */
  dimensionValues(body: {
    game_id: string;
    dimension: string;
    query: unknown;
  }): Promise<{ values: string[]; reason?: string; took_ms: number }> {
    return apiFetch('/api/segments/dimension-values', { method: 'POST', body });
  },
};

/**
 * Result of POST /api/segments/translate-query (segmentability probe).
 *
 * `breakdown_unfiltered` is a special rejection: the query groups by
 * `seed_dimensions` but filters no rows. The bridge still shows, routing to a
 * value picker that turns a chosen value into an equals/in predicate (rather
 * than hiding, as for genuinely non-segmentable shapes).
 */
export type TranslateQueryResult =
  | { segmentable: true; predicate_tree: PredicateNode; cube: string }
  | {
      segmentable: false;
      reason: string;
      hint?: string;
      seed_dimensions?: string[];
      cube?: string;
    };

export const identityMapClient = {
  list(): Promise<CubeIdentityMapping[]> {
    return apiFetch<CubeIdentityMapping[]>('/api/identity-map');
  },

  put(cube: string, identity_field: string, confidence = 1): Promise<CubeIdentityMapping> {
    return apiFetch<CubeIdentityMapping>(`/api/identity-map/${encodeURIComponent(cube)}`, {
      method: 'PUT',
      body: { identity_field, confidence },
    });
  },
};

export const presetsClient = {
  list(): Promise<Preset[]> {
    return apiFetch<Preset[]>('/api/presets');
  },
};

export const gamesClient = {
  list(): Promise<GamesConfig> {
    return apiFetch<GamesConfig>('/api/playground/games');
  },
};
