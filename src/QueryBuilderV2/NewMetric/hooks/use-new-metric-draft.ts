import { useReducer } from 'react';
import { NewMetricDraft, Operation, Format, ValidationResult } from '../types';

// Snake_case pattern: starts with lowercase letter, followed by lowercase letters, digits, or underscores
const SNAKE_CASE_PATTERN = /^[a-z][a-z0-9_]*$/;

const INITIAL_DRAFT: NewMetricDraft = {
  sourceCube: null,
  operation: 'sum',
  ofMember: null,
  ofMemberB: null,
  filter: null,
  name: '',
  title: '',
  description: '',
  format: 'number',
  tags: [],
  previewTimeDimension: null,
  previewRange: '7d',
};

// Discriminated union for reducer actions
type SetFieldAction<K extends keyof NewMetricDraft> = {
  type: 'setField';
  field: K;
  value: NewMetricDraft[K];
};

type ResetAction = { type: 'reset' };

type DraftAction = SetFieldAction<keyof NewMetricDraft> | ResetAction;

function reducer(state: NewMetricDraft, action: DraftAction): NewMetricDraft {
  switch (action.type) {
    case 'setField':
      return { ...state, [action.field]: action.value };
    case 'reset':
      return { ...INITIAL_DRAFT };
    default:
      return state;
  }
}

export type ValidateOptions = {
  /**
   * When provided, ofMember / ofMemberB must appear in this set.
   * Omit to skip reachability checks (backwards-compatible).
   */
  reachableNames?: Set<string>;
};

/**
 * Pure validation function — exported for unit testing without React.
 * Rules:
 *   - sourceCube: required
 *   - operation: required (always set due to default, but validate non-empty)
 *   - ofMember: required for all operations; must be reachable when opts provided
 *   - ofMemberB: required only when operation === 'ratio'; same reachability rule
 *   - name: must match snake_case pattern
 *   - title: required
 */
export function validate(draft: NewMetricDraft, opts?: ValidateOptions): ValidationResult {
  const errors: ValidationResult['errors'] = {};

  if (!draft.sourceCube) {
    errors.sourceCube = 'Source cube is required.';
  }

  if (!draft.operation) {
    errors.operation = 'Operation is required.';
  }

  if (!draft.ofMember) {
    errors.ofMember = 'Member is required.';
  } else if (opts?.reachableNames && !opts.reachableNames.has(draft.ofMember)) {
    errors.ofMember =
      'Member is not joined to the source cube. Define the join in your schema repo first.';
  }

  if (draft.operation === 'ratio' && !draft.ofMemberB) {
    errors.ofMemberB = 'Second member is required for ratio.';
  } else if (
    draft.operation === 'ratio' &&
    draft.ofMemberB &&
    opts?.reachableNames &&
    !opts.reachableNames.has(draft.ofMemberB)
  ) {
    errors.ofMemberB =
      'Member is not joined to the source cube. Define the join in your schema repo first.';
  }

  // Cross-cube ratio guard: both operands must belong to the source cube.
  // Ratio SQL is generated as sourceCube.numerator / NULLIF(sourceCube.denominator, 0),
  // so a cross-cube reference would silently produce an invalid expression.
  if (draft.operation === 'ratio' && draft.sourceCube) {
    const prefix = `${draft.sourceCube}.`;
    if (draft.ofMember && !draft.ofMember.startsWith(prefix)) {
      errors.ofMember = 'Ratio operands must belong to the source cube. Cross-cube ratio is not supported yet.';
    }
    if (draft.ofMemberB && !draft.ofMemberB.startsWith(prefix)) {
      errors.ofMemberB = 'Ratio operands must belong to the source cube. Cross-cube ratio is not supported yet.';
    }
  }

  if (!draft.name) {
    errors.name = 'Name is required.';
  } else if (!SNAKE_CASE_PATTERN.test(draft.name)) {
    errors.name = 'Name must be snake_case (lowercase letters, digits, underscores; start with a letter).';
  }

  if (!draft.title) {
    errors.title = 'Title is required.';
  }

  // Tag rules: reject whitespace-only entries and case-sensitive duplicates.
  // Case-sensitive distinction is intentional (Revenue ≠ revenue) — keeps the
  // YAGNI surface small; canonicalisation is out of scope for this plan.
  if (draft.tags.length > 0) {
    const trimmedSeen = new Set<string>();
    for (const tag of draft.tags) {
      if (tag.trim().length === 0) {
        errors.tags = 'Tags cannot be whitespace-only.';
        break;
      }
      if (trimmedSeen.has(tag)) {
        errors.tags = 'Duplicate tag.';
        break;
      }
      trimmedSeen.add(tag);
    }
  }

  return { isValid: Object.keys(errors).length === 0, errors };
}

export type UseNewMetricDraftReturn = {
  draft: NewMetricDraft;
  setField: <K extends keyof NewMetricDraft>(field: K, value: NewMetricDraft[K]) => void;
  reset: () => void;
  isValid: boolean;
  validation: ValidationResult;
};

export function useNewMetricDraft(): UseNewMetricDraftReturn {
  const [draft, dispatch] = useReducer(reducer, INITIAL_DRAFT);

  function setField<K extends keyof NewMetricDraft>(field: K, value: NewMetricDraft[K]) {
    dispatch({ type: 'setField', field, value });
  }

  function reset() {
    dispatch({ type: 'reset' });
  }

  const validation = validate(draft);

  return { draft, setField, reset, isValid: validation.isValid, validation };
}
