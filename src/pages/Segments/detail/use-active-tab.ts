/**
 * URL-driven tab state for the Detail page. Reads `?tab=` on mount, applies
 * legacy mapping from the old 7-tab IDs to the new 5-tab structure, and
 * falls back to `members` (the first tab + default landing tab for ALL segments).
 */

import { useCallback, useEffect, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';

export type DetailTabId = 'monitor' | 'movement' | 'insights' | 'members' | 'care' | 'definition' | 'activation' | 'funnel';

const VALID: ReadonlySet<DetailTabId> = new Set([
  'monitor',
  'movement',
  'insights',
  'members',
  'care',
  'definition',
  'activation',
  'funnel',
]);

const LEGACY_MAP: Record<string, { tab: DetailTabId; section?: string }> = {
  overview: { tab: 'insights', section: 'overview' },
  engagement: { tab: 'insights', section: 'engagement' },
  monetization: { tab: 'insights', section: 'monetization' },
  retention: { tab: 'insights', section: 'retention' },
  'sample-users': { tab: 'members' },
  predicate: { tab: 'definition' },
  'saved-analyses': { tab: 'insights', section: 'saved' },
};

function readParams(search: string): URLSearchParams {
  return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
}

interface ActiveTabState {
  tab: DetailTabId;
  section: string | null;
  setTab: (id: DetailTabId) => void;
  setSection: (s: string | null) => void;
}

export function useActiveTab(): ActiveTabState {
  const location = useLocation();
  const history = useHistory();
  const params = readParams(location.search);
  const raw = params.get('tab') ?? '';

  const [tab, setTabState] = useState<DetailTabId>(() => {
    if (VALID.has(raw as DetailTabId)) return raw as DetailTabId;
    const mapped = LEGACY_MAP[raw];
    return mapped?.tab ?? 'members';
  });
  const [section, setSectionState] = useState<string | null>(() => {
    const querySection = params.get('section');
    if (querySection) return querySection;
    const mapped = LEGACY_MAP[raw];
    return mapped?.section ?? null;
  });

  // Reflect changes back into the URL so deep-links stay shareable.
  useEffect(() => {
    const next = new URLSearchParams(location.search);
    next.set('tab', tab);
    if (section) next.set('section', section);
    else next.delete('section');
    const search = `?${next.toString()}`;
    if (search !== location.search) {
      history.replace({ ...location, search });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, section]);

  const setTab = useCallback((id: DetailTabId) => {
    setTabState(id);
    // Switching out of insights clears the sub-pill section.
    if (id !== 'insights') setSectionState(null);
  }, []);

  const setSection = useCallback((s: string | null) => setSectionState(s), []);

  return { tab, section, setTab, setSection };
}
