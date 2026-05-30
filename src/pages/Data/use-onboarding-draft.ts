/**
 * useOnboardingDraft — THE shared engine behind the triage canvas. Holds the
 * draft model, derives the decision queue (low-confidence inferences that need
 * an explicit call) from the high-confidence auto-mapped ones, projects the
 * live YAML, and owns the validate/approve lifecycle. All three triage view
 * renderers (queue / graph / chat) read & mutate this one state, so resolving a
 * decision in any view updates everywhere. Modeled on `use-drift-center.ts` /
 * `use-metric-coverage.ts`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { onboardingClient } from '../../api/onboarding-client';
import type {
  DraftModelRow,
  InferredField,
  InferredJoin,
  ValidateResponse,
} from '../../api/onboarding-client';

/** Below this, an inference must be explicitly accepted; at/above it auto-maps. */
export const CONFIDENCE_THRESHOLD = 0.8;

export type DecisionKind = 'field' | 'join';
export type DecisionState = 'open' | 'accepted' | 'rejected';

export interface Decision {
  /** Stable id: `${cube}.${column}` for fields, `${cube}.join.${toCube}` for joins. */
  id: string;
  kind: DecisionKind;
  cube: string;
  /** Human label, e.g. "How should revenue_usd aggregate?" */
  title: string;
  /** Short context line shown under the title. */
  detail: string;
  confidence: number;
  rationale: string;
  field?: InferredField;
  join?: InferredJoin;
  state: DecisionState;
}

export interface UseOnboardingDraftResult {
  draft: DraftModelRow | null;
  loading: boolean;
  error: string | null;
  /** Low-confidence calls (the queue). */
  decisions: Decision[];
  openCount: number;
  autoMappedCount: number;
  /** Live YAML projection of the current draft. */
  yaml: string;
  resolve: (id: string, state: DecisionState) => void;
  acceptAllHighConfidence: () => void;
  validating: boolean;
  validation: ValidateResponse | null;
  validate: () => Promise<void>;
  staging: boolean;
  staged: boolean;
  stageForApproval: () => Promise<void>;
  refetch: () => Promise<void>;
}

function fieldDecisionTitle(f: InferredField): string {
  if (f.role === 'measure') return `How should ${f.column} aggregate?`;
  if (f.role === 'dimension') return `Is ${f.column} a dimension?`;
  if (f.role === 'time') return `Is ${f.column} a time dimension?`;
  if (f.role === 'ignore') return `Ignore ${f.column}?`;
  return `Role for ${f.column}?`;
}

/** Derive the decision queue from the draft's inference. Pure. */
function deriveDecisions(draft: DraftModelRow | null): Decision[] {
  if (!draft?.inference) return [];
  const out: Decision[] = [];
  for (const cube of draft.inference.cubes) {
    for (const f of cube.fields) {
      if (f.role === 'primary_key') continue; // structural, never a question
      if (f.confidence >= CONFIDENCE_THRESHOLD) continue; // auto-mapped
      out.push({
        id: `${cube.name}.${f.column}`,
        kind: 'field',
        cube: cube.name,
        title: fieldDecisionTitle(f),
        detail:
          f.role === 'measure'
            ? `Numeric${f.agg ? ` · suggested ${f.agg.toUpperCase()}` : ''}`
            : `${f.dataType} → ${f.role}`,
        confidence: f.confidence,
        rationale: f.rationale,
        field: f,
        state: 'open',
      });
    }
    for (const j of cube.joins) {
      if (j.confidence >= CONFIDENCE_THRESHOLD) continue;
      out.push({
        id: `${cube.name}.join.${j.toCube}`,
        kind: 'join',
        cube: cube.name,
        title: `Join ${cube.name}.${j.fromColumn} → ${j.toCube}.${j.toColumn}?`,
        detail: `Relationship: ${j.relationship}`,
        confidence: j.confidence,
        rationale: j.rationale,
        join: j,
        state: 'open',
      });
    }
  }
  return out;
}

function countAutoMapped(draft: DraftModelRow | null): number {
  if (!draft?.inference) return 0;
  let n = 0;
  for (const cube of draft.inference.cubes) {
    for (const f of cube.fields) {
      if (f.role === 'primary_key' || f.confidence >= CONFIDENCE_THRESHOLD) n += 1;
    }
    for (const j of cube.joins) if (j.confidence >= CONFIDENCE_THRESHOLD) n += 1;
  }
  return n;
}

export function useOnboardingDraft(draftId: string | null | undefined): UseOnboardingDraftResult {
  const [draft, setDraft] = useState<DraftModelRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Decision overrides keyed by decision id. Derived decisions start 'open';
  // a user resolution is stored here so every view reflects it immediately.
  const [overrides, setOverrides] = useState<Record<string, DecisionState>>({});

  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<ValidateResponse | null>(null);
  const [staging, setStaging] = useState(false);
  const [staged, setStaged] = useState(false);

  const refetch = useCallback(async () => {
    if (!draftId) {
      setDraft(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await onboardingClient.draft(draftId);
      setDraft(res.draft);
      setStaged(res.draft.status !== 'pending');
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [draftId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const baseDecisions = useMemo(() => deriveDecisions(draft), [draft]);
  const decisions = useMemo<Decision[]>(
    () => baseDecisions.map((d) => ({ ...d, state: overrides[d.id] ?? d.state })),
    [baseDecisions, overrides],
  );

  const openCount = useMemo(() => decisions.filter((d) => d.state === 'open').length, [decisions]);
  const autoMappedCount = useMemo(() => countAutoMapped(draft), [draft]);

  // The server-rendered YAML is authoritative; we annotate still-open decisions
  // inline so the live pane shows what's pending without re-serialising here.
  const yaml = draft?.yaml ?? '';

  const resolve = useCallback((id: string, state: DecisionState) => {
    setOverrides((prev) => ({ ...prev, [id]: state }));
  }, []);

  const acceptAllHighConfidence = useCallback(() => {
    setOverrides((prev) => {
      const next = { ...prev };
      for (const d of baseDecisions) {
        if (!(d.id in next)) next[d.id] = d.confidence >= CONFIDENCE_THRESHOLD ? 'accepted' : next[d.id] ?? 'open';
      }
      return next;
    });
  }, [baseDecisions]);

  const validate = useCallback(async () => {
    if (!draftId) return;
    setValidating(true);
    try {
      const res = await onboardingClient.validate(draftId);
      setValidation(res);
    } catch (err) {
      setValidation({ structural: { ok: false, cubes: 0 }, live: { ok: false, error: (err as Error).message } });
    } finally {
      setValidating(false);
    }
  }, [draftId]);

  const stageForApproval = useCallback(async () => {
    if (!draftId) return;
    setStaging(true);
    try {
      await onboardingClient.accept(draftId);
      setStaged(true);
      await refetch();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStaging(false);
    }
  }, [draftId, refetch]);

  return {
    draft,
    loading,
    error,
    decisions,
    openCount,
    autoMappedCount,
    yaml,
    resolve,
    acceptAllHighConfidence,
    validating,
    validation,
    validate,
    staging,
    staged,
    stageForApproval,
    refetch,
  };
}
