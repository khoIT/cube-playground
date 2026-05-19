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
} from '../types/segment-api';

export interface ListSegmentsParams {
  owner?: string;
  type?: SegmentType;
  q?: string;
  sort?: 'name' | 'recent' | 'size';
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
