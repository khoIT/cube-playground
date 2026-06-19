/**
 * Tool: decompose_metric
 *
 * Thin wrapper over the server's deterministic diagnosis engine
 * (POST /api/advisor/diagnose). It decomposes a goal (revenue / engagement)
 * into its growth-accounting factors, runs the descriptive lenses, and returns
 * ranked opportunities — each with the gap vs baseline, a confidence score
 * (how many independent lenses agree the factor is weak), and Cube provenance.
 *
 * This tool NEVER reimplements decomposition: the engine is the single source
 * of truth and the only thing that touches live Cube data. The chat model
 * narrates the returned opportunities into a benchmark-aware conclusion.
 *
 * Latency: sync lenses 1–4 only (~3–5s, fits a turn). `deeper:true` opts into
 * the expensive lenses 5–9 — never auto-run.
 *
 * Failure handling mirrors propose_segment: every error path returns ok:false
 * with a machine reason so the model can explain rather than crash.
 */

import { z } from 'zod';
import { postJson, ServerClientError } from '../services/server-client.js';
import type { ToolContext } from '../types.js';

export const name = 'decompose_metric';
export const description =
  'Decompose a revenue or engagement goal into its driving factors and rank the ' +
  'weakest ones, via the deterministic diagnosis engine. Returns goal trees ' +
  '(factor value vs population baseline), ranked opportunities (factor, gap%, gap ' +
  'value, confidence = agreeing lenses), lens evidence, and Cube provenance. ' +
  'Use for "why did X drop/spike" questions before concluding. Defaults to the ' +
  'fast lenses; pass deeper:true only when the fast pass is inconclusive. ' +
  'Read-only — never writes. If the advisor feature is off it returns ' +
  'ok:false reason:"advisor-disabled" so you can explain and fall back.';

export const inputSchema = {
  game_id: z.string().min(1).describe('Game id, e.g. "cfm_vn"'),
  scope_kind: z
    .enum(['game', 'segment'])
    .default('game')
    .describe('Diagnose the whole game population, or a specific segment.'),
  segment_id: z
    .string()
    .optional()
    .describe('Required when scope_kind="segment". The segment uuid.'),
  goal: z
    .enum(['revenue', 'engagement', 'both'])
    .default('both')
    .describe('Which goal tree(s) to decompose.'),
  as_of: z
    .string()
    .optional()
    .describe('ISO date anchor for the comparison window. Omit for "now".'),
  deeper: z
    .boolean()
    .default(false)
    .describe(
      'Run the expensive lenses (5–9) in addition to the fast ones. Only set ' +
        'true on an explicit "dig deeper" follow-up — it adds latency.',
    ),
};

// ── Engine response (subset we consume) ──────────────────────────────────────

interface Factor {
  key: string;
  label: string;
  value: number | null;
  baseline: number | null;
  weak: boolean;
  unit?: string;
}
interface GoalTree {
  goal: 'revenue' | 'engagement';
  factors: Factor[];
  degraded?: boolean;
  degradedNote?: string;
}
interface Opportunity {
  factor: string;
  gapPct: number;
  gapValue: number;
  confidence: number;
  agreeingLenses: number[];
}
interface LensResult {
  id: number;
  name: string;
  verdict: string;
  factor?: string;
  method: string;
  provenance?: { cube?: string; source: string; rows?: number };
}
interface Diagnosis {
  goalTrees: GoalTree[];
  opportunities: Opportunity[];
  lenses: LensResult[];
  blocked?: { reason: string };
}

// ── Trimmed return shapes ─────────────────────────────────────────────────────

type LensEvidence = { id: number; name: string; verdict: string; factor?: string; method: string };

type OkResult = {
  ok: true;
  goalTrees: GoalTree[];
  opportunities: Opportunity[];
  lensEvidence: LensEvidence[];
  /** Distinct human-readable Cube source labels — the citation substrate. */
  provenance: string[];
  /** Set when the engine could not compute (data/model failure), not "healthy". */
  blocked?: { reason: string };
};
type ErrResult = {
  ok: false;
  reason: 'advisor-disabled' | 'invalid-scope' | 'engine-unavailable';
  detail?: unknown;
};

export async function handler(
  args: {
    game_id: string;
    scope_kind?: 'game' | 'segment';
    segment_id?: string;
    goal?: 'revenue' | 'engagement' | 'both';
    as_of?: string;
    deeper?: boolean;
  },
  ctx: ToolContext,
): Promise<OkResult | ErrResult> {
  const scopeKind = args.scope_kind ?? 'game';
  if (scopeKind === 'segment' && !args.segment_id) {
    return { ok: false, reason: 'invalid-scope', detail: 'segment_id is required when scope_kind="segment"' };
  }

  const scope =
    scopeKind === 'segment'
      ? { kind: 'segment', gameId: args.game_id, segmentId: args.segment_id }
      : { kind: 'game', gameId: args.game_id };

  const body: Record<string, unknown> = { scope, goal: args.goal ?? 'both' };
  if (args.as_of) body.asOf = args.as_of;
  // Fast lenses (1–4) are the default; deeper adds the lazy lenses.
  if (args.deeper) body.lenses = [1, 2, 3, 4, 5, 6, 7, 8, 9];

  try {
    const d = await postJson<Diagnosis>('/api/advisor/diagnose', body, ctx);
    const lensEvidence: LensEvidence[] = (d.lenses ?? []).map((l) => ({
      id: l.id,
      name: l.name,
      verdict: l.verdict,
      ...(l.factor ? { factor: l.factor } : {}),
      method: l.method,
    }));
    const provenance = [
      ...new Set((d.lenses ?? []).map((l) => l.provenance?.source).filter((s): s is string => !!s)),
    ];
    return {
      ok: true,
      goalTrees: d.goalTrees ?? [],
      opportunities: d.opportunities ?? [],
      lensEvidence,
      provenance,
      ...(d.blocked ? { blocked: d.blocked } : {}),
    };
  } catch (err) {
    if (err instanceof ServerClientError) {
      if (err.status === 403) return { ok: false, reason: 'advisor-disabled', detail: err.body };
      if (err.status === 400) return { ok: false, reason: 'invalid-scope', detail: err.body };
      return { ok: false, reason: 'engine-unavailable', detail: { status: err.status, body: err.body } };
    }
    return { ok: false, reason: 'engine-unavailable', detail: String(err) };
  }
}
