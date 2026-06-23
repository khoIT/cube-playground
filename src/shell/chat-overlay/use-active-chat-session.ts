/**
 * In-memory atom for the chat panel's currently-displayed session id.
 * Intentionally ephemeral — does not survive page reload. The panel will
 * show the empty/new-session state on hard refresh, and the user can pick
 * from recents to resume.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { WORKSPACE_CHANGE_EVENT } from '../../components/workspace-context';

let _sessionId: string | null = null;
const subs: Set<() => void> = new Set();

function notify() { subs.forEach((cb) => cb()); }

// Workspace is an isolation boundary: chat sessions are scoped per workspace
// (the session list fetch is workspace-keyed), but this in-memory active-session
// pointer would otherwise keep the previous workspace's conversation rendered in
// the side panel after a switch. Drop it so the panel reverts to the new
// workspace's empty/new-session state — same as a hard reload.
if (typeof window !== 'undefined') {
  window.addEventListener(WORKSPACE_CHANGE_EVENT, () => setActiveChatSession(null));
}

function getSnapshot(): string | null { return _sessionId; }

function subscribe(notify_: () => void): () => void {
  subs.add(notify_);
  return () => subs.delete(notify_);
}

export function getActiveChatSession(): string | null { return _sessionId; }

export function setActiveChatSession(id: string | null): void {
  if (_sessionId === id) return;
  _sessionId = id;
  notify();
}

export function useActiveChatSession(): [string | null, (id: string | null) => void] {
  const id = useSyncExternalStore(subscribe, getSnapshot, () => null);
  const setId = useCallback((next: string | null) => setActiveChatSession(next), []);
  return [id, setId];
}
