/**
 * Editor step state. URL-driven via `?step=`. New segments start at Identity;
 * edit mode starts at Predicate.
 */

import { useCallback, useEffect, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';

export type EditorStep = 'identity' | 'predicate' | 'refresh' | 'activate';

const VALID: ReadonlySet<EditorStep> = new Set([
  'identity',
  'predicate',
  'refresh',
  'activate',
]);

export const STEP_ORDER: EditorStep[] = ['identity', 'predicate', 'refresh', 'activate'];

function readStep(search: string): EditorStep | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const raw = params.get('step');
  return raw && VALID.has(raw as EditorStep) ? (raw as EditorStep) : null;
}

export function useStep(mode: 'new' | 'edit') {
  const location = useLocation();
  const history = useHistory();

  const [step, setStepState] = useState<EditorStep>(() => {
    const url = readStep(location.search);
    if (url) return url;
    return mode === 'new' ? 'identity' : 'predicate';
  });

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    params.set('step', step);
    const next = `?${params.toString()}`;
    if (next !== location.search) {
      history.replace({ ...location, search: next });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const setStep = useCallback((s: EditorStep) => setStepState(s), []);

  const goNext = useCallback(() => {
    const i = STEP_ORDER.indexOf(step);
    if (i < STEP_ORDER.length - 1) setStepState(STEP_ORDER[i + 1]);
  }, [step]);

  const goBack = useCallback(() => {
    const i = STEP_ORDER.indexOf(step);
    if (i > 0) setStepState(STEP_ORDER[i - 1]);
  }, [step]);

  return { step, setStep, goNext, goBack };
}
