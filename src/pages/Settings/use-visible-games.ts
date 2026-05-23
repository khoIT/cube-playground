/**
 * Game-picker visibility preference.
 *
 * Stores a *blocklist* of hidden game ids in localStorage. Missing entries
 * default to visible, so games newly added to gds.config.json auto-appear in
 * the picker without the user needing to re-opt-in. This is purely a header
 * dropdown cosmetic — the underlying GameContext.games list is never trimmed,
 * so gameId resolution from URL / localStorage still works against the full
 * set even when the active game is hidden from the dropdown.
 */

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'gds-cube:hidden-game-ids';
const STORAGE_EVENT = 'gds-cube:hidden-games-change';

function readHidden(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function writeHidden(ids: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    // In-tab sync: localStorage `storage` event fires only across tabs, so we
    // emit a custom event for siblings (picker + settings) in the same window.
    window.dispatchEvent(new CustomEvent(STORAGE_EVENT));
  } catch {
    // ignore quota / private mode
  }
}

export interface VisibleGamesApi {
  hidden: Set<string>;
  isVisible: (id: string) => boolean;
  toggle: (id: string) => void;
  showAll: () => void;
}

export function useVisibleGames(): VisibleGamesApi {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(readHidden()));

  useEffect(() => {
    const sync = () => setHidden(new Set(readHidden()));
    window.addEventListener(STORAGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(STORAGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const toggle = useCallback((id: string) => {
    const next = new Set(readHidden());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    writeHidden([...next]);
  }, []);

  const showAll = useCallback(() => {
    writeHidden([]);
  }, []);

  const isVisible = useCallback((id: string) => !hidden.has(id), [hidden]);

  return { hidden, isVisible, toggle, showAll };
}
