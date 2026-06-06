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

/** One keyset page from the bare member-ID pull API (`GET /:id/members`). */
export interface SegmentMembersPage {
  segment_id: string;
  game_id: string | null;
  cube: string | null;
  computed_at: string | null;
  total_count: number;
  returned_count: number;
  truncated: boolean;
  members: string[];
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
