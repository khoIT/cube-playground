/**
 * scaffold_draft tool — wraps the BUILT scaffoldDraft().
 *
 * Turns a ranked candidate into an EDITABLE experiment draft (status always
 * 'draft' — never launches). The draft's headline numbers are validated against
 * the provenance ledger: pass the provenanceId of the recommend result that
 * produced the candidate so the gate can confirm the numbers trace to a tool
 * (the HYBRID "gated Decide" rule). Violations are returned, not hidden.
 */

import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { scaffoldDraft } from '../../handoff-scaffolder.js';
import { validateDraftNumbers } from '../agent-provenance-gate.js';
import type { ExperimentCandidate } from '../../candidate-types.js';
import { ok, fail, provenance, type ToolContext } from './tool-context.js';

const NAME = 'scaffold_draft';

export function makeScaffoldDraftTool(tctx: ToolContext) {
  return tool(
    NAME,
    'Build an EDITABLE experiment draft from a candidate. This never launches — ' +
      'it produces a proposal (cohort, treatment/hold-out arms, window, power, ' +
      'safety guardrails) the manager reviews. Pass the candidate object from ' +
      'recommend and its provenanceId so the draft numbers stay verified.',
    {
      candidate: z.record(z.string(), z.unknown()).describe('an ExperimentCandidate from recommend'),
      addressableN: z.number().describe('cohort size'),
      reachablePct: z.number().optional(),
      windowDays: z.number().optional(),
      treatmentShare: z.number().optional().describe('clamped to ≤0.85 so hold-out ≥15%'),
      provenanceId: z.string().optional().describe('provenanceId of the recommend result'),
    },
    async (args: {
      candidate: Record<string, unknown>;
      addressableN: number;
      reachablePct?: number;
      windowDays?: number;
      treatmentShare?: number;
      provenanceId?: string;
    }) => {
      if (tctx.scope.kind !== 'segment') {
        return fail('a draft needs a segment scope (the cohort is a Segment); diagnose a segment first');
      }
      const candidate = args.candidate as unknown as ExperimentCandidate;
      if (!candidate || typeof candidate.id !== 'string') {
        return fail('candidate must be a full ExperimentCandidate object (with id) from recommend');
      }
      try {
        const draft = scaffoldDraft({
          candidate,
          segmentId: tctx.scope.segmentId,
          gameId: tctx.scope.gameId,
          addressableN: args.addressableN,
          reachablePct: args.reachablePct ?? 0.75,
          windowDays: args.windowDays,
          treatmentShare: args.treatmentShare,
        });
        const violations = validateDraftNumbers(draft, args.provenanceId, tctx.ledger);
        const draftProvenanceId = provenance(tctx, NAME, draft);
        const summary =
          violations.length === 0
            ? `Draft scaffolded (status=draft) for segment ${draft.segmentId}. All headline numbers trace to a tool result.`
            : `Draft scaffolded (status=draft), but ${violations.length} number(s) do NOT trace to a tool result ` +
              `(${violations.map((v) => `${v.field}:${v.reason}`).join(', ')}). Re-run the tool that ` +
              `produces them and cite its provenanceId before hand-off.`;
        return ok(summary, { provenanceId: draftProvenanceId, draft, violations });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );
}
