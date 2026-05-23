/**
 * Persistent store for chat panel open state and width.
 * Synced to localStorage; notifies React via useSyncExternalStore.
 */
import { useSyncExternalStore } from 'react';

const KEY_OPEN  = 'gds-cube:chat-panel:open';
const KEY_WIDTH = 'gds-cube:chat-panel:width';
const WIDTH_MIN     = 360;
const WIDTH_MAX     = 720;
const WIDTH_DEFAULT = 420;

// ---------------------------------------------------------------------------
// In-module state (source-of-truth; localStorage mirrors it)
// ---------------------------------------------------------------------------

let _open: boolean = (() => {
  try { return localStorage.getItem(KEY_OPEN) === 'true'; } catch { return false; }
})();

let _width: number = (() => {
  try {
    const n = parseInt(localStorage.getItem(KEY_WIDTH) ?? '', 10);
    if (!isNaN(n)) return Math.min(Math.max(n, WIDTH_MIN), WIDTH_MAX);
  } catch { /* noop */ }
  return WIDTH_DEFAULT;
})();

// ---------------------------------------------------------------------------
// Subscriber lists
// ---------------------------------------------------------------------------

const openSubs: Set<() => void>  = new Set();
const widthSubs: Set<() => void> = new Set();

function notifyOpen()  { openSubs.forEach((cb) => cb()); }
function notifyWidth() { widthSubs.forEach((cb) => cb()); }

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getOpen(): boolean { return _open; }

export function setOpen(b: boolean): void {
  if (_open === b) return;
  _open = b;
  try { localStorage.setItem(KEY_OPEN, b ? 'true' : 'false'); } catch { /* noop */ }
  notifyOpen();
}

export function onOpenChange(cb: (open: boolean) => void): () => void {
  const wrapper = () => cb(_open);
  openSubs.add(wrapper);
  return () => openSubs.delete(wrapper);
}

export function getWidth(): number { return _width; }

export function setWidth(n: number): void {
  const clamped = Math.min(Math.max(n, WIDTH_MIN), WIDTH_MAX);
  if (_width === clamped) return;
  _width = clamped;
  try { localStorage.setItem(KEY_WIDTH, String(clamped)); } catch { /* noop */ }
  notifyWidth();
}

export function onWidthChange(cb: (width: number) => void): () => void {
  const wrapper = () => cb(_width);
  widthSubs.add(wrapper);
  return () => widthSubs.delete(wrapper);
}

// ---------------------------------------------------------------------------
// React hooks
// ---------------------------------------------------------------------------

export function useChatPanelOpen(): boolean {
  return useSyncExternalStore(
    (notify) => { openSubs.add(notify); return () => openSubs.delete(notify); },
    getOpen,
    () => false,
  );
}

export function useChatPanelWidth(): number {
  return useSyncExternalStore(
    (notify) => { widthSubs.add(notify); return () => widthSubs.delete(notify); },
    getWidth,
    () => WIDTH_DEFAULT,
  );
}
