/**
 * Read-only glossary client. The list is fetched once per page mount; the
 * chat term linker shares the same fetch via the React hook so we don't
 * hit the endpoint twice on the same page load.
 */

export interface GlossaryTerm {
  id: string;
  label: string;
  description: string;
  primaryCatalogId: string | null;
  secondaryCatalogIds: string[];
  aliases: string[];
  category: string | null;
  updatedAt: string;
}

export async function listGlossary(signal?: AbortSignal): Promise<GlossaryTerm[]> {
  const res = await fetch('/api/glossary', {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!res.ok) throw new Error(`Failed to fetch glossary: HTTP ${res.status}`);
  const data = (await res.json()) as { terms: GlossaryTerm[] };
  return data.terms ?? [];
}
