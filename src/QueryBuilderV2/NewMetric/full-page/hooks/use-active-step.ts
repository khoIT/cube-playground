import { useEffect, useMemo, useState } from 'react';
import type { ArtifactKind, NewMetricDraftV3 } from '../../types';
import { isEmpty as isFilterTreeEmpty } from '../../filter-tree';
import { findOp } from '../steps/step-2-operation/operations';

// ---------------------------------------------------------------------------
// Per-kind step graph
// ---------------------------------------------------------------------------
//
// The wizard renders a different sequence of screens per `artifactKind`.
// `stepGraphFor(kind)` returns the ordered step list; `useActiveStep` maps
// the active local index to a step config and drives the LeftRail chips,
// `next`/`back`/`canGoTo` gating, and `doneFlags`.

export type ArtifactStepId =
  | 'kind'
  | 'source'
  | 'op'
  | 'column'
  | 'filters'
  | 'identity'
  | 'test-run'
  | 'dim-kind'
  | 'builder'
  | 'filter-tree';

export type StepConfig = {
  id: ArtifactStepId;
  name: string;
  sub?: string;
};

const STEP_DEFS: Record<ArtifactStepId, { name: string; sub?: string }> = {
  kind: { name: 'Kind', sub: 'Measure / dimension / segment' },
  source: { name: 'Source', sub: 'Pick a cube or view' },
  op: { name: 'Operation', sub: 'Aggregation type' },
  column: { name: 'Column', sub: 'Field to measure' },
  filters: { name: 'Filters', sub: 'Narrow rows (optional)' },
  identity: { name: 'Identity', sub: 'Name & format' },
  'test-run': { name: 'Test run', sub: 'Run on real data' },
  'dim-kind': { name: 'Dim kind', sub: 'Banding / time-since / passthrough / boolean' },
  builder: { name: 'Builder', sub: 'Configure the dimension' },
  'filter-tree': { name: 'Filter tree', sub: 'Define the segment WHERE' },
};

const KIND_STEP_IDS: Record<ArtifactKind, ArtifactStepId[]> = {
  measure: ['kind', 'source', 'op', 'column', 'filters', 'identity', 'test-run'],
  dimension: ['kind', 'source', 'dim-kind', 'builder', 'identity', 'test-run'],
  segment: ['kind', 'source', 'filter-tree', 'identity', 'test-run'],
};

export function stepGraphFor(kind: ArtifactKind): StepConfig[] {
  return KIND_STEP_IDS[kind].map((id) => ({ id, ...STEP_DEFS[id] }));
}

// Plain number — was 1..6, now 0..N-1 with N varying per kind.
export type StepIndex = number;

// ---------------------------------------------------------------------------
// Per-step gating
// ---------------------------------------------------------------------------

function hasAllRequiredInputs(draft: NewMetricDraftV3): boolean {
  const op = findOp(draft.operation);
  if (!op) return false;
  return op.inputs.every((slot) => !slot.required || !!draft.inputs[slot.id]);
}

function dimBuilderLooksValid(draft: NewMetricDraftV3): boolean {
  const b = draft.dimBuilder;
  if (!b) return false;
  switch (b.kind) {
    case 'banding':
      return !!b.column && b.bands.length > 0;
    case 'time-since':
      return !!b.timeColumn;
    case 'passthrough':
      return !!b.column;
    case 'boolean':
      return !!b.predicate;
    default:
      return false;
  }
}

function computeDoneFlags(
  draft: NewMetricDraftV3,
  graph: StepConfig[],
  step: number
): boolean[] {
  return graph.map((cfg, i) => {
    switch (cfg.id) {
      case 'kind':
        return true; // kind always has a value (defaults to 'measure')
      case 'source':
        return draft.sourceCubes.length >= 1;
      case 'op':
        return !!draft.operation;
      case 'column':
        return draft.operation === 'count' || hasAllRequiredInputs(draft);
      case 'filters':
        // optional step — counts as "done" once user has moved past it
        return step > i;
      case 'dim-kind':
        return !!draft.dimKind;
      case 'builder':
        return dimBuilderLooksValid(draft);
      case 'filter-tree':
        return !isFilterTreeEmpty(draft.filterTree);
      case 'identity':
        return !!draft.name && !!draft.title;
      case 'test-run':
        return false; // test-run is "done" only after submit, handled elsewhere
      default:
        return false;
    }
  });
}

function canReachStep(
  draft: NewMetricDraftV3,
  graph: StepConfig[],
  target: number
): boolean {
  if (target <= 0) return true;
  for (let i = 0; i < target; i++) {
    const cfg = graph[i];
    if (!cfg) return false;
    switch (cfg.id) {
      case 'kind':
        break; // always reachable
      case 'source':
        if (draft.sourceCubes.length < 1) return false;
        break;
      case 'op':
        if (!draft.operation) return false;
        break;
      case 'column':
        if (draft.operation !== 'count' && !hasAllRequiredInputs(draft)) return false;
        break;
      case 'filters':
        // optional — skipping past it is allowed
        break;
      case 'dim-kind':
        if (!draft.dimKind) return false;
        break;
      case 'builder':
        if (!dimBuilderLooksValid(draft)) return false;
        break;
      case 'filter-tree':
        if (isFilterTreeEmpty(draft.filterTree)) return false;
        break;
      case 'identity':
        if (!draft.name || !draft.title) return false;
        break;
      case 'test-run':
        break;
      default:
        return false;
    }
  }
  return true;
}

function deriveInitialStep(draft: NewMetricDraftV3, graph: StepConfig[]): number {
  // Walk forward through the graph, stopping at the first step whose
  // prerequisites are not yet satisfied. Mirrors the legacy V2 behavior on
  // post-reload hydration (land on the highest reachable step).
  for (let i = 0; i < graph.length; i++) {
    if (!canReachStep(draft, graph, i + 1)) return i;
  }
  return Math.max(0, graph.length - 1);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export type UseActiveStepReturn = {
  step: number;
  setStep: (s: number) => void;
  canGoTo: (s: number) => boolean;
  next: () => void;
  back: () => void;
  totalSteps: number;
  doneFlags: boolean[];
  currentStep: StepConfig;
  graph: StepConfig[];
};

/**
 * Active-step manager. Returns the current step index, the per-kind step
 * graph, navigation helpers, and `doneFlags` for the LeftRail chips.
 *
 * The step graph is derived from `draft.artifactKind`. When the user switches
 * kinds on Step 0 the graph length changes; this hook clamps `step` to the
 * new graph's last valid index so we never render an out-of-range step.
 */
export function useActiveStep(draft: NewMetricDraftV3): UseActiveStepReturn {
  const graph = useMemo(() => stepGraphFor(draft.artifactKind), [draft.artifactKind]);
  const totalSteps = graph.length;

  const [step, setStepRaw] = useState<number>(() => deriveInitialStep(draft, graph));

  // Clamp `step` when the active kind shrinks the graph. Without this, a
  // user on step 5 of measure who switches to segment (5 steps total, 0..4)
  // would attempt to render `graph[5]` and crash. We also re-derive against
  // the new graph so we never land on a step whose prerequisites are unmet
  // for the new kind.
  useEffect(() => {
    const reachableCap = deriveInitialStep(draft, graph);
    if (step > totalSteps - 1 || step > reachableCap) {
      setStepRaw(Math.min(totalSteps - 1, reachableCap));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalSteps, graph]);

  const doneFlags = useMemo(
    () => computeDoneFlags(draft, graph, step),
    [draft, graph, step]
  );

  const canGoTo = useMemo(() => {
    return (target: number) => {
      if (target < 0 || target > totalSteps - 1) return false;
      return canReachStep(draft, graph, target);
    };
  }, [draft, graph, totalSteps]);

  function setStep(s: number) {
    if (!Number.isFinite(s)) return;
    setStepRaw(Math.max(0, Math.min(s, totalSteps - 1)));
  }
  function next() {
    setStepRaw((s) => Math.min(s + 1, totalSteps - 1));
  }
  function back() {
    setStepRaw((s) => Math.max(0, s - 1));
  }

  return {
    step,
    setStep,
    canGoTo,
    next,
    back,
    totalSteps,
    doneFlags,
    currentStep: graph[step] ?? graph[graph.length - 1],
    graph,
  };
}
