/**
 * Tool: recommend_actions
 *
 * Wraps the server's Recommend posture (POST /api/advisor/recommend), which
 * runs diagnose → rank into experiment candidates deterministically. Each
 * returned candidate is enriched with a citation (engine + triggering signal +
 * dual benchmark + lever family + write default) via the shared citation
 * builder, and the game's withheld levers + structural blind spots are surfaced
 * so the model can name what it CANNOT recommend rather than guessing.
 *
 * Read-only — proposes, never writes. The write itself is confirm-gated and
 * lives downstream; this tool only carries each action's `defaultWrite` hint.
 *
 * Failure handling mirrors propose_segment: every error path returns ok:false
 * with a machine reason. recommend can be heavier than a plain read, so the
 * call is bounded by a client timeout → ok:false rather than a hung turn.
 */

import { z } from 'zod';
import { postJson, ServerClientError } from '../services/server-client.js';
import type { ToolContext } from '../types.js';
import { fetchLibrary, buildCitation, type CitableCandidate, type ActionCitation } from './recommendation-citation.js';

export const name = 'recommend_actions';
export const description =
  'Recommend ranked, cited actions for a game or segment: runs the diagnosis + ' +
  'candidate ranker, then attaches to each candidate its triggering signal, dual ' +
  'benchmark (internal percentile + external norm), lever family, and a ' +
  'confirm-gated write default (care case / sweep / experiment). Also surfaces ' +
  'levers withheld for missing data and structural blind spots. Read-only — it ' +
  'proposes; it never writes. For a whole-game scope you MUST pass ' +
  'params.addressableN (the cohort size to act on); for a segment it is derived. ' +
  'Returns ok:false reason:"advisor-disabled" when the feature is off.';

const ParamsSchema = z
  .object({
    addressableN: z.number().int().positive().optional().describe('Cohort size to address. Required for whole-game scope.'),
    reachablePct: z.number().min(0).max(1).optional().describe('Fraction of the cohort reachable (0–1). Default 0.75.'),
    windowDays: z.number().int().positive().optional().describe('Experiment window in days. Default 14.'),
    baselineRate: z.number().min(0).max(1).optional().describe('Baseline conversion rate for the power check. Default 0.4.'),
    valuePerUnitVnd: z.number().optional().describe('₫ per addressed unit; omit to leave money TBD.'),
    phrase: z.boolean().optional().describe('Run the LLM phrasing pass on top candidates (adds latency).'),
    phraseTopN: z.number().int().positive().optional().describe('How many top candidates to phrase. Default 3.'),
  })
  .optional();

export const inputSchema = {
  game_id: z.string().min(1).describe('Game id, e.g. "cfm_vn"'),
  scope_kind: z.enum(['game', 'segment']).default('game').describe('Whole game population, or a segment.'),
  segment_id: z.string().optional().describe('Required when scope_kind="segment".'),
  goal: z.enum(['revenue', 'engagement', 'both']).default('both'),
  as_of: z.string().optional().describe('ISO date anchor. Omit for "now".'),
  params: ParamsSchema,
};

const TIMEOUT_MS = 60_000;

interface RankedCandidate extends CitableCandidate {
  id: string;
  feasibility?: { status: string; why?: string; substitute?: string };
  power?: { status: string; mde: number; detail: string };
  expectedEffect?: { value: number; confidence: string; source: string };
  money?: { incrementalVnd: number | null; perUnitVnd: number | null; note: string; currency?: string };
  score?: number;
  hypotheses?: string[];
}
interface Recommendation {
  diagnosis: { opportunities?: unknown[]; blocked?: { reason: string } };
  candidates: RankedCandidate[];
}

type CitedCandidate = RankedCandidate & { citation: ActionCitation };
type OkResult = {
  ok: true;
  candidates: CitedCandidate[];
  withheld: Array<{ id: string; lever: string; missingCubes: string[] }>;
  blindSpots: Array<{ id: string; lever: string; signal: string }>;
  blocked?: { reason: string };
};
type ErrResult = {
  ok: false;
  reason: 'advisor-disabled' | 'invalid-scope' | 'addressable-n-required' | 'engine-unavailable';
  detail?: unknown;
};

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)),
  ]);
}

export async function handler(
  args: {
    game_id: string;
    scope_kind?: 'game' | 'segment';
    segment_id?: string;
    goal?: 'revenue' | 'engagement' | 'both';
    as_of?: string;
    params?: {
      addressableN?: number;
      reachablePct?: number;
      windowDays?: number;
      baselineRate?: number;
      valuePerUnitVnd?: number;
      phrase?: boolean;
      phraseTopN?: number;
    };
  },
  ctx: ToolContext,
): Promise<OkResult | ErrResult> {
  const scopeKind = args.scope_kind ?? 'game';
  if (scopeKind === 'segment' && !args.segment_id) {
    return { ok: false, reason: 'invalid-scope', detail: 'segment_id is required when scope_kind="segment"' };
  }
  // Whole-game scope cannot derive a cohort size — require it rather than invent one.
  if (scopeKind === 'game' && !args.params?.addressableN) {
    return {
      ok: false,
      reason: 'addressable-n-required',
      detail: 'For a whole-game scope, pass params.addressableN (the cohort size to act on). For a segment, use scope_kind="segment".',
    };
  }

  const scope =
    scopeKind === 'segment'
      ? { kind: 'segment', gameId: args.game_id, segmentId: args.segment_id }
      : { kind: 'game', gameId: args.game_id };
  const body: Record<string, unknown> = { scope, goal: args.goal ?? 'both', params: args.params ?? {} };
  if (args.as_of) body.asOf = args.as_of;

  let rec: Recommendation;
  try {
    rec = await withTimeout(postJson<Recommendation>('/api/advisor/recommend', body, ctx), TIMEOUT_MS);
  } catch (err) {
    if (err instanceof ServerClientError) {
      if (err.status === 403) return { ok: false, reason: 'advisor-disabled', detail: err.body };
      if (err.status === 400) return { ok: false, reason: 'invalid-scope', detail: err.body };
      return { ok: false, reason: 'engine-unavailable', detail: { status: err.status, body: err.body } };
    }
    return { ok: false, reason: 'engine-unavailable', detail: String(err) };
  }

  // One library fetch per call; join in memory for every candidate.
  const library = await fetchLibrary(args.game_id, ctx);
  const candidates: CitedCandidate[] = (rec.candidates ?? []).map((c) => ({
    ...c,
    citation: buildCitation(c, library),
  }));

  return {
    ok: true,
    candidates,
    withheld: library?.withheld ?? [],
    blindSpots: (library?.blindSpots ?? []).map((b) => ({ id: b.id, lever: b.lever, signal: b.signal })),
    ...(rec.diagnosis?.blocked ? { blocked: rec.diagnosis.blocked } : {}),
  };
}
