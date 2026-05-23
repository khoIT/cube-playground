/** Persistent collapse-state hook for chart cards / monitor sections.
 *  State is stored under `gds-cube:card-collapsed:{key}` so each card
 *  remembers its collapsed state across reloads independently. */

import { useCallback, useEffect, useState } from 'react';

const STORAGE_PREFIX = 'gds-cube:card-collapsed:';

function readStored(key: string | undefined, fallback: boolean): boolean {
  if (!key || typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
    if (raw == null) return fallback;
    return raw === '1';
  } catch {
    return fallback;
  }
}

function writeStored(key: string, collapsed: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, collapsed ? '1' : '0');
  } catch {
    /* ignore quota / privacy errors */
  }
}

export function useCollapsiblePref(
  key: string | undefined,
  defaultCollapsed = false,
): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState<boolean>(() =>
    readStored(key, defaultCollapsed),
  );

  useEffect(() => {
    if (key) writeStored(key, collapsed);
  }, [key, collapsed]);

  const toggle = useCallback(() => {
    setCollapsed((c) => !c);
  }, []);

  return [collapsed, toggle];
}
