import { useEffect, useReducer, useRef } from 'react';
import {
  ArtifactKind,
  NewMetricDraft,
  NewMetricDraftV2,
  NewMetricDraftV3,
  ValidationResult,
} from '../types';
import { emptyTree } from '../filter-tree';
import { findOp, primarySlotIdFor } from '../full-page/steps/step-2-operation/operations';

// Snake_case pattern: starts with lowercase letter, followed by lowercase letters, digits, or underscores.
const SNAKE_CASE_PATTERN = /^[a-z][a-z0-9_]*$/;
const STORAGE_VERSION = 3;
const STORAGE_KEY_PREFIX = 'gds-cube:new-metric-draft-v2';
const TAB_ID_KEY = 'gds-cube:new-metric-tab-id';
const DEBOUNCE_MS = 200;

function makeInitialDraft(): NewMetricDraftV3 {
  return {
    sourceCubes: [],
    sourceCube: null,
    operation: 'sum',
    inputs: {},
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
    filterTree: emptyTree(),
    grain: 'daily',
    visibility: 'team',
    artifactKind: 'measure',
    gameId: null,
  };
}

// ---------------------------------------------------------------------------
// Parallel-sync helpers — keep legacy fields lock-stepped with the canonical
// `sourceCubes` / `inputs` shape so the dialog flow keeps compiling untouched.
// ---------------------------------------------------------------------------

function syncFromCanonical(draft: NewMetricDraftV3): NewMetricDraftV3 {
  const sourceCube = draft.sourceCubes[0] ?? null;
  const primarySlot = primarySlotIdFor(draft.operation);
  const ofMember = draft.inputs[primarySlot] ?? null;
  const ofMemberB = draft.operation === 'ratio' ? (draft.inputs.denominator ?? null) : null;
  if (
    draft.sourceCube === sourceCube &&
    draft.ofMember === ofMember &&
    draft.ofMemberB === ofMemberB
  ) {
    return draft;
  }
  return { ...draft, sourceCube, ofMember, ofMemberB };
}

function applySetField<K extends keyof NewMetricDraftV3>(
  state: NewMetricDraftV3,
  field: K,
  value: NewMetricDraftV3[K]
): NewMetricDraftV3 {
  let next: NewMetricDraftV3 = { ...state, [field]: value };

  // Legacy → canonical
  if (field === 'sourceCube') {
    const v = value as string | null;
    next.sourceCubes = v ? [v] : [];
  } else if (field === 'ofMember') {
    const v = value as string | null;
    const slot = primarySlotIdFor(next.operation);
    next.inputs = { ...next.inputs, [slot]: v };
  } else if (field === 'ofMemberB') {
    const v = value as string | null;
    next.inputs = { ...next.inputs, denominator: v };
  }

  // Auto-invalidate operation when sourceCubes shrinks below the current op's
  // minSources. Only fires on a `sourceCubes` (or legacy `sourceCube`) write,
  // never when the user picks an op that requires more sources than they have
  // — Step 2's UI gating handles that case.
  if (field === 'sourceCubes' || field === 'sourceCube') {
    const op = findOp(next.operation);
    if (op && next.sourceCubes.length < op.minSources) {
      next.operation = 'sum';
      next.inputs = {};
    }
  }

  return syncFromCanonical(next);
}

type SetFieldAction<K extends keyof NewMetricDraftV3> = {
  type: 'setField';
  field: K;
  value: NewMetricDraftV3[K];
};
type SetInputAction = { type: 'setInput'; slotId: string; value: string | null };
type HydrateAction = { type: 'hydrate'; draft: NewMetricDraftV3 };
type SetArtifactKindAction = { type: 'setArtifactKind'; kind: ArtifactKind };
type ResetAction = { type: 'reset' };
type DraftAction =
  | SetFieldAction<keyof NewMetricDraftV3>
  | SetInputAction
  | HydrateAction
  | SetArtifactKindAction
  | ResetAction;

function applySetArtifactKind(state: NewMetricDraftV3, nextKind: ArtifactKind): NewMetricDraftV3 {
  if (state.artifactKind === nextKind) return state;
  const prevKind = state.artifactKind;
  const next: NewMetricDraftV3 = { ...state, artifactKind: nextKind };

  // Drop measure sub-state when leaving measure-mode. Dim/segment have no use
  // for op + inputs.
  if (nextKind !== 'measure') {
    next.operation = 'sum';
    next.inputs = {};
  }

  // Drop dim sub-state on any kind change (dim builder only valid in dim mode).
  if (nextKind !== 'dimension') {
    delete next.dimKind;
    delete next.dimBuilder;
  }

  // Segment authoring writes into `filterTree`. When the user leaves segment
  // mode the cohort intent doesn't carry over to measure-filters or to a dim
  // — so we wipe the tree. Switching INTO segment from a measure with filters
  // intentionally inherits the tree (user may want to seed the cohort from
  // existing filters).
  if (prevKind === 'segment' && nextKind !== 'segment') {
    next.filterTree = emptyTree();
  }

  return syncFromCanonical(next);
}

function reducer(state: NewMetricDraftV3, action: DraftAction): NewMetricDraftV3 {
  switch (action.type) {
    case 'setField':
      return applySetField(state, action.field, action.value);
    case 'setInput': {
      const nextInputs = { ...state.inputs, [action.slotId]: action.value };
      return applySetField(state, 'inputs', nextInputs);
    }
    case 'setArtifactKind':
      return applySetArtifactKind(state, action.kind);
    case 'hydrate':
      return syncFromCanonical(action.draft);
    case 'reset':
      return makeInitialDraft();
    default:
      return state;
  }
}

export type ValidateOptions = {
  reachableNames: Set<string>;
};

/**
 * Pure validation function. Reads from the canonical `sourceCubes` + `inputs`
 * shape. The legacy `ofMember`/`ofMemberB` fields are still synced but the
 * validator no longer reads them.
 */
export function validate(draft: NewMetricDraft, opts?: Partial<ValidateOptions>): ValidationResult {
  const errors: ValidationResult['errors'] = {};
  const op = findOp(draft.operation);

  if (draft.sourceCubes.length === 0) {
    errors.sourceCubes = 'At least one source cube is required.';
  } else if (op && draft.sourceCubes.length < op.minSources) {
    errors.sourceCubes = `${op.name} needs at least ${op.minSources} source cubes.`;
  }

  if (!draft.operation) errors.operation = 'Operation is required.';

  if (op) {
    for (const slot of op.inputs) {
      const val = draft.inputs[slot.id] ?? null;
      const slotKey = `inputs.${slot.id}` as const;
      if (slot.required && !val) {
        errors[slotKey] = `${slot.label} is required.`;
      } else if (val && opts?.reachableNames && !opts.reachableNames.has(val)) {
        errors[slotKey] = `${slot.label} is not reachable from the selected source cubes.`;
      }
    }
  }

  if (!draft.name) {
    errors.name = 'Name is required.';
  } else if (!SNAKE_CASE_PATTERN.test(draft.name)) {
    errors.name = 'Name must be snake_case (lowercase letters, digits, underscores; start with a letter).';
  }

  if (!draft.title) errors.title = 'Title is required.';

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

// ---------------------------------------------------------------------------
// Tab id (per-tab scope for the draft localStorage key)
// ---------------------------------------------------------------------------

function getOrCreateTabId(): string {
  if (typeof window === 'undefined') return 'ssr';
  try {
    const existing = window.sessionStorage.getItem(TAB_ID_KEY);
    if (existing) return existing;
    const next = `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    window.sessionStorage.setItem(TAB_ID_KEY, next);
    return next;
  } catch {
    return 'fallback';
  }
}

function storageKeyFor(tabId: string): string {
  return `${STORAGE_KEY_PREFIX}:${tabId}`;
}

// ---------------------------------------------------------------------------
// Hydration — migrate pre-multi-source shape and sanitize unreachable members.
// ---------------------------------------------------------------------------

/**
 * Bring a persisted draft up to the current shape:
 *  - missing `sourceCubes` ← `[sourceCube]` if a legacy `sourceCube` exists
 *  - missing `inputs`      ← seeded from legacy `ofMember` / `ofMemberB`
 *  - V2 (no `artifactKind`) → injects `artifactKind: 'measure'`. V3 hydrates
 *    as-is. Persisted version is read by the caller (only `version === 2 || 3`
 *    blobs reach this function).
 */
function migrateLegacyShape(parsed: any): NewMetricDraftV3 {
  const draft = { ...makeInitialDraft(), ...(parsed ?? {}) } as NewMetricDraftV3;

  // If the persisted draft pre-dates `sourceCubes`, seed it from the legacy
  // single-cube field. The spread above brought `sourceCube` over but left
  // `sourceCubes` at the initial `[]` from `makeInitialDraft()`.
  const hadNewSources = Array.isArray((parsed as any)?.sourceCubes);
  if (!hadNewSources) {
    const legacy = (parsed?.sourceCube ?? null) as string | null;
    draft.sourceCubes = legacy ? [legacy] : [];
  }

  // Same for `inputs`: seed from legacy `ofMember` / `ofMemberB`.
  const hadNewInputs = parsed?.inputs && typeof parsed.inputs === 'object';
  if (!hadNewInputs) {
    draft.inputs = {};
    const legacyOf = (parsed?.ofMember ?? null) as string | null;
    const legacyOfB = (parsed?.ofMemberB ?? null) as string | null;
    const primarySlot = primarySlotIdFor(draft.operation);
    if (legacyOf) draft.inputs[primarySlot] = legacyOf;
    if (legacyOfB) draft.inputs.denominator = legacyOfB;
  }

  // V2 → V3: blob has no `artifactKind` key. Default to 'measure' so legacy
  // drafts hydrate as the existing measure flow with no behavioral change.
  if (typeof (parsed as any)?.artifactKind !== 'string') {
    draft.artifactKind = 'measure';
    // Defensive: a V2 blob should never have dim sub-state, but if a future
    // bug ever wrote those keys without a discriminator, strip them now.
    delete draft.dimKind;
    delete draft.dimBuilder;
  }

  return draft;
}

function sanitizeDraft(
  draft: NewMetricDraftV3,
  reachableNames: Set<string>
): { draft: NewMetricDraftV3; dropped: string[] } {
  const dropped: string[] = [];
  let nextInputs = draft.inputs;
  for (const [slotId, val] of Object.entries(draft.inputs)) {
    if (val && !reachableNames.has(val)) {
      dropped.push(val);
      nextInputs = { ...nextInputs, [slotId]: null };
    }
  }
  let next = nextInputs === draft.inputs ? draft : { ...draft, inputs: nextInputs };

  function walk(node: typeof next.filterTree): typeof next.filterTree {
    return {
      ...node,
      children: node.children
        .map((c) => {
          if (c.kind === 'leaf') {
            if (!reachableNames.has(c.column)) {
              dropped.push(c.column);
              return null;
            }
            return c;
          }
          return walk(c);
        })
        .filter((c): c is NonNullable<typeof c> => c !== null),
    };
  }
  const cleanedTree = walk(next.filterTree);
  if (dropped.length > 0) next = { ...next, filterTree: cleanedTree };
  return { draft: next, dropped };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export type UseNewMetricDraftReturn = {
  draft: NewMetricDraftV3;
  setField: <K extends keyof NewMetricDraftV3>(field: K, value: NewMetricDraftV3[K]) => void;
  setInput: (slotId: string, value: string | null) => void;
  /** Switch the artifact kind. Clears kind-specific sub-state per the reducer
   *  rules in `applySetArtifactKind`. */
  setArtifactKind: (kind: ArtifactKind) => void;
  /** Toggle a cube's presence in `sourceCubes`. First selected becomes primary. */
  toggleSource: (cubeName: string) => void;
  /** Reorder `sourceCubes` so `cubeName` becomes the primary (index 0). */
  setPrimarySource: (cubeName: string) => void;
  reset: () => void;
  isValid: boolean;
  validation: ValidationResult;
  tabId: string;
  otherTabEditing: boolean;
  clearPersisted: () => void;
};

export type UseNewMetricDraftArgs = {
  reachableNames?: Set<string>;
  /**
   * Active game scope at mount. Stamped onto the draft when no game has been
   * explicitly set yet (initial mount + hydration of a legacy draft that
   * pre-dates the field). User edits via setField('gameId', …) win over this.
   */
  initialGameId?: string | null;
};

export function useNewMetricDraft(args: UseNewMetricDraftArgs = {}): UseNewMetricDraftReturn {
  const tabIdRef = useRef<string>(getOrCreateTabId());
  const [draft, dispatch] = useReducer(reducer, undefined as never, makeInitialDraft);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const otherTabEditingRef = useRef<boolean>(false);
  const channelRef = useRef<BroadcastChannel | null>(null);

  // Hydrate from localStorage on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(storageKeyFor(tabIdRef.current));
      if (!raw) return;
      const parsed = JSON.parse(raw) as { version?: number; draft?: any };
      // Accept V2 + V3 blobs; older versions are dropped (back-compat budget
      // is one major hop). Migration injects `artifactKind: 'measure'` for V2.
      if (!parsed.draft) return;
      if (parsed.version !== 2 && parsed.version !== STORAGE_VERSION) return;
      let next = migrateLegacyShape(parsed.draft);
      if (args.reachableNames) {
        const sanitized = sanitizeDraft(next, args.reachableNames);
        next = sanitized.draft;
        if (sanitized.dropped.length > 0) {
          // eslint-disable-next-line no-console
          console.warn('[new-metric-draft] dropped out-of-meta references:', sanitized.dropped);
        }
      }
      dispatch({ type: 'hydrate', draft: next });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[new-metric-draft] hydrate failed:', err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stamp the active game on the draft once it's known. Only writes when the
  // draft is still unscoped — preserves a user's explicit pick (or a hydrated
  // value) across game-context updates.
  useEffect(() => {
    if (!args.initialGameId) return;
    if (draft.gameId) return;
    dispatch({ type: 'setField', field: 'gameId', value: args.initialGameId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args.initialGameId]);

  // Debounced + flush-on-unload persistence.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    function persistNow() {
      try {
        const payload = JSON.stringify({ version: STORAGE_VERSION, draft });
        window.localStorage.setItem(storageKeyFor(tabIdRef.current), payload);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[new-metric-draft] localStorage write failed (quota?):', err);
      }
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(persistNow, DEBOUNCE_MS);

    const flush = () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      persistNow();
    };
    const onBeforeUnload = () => flush();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibility);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [draft]);

  // BroadcastChannel — flag concurrent editor in another tab.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel('new-metric');
    channelRef.current = ch;
    ch.postMessage({ type: 'editing', tabId: tabIdRef.current });
    ch.onmessage = (ev: MessageEvent) => {
      const msg = ev.data as { type?: string; tabId?: string } | null;
      if (msg?.type === 'editing' && msg.tabId !== tabIdRef.current) {
        otherTabEditingRef.current = true;
      }
    };
    return () => {
      ch.close();
      channelRef.current = null;
    };
  }, []);

  function setField<K extends keyof NewMetricDraftV3>(field: K, value: NewMetricDraftV3[K]) {
    dispatch({ type: 'setField', field, value });
    channelRef.current?.postMessage({ type: 'editing', tabId: tabIdRef.current });
  }
  function setInput(slotId: string, value: string | null) {
    dispatch({ type: 'setInput', slotId, value });
    channelRef.current?.postMessage({ type: 'editing', tabId: tabIdRef.current });
  }
  function setArtifactKind(kind: ArtifactKind) {
    dispatch({ type: 'setArtifactKind', kind });
    channelRef.current?.postMessage({ type: 'editing', tabId: tabIdRef.current });
  }
  function toggleSource(cubeName: string) {
    const has = draft.sourceCubes.includes(cubeName);
    const next = has ? draft.sourceCubes.filter((n) => n !== cubeName) : [...draft.sourceCubes, cubeName];
    setField('sourceCubes', next);
  }
  function setPrimarySource(cubeName: string) {
    if (!draft.sourceCubes.includes(cubeName)) return;
    const next = [cubeName, ...draft.sourceCubes.filter((n) => n !== cubeName)];
    setField('sourceCubes', next);
  }
  function reset() {
    dispatch({ type: 'reset' });
  }
  function clearPersisted() {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(storageKeyFor(tabIdRef.current));
    } catch {
      /* ignore */
    }
  }

  const validation = validate(draft, args.reachableNames ? { reachableNames: args.reachableNames } : undefined);

  return {
    draft,
    setField,
    setInput,
    setArtifactKind,
    toggleSource,
    setPrimarySource,
    reset,
    isValid: validation.isValid,
    validation,
    tabId: tabIdRef.current,
    otherTabEditing: otherTabEditingRef.current,
    clearPersisted,
  };
}
