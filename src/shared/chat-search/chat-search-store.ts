/**
 * Tiny open/close store for the chat-search overlay.
 * Mirrors the pattern of chat-panel-open-store: useSyncExternalStore so any
 * component (sidebar trigger, App-root mount, kbd shortcut) can read/write
 * without prop drilling or React context.
 */
import { useSyncExternalStore } from 'react';

let isOpen = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function openChatSearch(): void {
  if (isOpen) return;
  isOpen = true;
  emit();
}

export function closeChatSearch(): void {
  if (!isOpen) return;
  isOpen = false;
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): boolean {
  return isOpen;
}

export function useChatSearchOpen(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
