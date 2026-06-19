/**
 * Tool: propose_action
 *
 * Proposes a confirm-gated write for an accepted recommendation. It emits an
 * `action_proposal` SSE event the frontend renders as a confirm card; the WRITE
 * itself (care case create / cohort sweep / experiment draft+assign) happens
 * only on explicit user confirm. This tool NEVER calls a write endpoint — the
 * "chat proposes, the user confirms" invariant is the whole point of the loop.
 *
 * Validation guards (all return ok:false so the model can explain, never
 * fabricate a write): the action `kind` must be consistent with the
 * recommendation's `defaultWrite`, and a `defaultWrite` of "none" (a blind spot
 * or non-actionable factor) can never be proposed as an action.
 */

import { z } from 'zod';
import type { ToolContext } from '../types.js';

export const name = 'propose_action';
export const description =
  'Propose a confirm-gated action for an accepted recommendation: emits a ' +
  'confirm card the user must approve. It NEVER writes — the user confirms and ' +
  'the frontend performs the write. kind="care_case" opens a single playbook ' +
  'case (one confirm); "sweep" materializes a cohort (TWO confirms — accept, ' +
  'then run); "experiment" drafts a test (TWO confirms — accept, then assign). ' +
  'Pass the recommendation\'s citation (from recommend_actions) so the card is ' +
  'cited. Returns ok:false when the kind is inconsistent with the lever\'s ' +
  'write default or the factor is not actionable.';

// Which proposal kinds are consistent with each defaultWrite. A 'case' default
// may escalate to a cohort sweep; a 'sweep' default may also open a single case.
// 'none' (blind spot / non-actionable) admits nothing.
const ALLOWED_KINDS: Record<string, Array<'care_case' | 'sweep' | 'experiment'>> = {
  case: ['care_case', 'sweep'],
  sweep: ['sweep', 'care_case'],
  experiment: ['experiment'],
  none: [],
};

const CitationSchema = z.object({
  sourceEngine: z.string().min(1),
  triggeringSignal: z.string().min(1),
  benchmark: z
    .object({ internal: z.unknown().nullable(), external: z.unknown().nullable() })
    .nullable()
    .optional(),
  defaultWrite: z.enum(['case', 'sweep', 'experiment', 'none']),
});

export const inputSchema = {
  game_id: z.string().min(1).describe('Game id, e.g. "cfm_vn"'),
  kind: z
    .enum(['care_case', 'sweep', 'experiment'])
    .describe('care_case = single playbook case; sweep = cohort (two confirms); experiment = draft+assign (two confirms).'),
  lever_family: z.string().min(1).describe('The lever family this action targets, from the recommendation.'),
  playbook_id: z.string().optional().describe('Required for care_case; optional for sweep (cohort).'),
  title: z.string().min(1).describe('Short action label, e.g. "Open first-deposit care case".'),
  summary: z.string().min(1).describe('Cited one-line framing of why this action.'),
  recommendation: z
    .object({ citation: CitationSchema })
    .describe('The recommend_actions candidate being accepted — pass its citation verbatim.'),
  params: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Passthrough params the FE forwards to the write (segmentId, windowDays, addressableN, …).'),
};

type OkResult = { ok: true; proposal_emitted: true; kind: 'care_case' | 'sweep' | 'experiment' };
type ErrResult = { ok: false; reason: 'not-actionable' | 'kind-mismatch' | 'missing-playbook'; detail?: string };

export async function handler(
  args: {
    game_id: string;
    kind: 'care_case' | 'sweep' | 'experiment';
    lever_family: string;
    playbook_id?: string;
    title: string;
    summary: string;
    recommendation: { citation: z.infer<typeof CitationSchema> };
    params?: Record<string, unknown>;
  },
  ctx: ToolContext,
): Promise<OkResult | ErrResult> {
  const { defaultWrite } = args.recommendation.citation;

  // A non-actionable factor (blind spot / no lever) must never become an action.
  if (defaultWrite === 'none') {
    return { ok: false, reason: 'not-actionable', detail: 'This factor has no actionable lever (blind spot or no data path).' };
  }
  // The requested kind must be consistent with the lever's write default.
  if (!ALLOWED_KINDS[defaultWrite]?.includes(args.kind)) {
    return {
      ok: false,
      reason: 'kind-mismatch',
      detail: `kind="${args.kind}" is not consistent with the recommendation's defaultWrite="${defaultWrite}".`,
    };
  }
  // A single care case is keyed to one playbook — require it so the FE write is unambiguous.
  if (args.kind === 'care_case' && !args.playbook_id) {
    return { ok: false, reason: 'missing-playbook', detail: 'playbook_id is required for kind="care_case".' };
  }

  // Sweep (cohort mutation) and experiment (split freeze) demand a second
  // explicit confirm; a single playbook case is one confirm.
  const confirmSteps: 1 | 2 = args.kind === 'care_case' ? 1 : 2;

  ctx.sseEmitter.emit('action_proposal', {
    type: 'action_proposal',
    game_id: args.game_id,
    kind: args.kind,
    leverFamily: args.lever_family,
    ...(args.playbook_id ? { playbookId: args.playbook_id } : {}),
    title: args.title,
    summary: args.summary,
    citation: {
      sourceEngine: args.recommendation.citation.sourceEngine,
      triggeringSignal: args.recommendation.citation.triggeringSignal,
      benchmark: args.recommendation.citation.benchmark ?? null,
      defaultWrite,
    },
    confirmSteps,
    ...(args.params ? { params: args.params } : {}),
  });

  return { ok: true, proposal_emitted: true, kind: args.kind };
}
