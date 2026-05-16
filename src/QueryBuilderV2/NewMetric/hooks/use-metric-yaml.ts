import { useMemo } from 'react';
import { NewMetricDraft } from '../types';
import { ReachableMember } from './use-reachable-members';
import { generate, GenerateContext } from '../yaml/generate-measure-yaml';

type UseMetricYamlCtx = {
  sourceCube: string;
  reachableMembers: ReachableMember[];
  peerMeasureNames: string[];
};

type UseMetricYamlResult = {
  yaml: string;
  fragment: string;
  error: string | null;
};

const EMPTY: UseMetricYamlResult = { yaml: '', fragment: '', error: null };

/**
 * Memoised wrapper around generate().
 * Returns empty strings when the draft is not yet ready (no sourceCube or ofMember).
 */
export function useMetricYaml(
  draft: NewMetricDraft,
  ctx: UseMetricYamlCtx
): UseMetricYamlResult {
  return useMemo(() => {
    if (!draft.sourceCube || !draft.ofMember) return EMPTY;
    if (draft.operation === 'ratio' && !draft.ofMemberB) return EMPTY;

    try {
      const genCtx: GenerateContext = {
        sourceCube: ctx.sourceCube,
        reachableMembers: ctx.reachableMembers,
        peerMeasureNames: ctx.peerMeasureNames,
      };
      return { ...generate(draft, genCtx), error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { yaml: '', fragment: '', error: message };
    }
  }, [
    draft.sourceCube,
    draft.operation,
    draft.ofMember,
    draft.ofMemberB,
    draft.filter,
    draft.name,
    draft.title,
    draft.description,
    draft.format,
    ctx.sourceCube,
    ctx.reachableMembers,
    ctx.peerMeasureNames,
  ]);
}
