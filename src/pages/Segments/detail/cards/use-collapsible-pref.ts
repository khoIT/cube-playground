/** Persistent collapse-state hook for chart cards / monitor sections.
 *  State is stored under `gds-cube:card-collapsed:{key}` so each card
 *  remembers its collapsed state across reloads independently.
 *  Uses the DB-authoritative pref store (localStorage mirror keeps it synchronous). */

import { useCallback, useEffect, useState } from 'react';

import { getPref, setPref } from '../../../../hooks/server-prefs-store';

const STORAGE_PREFIX = 'gds-cube:card-collapsed:';

function readStored(key: string | undefined, fallback: boolean): boolean {
  if (!key) return fallback;
  const raw = getPref(STORAGE_PREFIX + key);
  if (raw == null) return fallback;
  return raw === '1';
}

function writeStored(key: string, collapsed: boolean): void {
  setPref(STORAGE_PREFIX + key, collapsed ? '1' : '0');
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
