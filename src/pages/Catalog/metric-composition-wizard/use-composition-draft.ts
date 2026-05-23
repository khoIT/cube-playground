/**
 * useCompositionDraft — sessionStorage-backed draft state for the
 * composition wizard. Mirrors useNewMetricDraft pattern from QBv2 but
 * scoped to the 4-step composition flow.
 */

import { useCallback, useEffect, useState } from 'react';

import {
  CompositionDraft,
  emptyDraft,
} from './composition-draft-types';

const STORAGE_KEY = 'compass:composition-draft';

function load(): CompositionDraft {
  if (typeof window === 'undefined') return emptyDraft();
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyDraft();
    const parsed = JSON.parse(raw) as Partial<CompositionDraft>;
    return { ...emptyDraft(), ...parsed };
  } catch {
    return emptyDraft();
  }
}

function persist(d: CompositionDraft): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(d));
  } catch {
    // sessionStorage full / restricted — ignore, draft simply doesn't persist.
  }
}

export function clearCompositionDraft(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignored */
  }
}

export interface UseCompositionDraft {
  draft: CompositionDraft;
  setField: <K extends keyof CompositionDraft>(
    key: K,
    value: CompositionDraft[K],
  ) => void;
  reset: () => void;
}

export function useCompositionDraft(): UseCompositionDraft {
  const [draft, setDraft] = useState<CompositionDraft>(load);

  useEffect(() => {
    persist(draft);
  }, [draft]);

  const setField = useCallback(
    <K extends keyof CompositionDraft>(key: K, value: CompositionDraft[K]) => {
      setDraft((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const reset = useCallback(() => {
    clearCompositionDraft();
    setDraft(emptyDraft());
  }, []);

  return { draft, setField, reset };
}
