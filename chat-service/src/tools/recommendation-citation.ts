/**
 * Shared citation builder for prescriptive read tools.
 *
 * Every recommended action must be traceable: which engine produced it, what
 * signal triggered it, and what benchmark (internal portfolio band + external
 * published norm) frames it. This module fetches the genre-lever library once
 * and joins it onto engine candidates / care playbooks.
 *
 * The ranker's lever families ("win-back", "spend-drop-recovery") and the
 * library's strategy families ("whale-care", "monetization-funnel") are
 * different taxonomies, so a confident join is the exception, not the rule.
 * When a candidate matches a library lever (by mapped playbook id, or exact
 * family) we enrich with its signal + dual benchmark + blind-spot. When it does
 * NOT, we fall back to a complete engine-sourced citation — never uncited, and
 * the write default is inferred from the lever's actuator (cs → case,
 * system → experiment).
 */

import { getJson, ServerClientError } from '../services/server-client.js';
import type { ToolContext } from '../types.js';

// ── Library shapes (subset of GET /api/knowledge/levers) ─────────────────────

interface ResolvedBand { band: string; value: number; computedAt: string }
interface ExternalNorm { value: number; unit: string; direction?: string; source: string; citation: string }
interface ResolvedBenchmark { metricKey: string; external?: ExternalNorm | null; internal?: ResolvedBand | null }

export interface LibraryLever {
  id: string;
  lever: string;
  signal: string;
  action: { text: string; mapsToPlaybookIds?: string[]; leverFamily?: string };
  defaultWrite: 'case' | 'sweep' | 'experiment' | 'none';
  blindSpot?: boolean;
  benchmark: ResolvedBenchmark;
}
export interface LibraryResolution {
  game: string;
  genre: string | null;
  levers: LibraryLever[];
  withheld: Array<{ id: string; lever: string; missingCubes: string[] }>;
  blindSpots: LibraryLever[];
}

// ── Candidate subset we cite ──────────────────────────────────────────────────

export interface CitableCandidate {
  opportunityFactor: string;
  lever: { family: string; actuator: 'cs' | 'system'; description: string };
  playbookId?: string;
  rankReason?: string;
  evidenceLink?: { source?: string };
}

export interface ActionCitation {
  sourceEngine: 'advisor/recommend' | 'care/playbooks';
  triggeringSignal: string;
  benchmark: { internal: ResolvedBand | null; external: ExternalNorm | null } | null;
  leverFamily: string;
  defaultWrite: 'case' | 'sweep' | 'experiment' | 'none';
  blindSpot?: boolean;
  /** True when a library lever was matched (signal + benchmark are library-sourced). */
  libraryMatched: boolean;
  /** Cube source label behind the diagnosed factor, when the engine carried one. */
  cubeProvenance?: string;
}

/**
 * Fetch the resolved lever library for a game (genre selection + per-game
 * data-gate + joined benchmarks). Returns null on any failure so callers can
 * still emit engine-sourced citations rather than aborting the turn.
 */
export async function fetchLibrary(game: string, ctx: ToolContext): Promise<LibraryResolution | null> {
  try {
    return await getJson<LibraryResolution>(`/api/knowledge/levers?game=${encodeURIComponent(game)}`, ctx);
  } catch (err) {
    if (err instanceof ServerClientError) return null;
    return null;
  }
}

/** Find the library lever for a candidate: mapped playbook id first, then exact family. */
function matchLever(candidate: CitableCandidate, library: LibraryResolution | null): LibraryLever | undefined {
  if (!library) return undefined;
  return library.levers.find(
    (l) =>
      (candidate.playbookId != null && l.action.mapsToPlaybookIds?.includes(candidate.playbookId)) ||
      l.action.leverFamily === candidate.lever.family,
  );
}

/** Sensible write default when no library lever matched: cs actuator → care case, else experiment. */
function fallbackWrite(actuator: 'cs' | 'system'): 'case' | 'experiment' {
  return actuator === 'cs' ? 'case' : 'experiment';
}

/** Build a complete citation for a recommend candidate, enriched from the library when matched. */
export function buildCitation(candidate: CitableCandidate, library: LibraryResolution | null): ActionCitation {
  const lever = matchLever(candidate, library);
  const cubeProvenance = candidate.evidenceLink?.source;
  if (lever) {
    return {
      sourceEngine: 'advisor/recommend',
      triggeringSignal: lever.signal,
      benchmark: { internal: lever.benchmark.internal ?? null, external: lever.benchmark.external ?? null },
      leverFamily: candidate.lever.family,
      defaultWrite: lever.defaultWrite,
      ...(lever.blindSpot ? { blindSpot: true } : {}),
      libraryMatched: true,
      ...(cubeProvenance ? { cubeProvenance } : {}),
    };
  }
  return {
    sourceEngine: 'advisor/recommend',
    triggeringSignal:
      candidate.rankReason ?? `factor "${candidate.opportunityFactor}" below baseline (${candidate.lever.description})`,
    benchmark: null,
    leverFamily: candidate.lever.family,
    defaultWrite: fallbackWrite(candidate.lever.actuator),
    libraryMatched: false,
    ...(cubeProvenance ? { cubeProvenance } : {}),
  };
}
