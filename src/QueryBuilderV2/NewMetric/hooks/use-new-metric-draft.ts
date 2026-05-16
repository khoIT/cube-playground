import { useEffect, useReducer, useRef } from 'react';
import { NewMetricDraft, NewMetricDraftV2, ValidationResult } from '../types';
import { emptyTree } from '../filter-tree';

// Snake_case pattern: starts with lowercase letter, followed by lowercase letters, digits, or underscores.
const SNAKE_CASE_PATTERN = /^[a-z][a-z0-9_]*$/;
const STORAGE_VERSION = 2;
const STORAGE_KEY_PREFIX = 'gds-cube:new-metric-draft-v2';
const TAB_ID_KEY = 'gds-cube:new-metric-tab-id';
const DEBOUNCE_MS = 200;

function makeInitialDraft(): NewMetricDraftV2 {
  return {
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
    filterTree: emptyTree(),
    grain: 'daily',
    visibility: 'team',
  };
}

type SetFieldAction<K extends keyof NewMetricDraftV2> = {
  type: 'setField';
  field: K;
  value: NewMetricDraftV2[K];
};
type HydrateAction = { type: 'hydrate'; draft: NewMetricDraftV2 };
type ResetAction = { type: 'reset' };
type DraftAction = SetFieldAction<keyof NewMetricDraftV2> | HydrateAction | ResetAction;

function reducer(state: NewMetricDraftV2, action: DraftAction): NewMetricDraftV2 {
  switch (action.type) {
    case 'setField':
      return { ...state, [action.field]: action.value };
    case 'hydrate':
      return action.draft;
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
 * Pure validation function. `reachableNames` is mandatory in v2.
 */
export function validate(draft: NewMetricDraft, opts?: Partial<ValidateOptions>): ValidationResult {
  const errors: ValidationResult['errors'] = {};

  if (!draft.sourceCube) errors.sourceCube = 'Source cube is required.';
  if (!draft.operation) errors.operation = 'Operation is required.';

  // `count` doesn't require an of-member (it's the row count of the source cube).
  if (draft.operation !== 'count' && !draft.ofMember) {
    errors.ofMember = 'Member is required.';
  } else if (
    draft.ofMember &&
    opts?.reachableNames &&
    !opts.reachableNames.has(draft.ofMember)
  ) {
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
    errors.ofMemberB = 'Member is not joined to the source cube.';
  }

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
// Hydration sanitiser — drops out-of-meta members / filter-leaf columns.
// ---------------------------------------------------------------------------

function sanitizeDraft(
  draft: NewMetricDraftV2,
  reachableNames: Set<string>
): { draft: NewMetricDraftV2; dropped: string[] } {
  const dropped: string[] = [];
  let next = draft;
  if (next.ofMember && !reachableNames.has(next.ofMember)) {
    dropped.push(next.ofMember);
    next = { ...next, ofMember: null };
  }
  if (next.ofMemberB && !reachableNames.has(next.ofMemberB)) {
    dropped.push(next.ofMemberB);
    next = { ...next, ofMemberB: null };
  }
  // Filter tree: prune leaves whose column is not reachable.
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
  draft: NewMetricDraftV2;
  setField: <K extends keyof NewMetricDraftV2>(field: K, value: NewMetricDraftV2[K]) => void;
  reset: () => void;
  isValid: boolean;
  validation: ValidationResult;
  tabId: string;
  otherTabEditing: boolean;
  clearPersisted: () => void;
};

export type UseNewMetricDraftArgs = {
  reachableNames?: Set<string>;
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
      const parsed = JSON.parse(raw) as { version?: number; draft?: NewMetricDraftV2 };
      if (parsed.version !== STORAGE_VERSION || !parsed.draft) return;
      let next = parsed.draft;
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

  function setField<K extends keyof NewMetricDraftV2>(field: K, value: NewMetricDraftV2[K]) {
    dispatch({ type: 'setField', field, value });
    channelRef.current?.postMessage({ type: 'editing', tabId: tabIdRef.current });
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
    reset,
    isValid: validation.isValid,
    validation,
    tabId: tabIdRef.current,
    otherTabEditing: otherTabEditingRef.current,
    clearPersisted,
  };
}
