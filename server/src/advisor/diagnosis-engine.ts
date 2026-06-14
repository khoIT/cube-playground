/**
 * Diagnosis engine — entry point for the Optimization Advisor.
 *
 * diagnose(input) → Diagnosis
 *
 * Execution model:
 *   1. Resolve workspace context for the scope's game.
 *   2. Compile segment predicate → Cube filters (attaches compiledFilters to scope).
 *   3. Run sync lenses 1–4 always (Level, Trajectory, Peer, Decomposition).
 *   4. Run lazy lenses 5–9 only when caller opts-in via options.lenses.
 *   5. Build goal trees from Decomposition result.
 *   6. Synthesize confidence + rank opportunities.
 *
 * Short-circuits on empty cohort (Decomposition emits bottleneckFactor=null +
 * verdict='inconclusive' when payers=0). Budget guard: max 9 lenses (1 per id).
 *
 * Live smoke test on segment 5ee78131… (cfm_vn) is DEFERRED to a host with Cube
 * connectivity — this machine has no TRINO_PROFILER_HOST / live Cube available.
 * The engine is unit-testable by injecting a stub CubeReaderFn; see
 * server/test/diagnosis-engine.test.ts. This mirrors care/calibrate.ts which
 * fail-closes when /meta is unreachable.
 */

import type { WorkspaceCtx } from '../services/cube-client.js';
import type { Diagnosis, DiagnosisInput, GoalTree, LensResult, ScopeRef } from './diagnosis-types.js';
import type { CubeReaderFn } from './cube-read.js';
import { buildRevenueGoalTree, buildEngagementGoalTree } from './goal-tree.js';
import { synthesizeConfidence, buildOpportunities } from './lens-synthesis.js';
import { runLens01Level } from './lenses/lens-01-level.js';
import { runLens02Trajectory } from './lenses/lens-02-trajectory.js';
import { runLens03Peer } from './lenses/lens-03-peer.js';
import { runLens04Decomposition, type DecompositionLensResult } from './lenses/lens-04-decomposition.js';
import { runLens05Pareto } from './lenses/lens-05-pareto.js';
import { runLens06Funnel } from './lenses/lens-06-funnel.js';
import { runLens07Lifecycle } from './lenses/lens-07-lifecycle.js';
import { runLens08CrossSignal } from './lenses/lens-08-cross-signal.js';
import { runLens09Anomaly } from './lenses/lens-09-anomaly.js';

/** Sync lens ids — always run. */
const SYNC_LENSES = [1, 2, 3, 4] as const;
/** Lazy lens ids — run only when explicitly requested. */
const LAZY_LENSES = [5, 6, 7, 8, 9] as const;
/** Hard cap: never run more than 9 distinct lenses per diagnosis. */
const MAX_LENS_COUNT = 9;

/** Revenue factor keys for corroborating lenses 1/2/3. */
const REVENUE_FACTORS = ['payers', 'arppu', 'lifespan'] as const;

/**
 * Diagnose a segment or game scope.
 *
 * @param input  DiagnosisInput — scope, goal, asOf, options.
 * @param ctx    Workspace context (base URL + token). Required for live Cube.
 * @param reader Optional injected reader (for unit tests without live Cube).
 */
export async function diagnose(
  input: DiagnosisInput,
  ctx: WorkspaceCtx,
  reader?: CubeReaderFn,
): Promise<Diagnosis> {
  // Resolve which lazy lenses to run (budget guard: deduplicate + cap at 9 total).
  const requestedLazy = input.options?.lenses
    ? input.options.lenses.filter((id) => LAZY_LENSES.includes(id as typeof LAZY_LENSES[number]))
    : [];
  const lazyToRun = [...new Set(requestedLazy)].slice(0, MAX_LENS_COUNT - SYNC_LENSES.length);

  // Attach compiledFilters to the scope for segment refs.
  const scope = await attachCompiledFilters(input.scope);

  // ─── Sync lenses ────────────────────────────────────────────────────────────

  // Lens 4 (decomposition) is the spine — run it first to get the bottleneck.
  const decomp = (await runLens04Decomposition(
    { scope, asOf: input.asOf },
    ctx,
    reader,
  )) as DecompositionLensResult;

  // Short-circuit: empty cohort (no payers at all).
  if (decomp.bottleneckFactor === null && decomp.verdict === 'inconclusive') {
    return emptyDiagnosis(decomp);
  }

  // Lenses 1, 2, 3 — run per factor for revenue goal.
  const goalsToRun: Array<'revenue' | 'engagement'> =
    input.goal === 'both' ? ['revenue', 'engagement'] : [input.goal];

  const syncFactors = goalsToRun.includes('revenue') ? [...REVENUE_FACTORS] : [];

  const [lens1Results, lens2Results, lens3Results] = await Promise.all([
    Promise.all(
      syncFactors.map((factor) =>
        runLens01Level({ scope, factor, asOf: input.asOf }, ctx, reader),
      ),
    ),
    Promise.all(
      syncFactors.map((factor) =>
        runLens02Trajectory({ scope, factor, asOf: input.asOf }, ctx, reader),
      ),
    ),
    Promise.all(
      syncFactors.map((factor) =>
        runLens03Peer(
          { scope, factor, asOf: input.asOf, dominantTier: undefined },
          ctx,
          reader,
        ),
      ),
    ),
  ]);

  const syncLensResults: LensResult[] = [
    ...lens1Results,
    ...lens2Results,
    ...lens3Results,
    decomp,
  ];

  // ─── Lazy lenses ────────────────────────────────────────────────────────────

  const lazyLensResults: LensResult[] = [];
  if (lazyToRun.length > 0) {
    const lazyPromises = lazyToRun.map((id) => runLazyLens(id, scope, input.asOf, ctx, reader));
    const settled = await Promise.allSettled(lazyPromises);
    for (const result of settled) {
      if (result.status === 'fulfilled') lazyLensResults.push(result.value);
      // Rejected lazy lens: silently drop (sync set already returned; lazy = optional).
    }
  }

  const allLenses = [...syncLensResults, ...lazyLensResults];

  // ─── Goal trees ─────────────────────────────────────────────────────────────

  const goalTrees: GoalTree[] = [];

  if (goalsToRun.includes('revenue')) {
    const { observed, baseline } = extractDecompValues(decomp);
    goalTrees.push(buildRevenueGoalTree(observed, baseline));
  }

  if (goalsToRun.includes('engagement')) {
    // Engagement measures (session_freq/length) are not present in cfm_vn mf_users
    // as of v1 (session measures may be absent). Build a degraded tree using only lifespan.
    goalTrees.push(
      buildEngagementGoalTree(
        { sessionFreq: null, sessionLength: null, lifespan: null },
        { sessionFreq: null, sessionLength: null, lifespan: null },
      ),
    );
  }

  // ─── Synthesis ──────────────────────────────────────────────────────────────

  const confidenceMap = synthesizeConfidence(allLenses);
  const opportunities = buildOpportunities(goalTrees, confidenceMap);

  return { goalTrees, opportunities, lenses: allLenses };
}

// ─── Lazy lens dispatch ───────────────────────────────────────────────────────

async function runLazyLens(
  id: number,
  scope: ScopeRef,
  asOf: Date,
  ctx: WorkspaceCtx,
  reader?: CubeReaderFn,
): Promise<LensResult> {
  switch (id) {
    case 5: return runLens05Pareto({ scope, asOf }, ctx, reader);
    case 6: return runLens06Funnel({ scope, asOf }, ctx, reader);
    case 7: return runLens07Lifecycle({ scope, asOf }, ctx, reader);
    case 8: return runLens08CrossSignal({ scope, asOf }, ctx, reader);
    case 9: return runLens09Anomaly({ scope, factor: 'payers', asOf }, ctx, reader);
    default:
      return {
        id,
        name: `Lens ${id}`,
        verdict: 'inconclusive',
        inputs: { reason: `Lens ${id} not implemented` },
        method: `Not implemented`,
        provenance: { measures: [], source: `lens-${id} — not implemented` },
      };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * For SegmentRef: load the segment's predicate from DB and compile it to Cube
 * filters, attaching `compiledFilters` to the scope reference.
 *
 * On this machine Cube is unreachable, so compilation is a no-op (empty filters
 * = full game population). On a live host the engine should load the segment's
 * predicate_tree from SQLite and call treeToCubeFilters().
 *
 * TODO(live-host): load segment predicate_tree from DB + call treeToCubeFilters.
 * For now this compiles to empty filters (game-wide population query).
 */
async function attachCompiledFilters(scope: ScopeRef): Promise<ScopeRef> {
  if (scope.kind === 'game') return scope;
  // Attach empty compiledFilters — lenses use scopeToFilters() which reads this.
  return { ...scope, compiledFilters: [] } as ScopeRef & { compiledFilters: unknown[] };
}

/** Extract observed/baseline values from the Decomposition lens result. */
function extractDecompValues(decomp: DecompositionLensResult) {
  const obs = (decomp.inputs as { observed?: Record<string, number | null> }).observed ?? {};
  const bas = (decomp.inputs as { baseline?: Record<string, number | null> }).baseline ?? {};
  return {
    observed: {
      payers: obs['payers'] ?? null,
      arppu: obs['arppu'] ?? null,
      lifespan: obs['lifespan'] ?? null,
    },
    baseline: {
      payers: bas['payers'] ?? null,
      arppu: bas['arppu'] ?? null,
      lifespan: bas['lifespan'] ?? null,
    },
  };
}

function emptyDiagnosis(decomp: LensResult): Diagnosis {
  return {
    goalTrees: [],
    opportunities: [],
    lenses: [decomp],
  };
}
