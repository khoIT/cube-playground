/**
 * Typed client for /api/annotations — chart event annotation CRUD.
 * All calls go through apiFetch (adds X-Owner + x-cube-workspace headers).
 */

import { apiFetch } from './api-client';

export type AnnotationType = 'patch' | 'event' | 'campaign' | 'incident';

export interface ChartAnnotation {
  id: number;
  game: string | null;
  type: AnnotationType;
  title: string;
  starts_at: string; // YYYY-MM-DD
  ends_at: string | null;
  url: string | null;
  created_by: string | null;
  created_at: number;
}

export interface ListAnnotationsParams {
  game: string;
  from?: string;
  to?: string;
}

export interface CreateAnnotationInput {
  game?: string | null;
  type: AnnotationType;
  title: string;
  starts_at: string;
  ends_at?: string | null;
  url?: string | null;
}

export interface UpdateAnnotationInput {
  type?: AnnotationType;
  title?: string;
  starts_at?: string;
  ends_at?: string | null;
  url?: string | null;
}

export async function fetchAnnotations(params: ListAnnotationsParams): Promise<ChartAnnotation[]> {
  const qs = new URLSearchParams({ game: params.game });
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  const data = await apiFetch<{ annotations: ChartAnnotation[] }>(`/api/annotations?${qs}`);
  return data.annotations;
}

export async function createAnnotation(input: CreateAnnotationInput): Promise<ChartAnnotation> {
  const data = await apiFetch<{ annotation: ChartAnnotation }>('/api/annotations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return data.annotation;
}

export async function updateAnnotation(id: number, input: UpdateAnnotationInput): Promise<ChartAnnotation> {
  const data = await apiFetch<{ annotation: ChartAnnotation }>(`/api/annotations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return data.annotation;
}

export async function deleteAnnotation(id: number): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/annotations/${id}`, { method: 'DELETE' });
}
