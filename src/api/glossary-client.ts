/**
 * Glossary client. Reads + writes used by the catalog index page, the term
 * linker in chat, and the editor modal. The list endpoint sets a weak ETag
 * so the chat-side resolver can short-circuit revalidation, but here we
 * always re-fetch — pages are infrequent enough that caching adds no value.
 */

export type GlossaryStatus = 'draft' | 'official';
export type GlossarySource = 'seed' | 'user';
export type GlossaryTrustTier = 'certified' | 'experimental';

/** Shape of default_filter — server enforces safe op allowlist. */
export interface GlossaryFilter {
  member: string;
  op: '>' | '>=' | '<' | '<=' | '=' | '!=' | 'IN' | 'NOT IN';
  value: string | number | (string | number)[];
}

/** Shape of ranking_json. */
export interface GlossaryRanking {
  order: 'ASC' | 'DESC';
  default_limit: number;
}

export interface GlossaryTerm {
  id: string;
  label: string;
  description: string;
  primaryCatalogId: string | null;
  secondaryCatalogIds: string[];
  aliases: string[];
  category: string | null;
  updatedAt: string;
  labelVi: string | null;
  descriptionVi: string | null;
  aliasesVi: string[];
  status: GlossaryStatus;
  source: GlossarySource;
  editorName: string | null;
  // Phase 02a concept-tier fields (nullable; absent on non-concept terms).
  entityCube: string | null;
  entityPk: string | null;
  defaultMeasureRef: string | null;
  defaultFilter: GlossaryFilter | null;
  ranking: GlossaryRanking | null;
  trustTier: GlossaryTrustTier | null;
}

/** Returns true when a term carries at least one concept-tier field. */
export function isConceptTerm(term: GlossaryTerm): boolean {
  return !!(term.entityCube || term.entityPk || term.defaultMeasureRef);
}

export interface GlossaryConceptInput {
  entityCube?: string | null;
  entityPk?: string | null;
  defaultMeasureRef?: string | null;
  defaultFilter?: GlossaryFilter | null;
  ranking?: GlossaryRanking | null;
  trustTier?: GlossaryTrustTier | null;
}

export interface GlossaryWriteInput extends GlossaryConceptInput {
  label: string;
  description: string;
  primaryCatalogId?: string | null;
  secondaryCatalogIds?: string[];
  aliases?: string[];
  category?: string | null;
  labelVi?: string | null;
  descriptionVi?: string | null;
  aliasesVi?: string[];
  editorName?: string | null;
}

export interface CreateGlossaryInput extends GlossaryWriteInput {
  id?: string;
}

async function jsonOrThrow<T>(res: Response, action: string): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Glossary ${action} failed: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export async function listGlossary(
  signal?: AbortSignal,
  opts?: { status?: GlossaryStatus },
): Promise<GlossaryTerm[]> {
  const qs = opts?.status ? `?status=${opts.status}` : '';
  const res = await fetch(`/api/glossary${qs}`, {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!res.ok) throw new Error(`Failed to fetch glossary: HTTP ${res.status}`);
  const data = (await res.json()) as { terms: GlossaryTerm[] };
  return data.terms ?? [];
}

export async function getGlossaryTerm(id: string, signal?: AbortSignal): Promise<GlossaryTerm> {
  const res = await fetch(`/api/glossary/${encodeURIComponent(id)}`, {
    headers: { Accept: 'application/json' },
    signal,
  });
  return jsonOrThrow<GlossaryTerm>(res, 'get');
}

export async function createGlossary(input: CreateGlossaryInput): Promise<GlossaryTerm> {
  const res = await fetch('/api/glossary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input),
  });
  return jsonOrThrow<GlossaryTerm>(res, 'create');
}

export async function updateGlossary(
  id: string,
  input: GlossaryWriteInput,
): Promise<GlossaryTerm> {
  const res = await fetch(`/api/glossary/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input),
  });
  return jsonOrThrow<GlossaryTerm>(res, 'update');
}

export async function setGlossaryStatus(
  id: string,
  status: GlossaryStatus,
  editorName?: string,
): Promise<GlossaryTerm> {
  const res = await fetch(`/api/glossary/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ status, editorName: editorName ?? null }),
  });
  return jsonOrThrow<GlossaryTerm>(res, 'set status');
}

export async function deleteGlossary(id: string): Promise<void> {
  const res = await fetch(`/api/glossary/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) {
    const body = await res.text().catch(() => '');
    throw new Error(`Glossary delete failed: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
}
