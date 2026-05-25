/**
 * HTTP client for the Official glossary. Caches the response in-memory for
 * 30s with weak-ETag revalidation so the engine can answer disambiguation
 * requests without hammering the main server on every turn.
 *
 * The chat agent must only reason over Official terms; passing
 * ?status=official is the contract enforced here.
 */

import { z } from 'zod';
import { config } from '../config.js';
import type { OfficialTerm } from './types.js';

const TermSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  primaryCatalogId: z.string().nullable(),
  aliases: z.array(z.string()).max(40).default([]),
  aliasesVi: z.array(z.string()).max(40).default([]),
  labelVi: z.string().nullable().default(null),
  category: z.string().nullable().default(null),
  status: z.literal('official').or(z.literal('draft')).optional(),
});

const ListSchema = z.object({ terms: z.array(TermSchema) });

const TTL_MS = 30_000;

interface CacheEntry {
  fetchedAt: number;
  etag: string | null;
  terms: OfficialTerm[];
}

let cache: CacheEntry | null = null;
let inflight: Promise<OfficialTerm[]> | null = null;

function freshEnough(entry: CacheEntry | null, now: number): boolean {
  return !!entry && now - entry.fetchedAt < TTL_MS;
}

async function fetchFromServer(prevEtag: string | null): Promise<{ terms: OfficialTerm[]; etag: string | null } | 'not_modified'> {
  const url = `${config.serverBaseUrl}/api/glossary?status=official`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (prevEtag) headers['If-None-Match'] = prevEtag;

  const res = await fetch(url, { headers });
  if (res.status === 304) return 'not_modified';
  if (!res.ok) {
    throw new Error(`glossary fetch failed: HTTP ${res.status}`);
  }
  const json = (await res.json()) as unknown;
  const parsed = ListSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`glossary response malformed: ${parsed.error.message}`);
  }
  const terms: OfficialTerm[] = parsed.data.terms.map((t) => ({
    id: t.id,
    label: t.label,
    description: t.description,
    primaryCatalogId: t.primaryCatalogId,
    aliases: t.aliases,
    aliasesVi: t.aliasesVi,
    labelVi: t.labelVi,
    category: t.category,
  }));
  return { terms, etag: res.headers.get('etag') };
}

export async function fetchOfficialGlossary(now: number = Date.now()): Promise<OfficialTerm[]> {
  if (freshEnough(cache, now)) return cache!.terms;
  if (inflight) return inflight;

  inflight = (async () => {
    const prevEtag = cache?.etag ?? null;
    try {
      const result = await fetchFromServer(prevEtag);
      if (result === 'not_modified' && cache) {
        cache = { ...cache, fetchedAt: now };
        return cache.terms;
      }
      if (result === 'not_modified') {
        // Cache lost but server says nothing changed — fetch unconditionally.
        const reload = await fetchFromServer(null);
        if (reload === 'not_modified') throw new Error('unexpected 304 without prior cache');
        cache = { fetchedAt: now, etag: reload.etag, terms: reload.terms };
        return reload.terms;
      }
      cache = { fetchedAt: now, etag: result.etag, terms: result.terms };
      return result.terms;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** Test hook — wipe the in-memory cache so each test starts clean. */
export function __resetGlossaryCache(): void {
  cache = null;
  inflight = null;
}
