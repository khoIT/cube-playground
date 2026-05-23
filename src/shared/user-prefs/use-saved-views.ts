/**
 * Saved-views preferences. A SavedView captures a metric/concept route and
 * a label. The Explore page can later wire a "Save view" action into the
 * QueryBuilder toolbar to persist whole Cube queries; v1 keeps it lean.
 */

import { useCallback, useEffect, useState } from 'react';

import { createUserPrefsStore } from './user-prefs-store';

export interface SavedView {
  id: string;
  label: string;
  routeTo: string;
  createdAt: string;
}

const store = createUserPrefsStore<SavedView[]>('saved-views', []);

export function useSavedViews() {
  const [views, setViews] = useState<SavedView[]>(() => store.read());

  useEffect(() => store.subscribe(() => setViews(store.read())), []);

  const add = useCallback((view: Omit<SavedView, 'createdAt'>) => {
    const next = store
      .read()
      .filter((v) => v.id !== view.id)
      .concat([{ ...view, createdAt: new Date().toISOString() }]);
    store.write(next);
  }, []);

  const remove = useCallback((id: string) => {
    store.write(store.read().filter((v) => v.id !== id));
  }, []);

  return { views, add, remove };
}
