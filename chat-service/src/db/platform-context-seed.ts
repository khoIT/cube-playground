/**
 * VNGGames company + Game Publishing Platform (GPP) context seed —
 * seed/platform-context-seed.json.
 *
 * A hand-curated, GAME-INDEPENDENT knowledge layer: who VNGGames is, what each
 * GPP platform domain/product does (Nexus, Level Up, VGA, Club, CS, Pay, Apollo,
 * Promotion, GDS), and a glossary of the org/platform terms leaders use. Unlike
 * the per-game topic-knowledge seed, this is not pregenerated — it is authored
 * from the GPP Confluence and checked into git (same placement rules — `seed/`,
 * NOT `runtime/`, so the Docker image ships it).
 *
 * Consumer: the get_company_context chat tool, which grounds questions that
 * reference the company or a platform product so the agent understands leader
 * vocabulary and routes correctly instead of guessing.
 *
 * Lazy-loaded and cached; a missing/corrupt file degrades to "no context" (the
 * tool reports that honestly) — never throws into a request path.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = join(__dirname, '..', '..', 'seed', 'platform-context-seed.json');

export const CONTEXT_SECTIONS = ['company', 'platform', 'glossary'] as const;
export type ContextSection = (typeof CONTEXT_SECTIONS)[number];

export interface CompanyContext {
  name: string;
  summary: string;
  operating_model: string;
  audience_note: string;
  markets: string[];
}

export interface PlatformDomain {
  /** Stable slug used to drill into a single product. */
  key: string;
  name: string;
  /** Alternate names a leader might use for the same product. */
  aka: string[];
  what: string;
  for_leaders?: string;
  /** Whether/how related data is queryable in this workspace, when known. */
  data_note?: string;
}

export interface PlatformContext {
  name: string;
  summary: string;
  domains: PlatformDomain[];
}

export interface GlossaryTerm {
  term: string;
  expansion: string;
  meaning: string;
}

export interface PlatformContextSeed {
  version: string;
  source: string;
  company: CompanyContext;
  platform: PlatformContext;
  glossary: GlossaryTerm[];
}

let cache: PlatformContextSeed | null | undefined;

function loadSeedFile(): PlatformContextSeed | null {
  if (cache !== undefined) return cache;
  cache = null;
  try {
    if (!existsSync(SEED_PATH)) return cache;
    const parsed = JSON.parse(readFileSync(SEED_PATH, 'utf8')) as PlatformContextSeed;
    if (
      typeof parsed?.version === 'string' &&
      parsed.company &&
      parsed.platform &&
      Array.isArray(parsed.platform.domains)
    ) {
      cache = parsed;
    }
  } catch {
    cache = null;
  }
  return cache;
}

/** Full curated context, or null when the file is absent/corrupt. */
export function getPlatformContext(): PlatformContextSeed | null {
  return loadSeedFile();
}

/**
 * Resolve a single platform domain by key or by a case-insensitive match on its
 * name / aka entries. Null when no context file or no match.
 */
export function findPlatformDomain(query: string): PlatformDomain | null {
  const file = loadSeedFile();
  if (!file) return null;
  const q = query.trim().toLowerCase();
  if (!q) return null;
  return (
    file.platform.domains.find((d) => {
      if (d.key.toLowerCase() === q) return true;
      if (d.name.toLowerCase() === q) return true;
      if (d.name.toLowerCase().includes(q) || q.includes(d.key.toLowerCase())) return true;
      return d.aka.some((a) => a.toLowerCase() === q || a.toLowerCase().includes(q));
    }) ?? null
  );
}

/** Test hook — drop the cached file so a test can swap fixtures. */
export function __resetPlatformContextCache(): void {
  cache = undefined;
}

export { SEED_PATH as PLATFORM_CONTEXT_SEED_PATH };
