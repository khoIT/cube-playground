import { useEffect, useMemo, useRef } from 'react';
import type { NewMetricDraftV2 } from '../../types';
import {
  computeAutoMetricName,
  computeAutoMetricTitle,
} from './compute-auto-metric-name';

type SetField = <K extends keyof NewMetricDraftV2>(
  key: K,
  value: NewMetricDraftV2[K]
) => void;

// Auto-name + auto-title effect, extracted from NewMetricPage so the shell
// component does not re-run the compute on every shell render. The "auto-
// controlled" invariant is preserved: each field stays auto while it is
// empty or equals the last value this hook wrote; the first manual edit
// by the user breaks the link and we stop overwriting.
export function useAutoMetricName(
  draft: NewMetricDraftV2,
  setField: SetField
): void {
  const lastAutoNameRef = useRef('');
  const lastAutoTitleRef = useRef('');

  // The compute is pure — memoize so we don't re-walk the draft on every
  // shell render. Identity-stable inputs (drafts come from useReducer-style
  // immutable updates upstream) make this cheap.
  const autoName = useMemo(() => {
    if (draft.sourceCubes.length === 0 || !draft.operation) return null;
    return computeAutoMetricName(draft);
  }, [draft]);

  const autoTitle = useMemo(() => {
    if (draft.sourceCubes.length === 0 || !draft.operation) return null;
    return computeAutoMetricTitle(draft);
  }, [draft]);

  useEffect(() => {
    if (autoName && autoName !== 'untitled_metric') {
      const nameIsAuto =
        !draft.name || draft.name === lastAutoNameRef.current;
      if (nameIsAuto && draft.name !== autoName) setField('name', autoName);
      lastAutoNameRef.current = autoName;
    }

    if (autoTitle) {
      const titleIsAuto =
        !draft.title || draft.title === lastAutoTitleRef.current;
      if (titleIsAuto && draft.title !== autoTitle) setField('title', autoTitle);
      lastAutoTitleRef.current = autoTitle;
    }
    // setField identity is supplied by parent; we deliberately omit it from
    // deps along with draft.name/draft.title to preserve the original
    // effect's trigger surface (operation + source pick).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoName, autoTitle]);
}
