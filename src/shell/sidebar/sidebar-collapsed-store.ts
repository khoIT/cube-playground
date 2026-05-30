/**
 * Sidebar collapse state — single boolean persisted via the DB-authoritative
 * pref store (localStorage mirror keeps reads synchronous).
 * Default: false (expanded). Custom event lets multiple sidebar instances stay in sync.
 */
import { getPref, setPref } from '../../hooks/server-prefs-store';

const KEY = 'gds-cube:sidebar:collapsed';
const EVENT = 'gds-cube:sidebar:collapsed-changed';

export function getCollapsed(): boolean {
  try { return getPref(KEY) === '1'; } catch { return false; }
}

export function setCollapsed(v: boolean): void {
  setPref(KEY, v ? '1' : '0');
  try { window.dispatchEvent(new CustomEvent(EVENT, { detail: v })); } catch { /* noop */ }
}

export function onCollapsedChange(handler: (v: boolean) => void): () => void {
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<boolean>).detail;
    if (typeof detail === 'boolean') handler(detail);
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
