/**
 * Per-session override for the chat disambiguation mode.
 *
 * Each session can temporarily switch its mode without changing the user
 * default. Overrides live in memory only — a refresh or a new session reverts
 * to the user pref. An LRU cap (50 entries) guards against unbounded growth
 * when users churn through many sessions.
 *
 * `getEffectiveChatMode` is the read path other modules use to attach the
 * mode to outgoing chat-service requests.
 */

import { useEffect, useState } from 'react';
import {
  getChatDisambiguationMode,
  type ChatDisambiguationMode,
} from '../../pages/Settings/use-chat-disambiguation-mode';

const MAX_OVERRIDES = 50;
const overrides = new Map<string, ChatDisambiguationMode>();
const subs = new Set<() => void>();

function notify(): void {
  for (const fn of subs) fn();
}

function trimLru(): void {
  while (overrides.size > MAX_OVERRIDES) {
    const oldest = overrides.keys().next().value;
    if (oldest === undefined) break;
    overrides.delete(oldest);
  }
}

export function setSessionModeOverride(
  sessionId: string,
  mode: ChatDisambiguationMode,
): void {
  if (overrides.has(sessionId)) overrides.delete(sessionId);
  overrides.set(sessionId, mode);
  trimLru();
  notify();
}

export function clearSessionModeOverride(sessionId: string | null): void {
  if (!sessionId) return;
  if (overrides.delete(sessionId)) notify();
}

export function getSessionModeOverride(
  sessionId: string | null,
): ChatDisambiguationMode | undefined {
  if (!sessionId) return undefined;
  return overrides.get(sessionId);
}

export function getEffectiveChatMode(sessionId: string | null): ChatDisambiguationMode {
  return getSessionModeOverride(sessionId) ?? getChatDisambiguationMode();
}

export function useSessionModeOverride(sessionId: string | null): {
  override: ChatDisambiguationMode | undefined;
  effective: ChatDisambiguationMode;
  setOverride: (m: ChatDisambiguationMode) => void;
  clear: () => void;
} {
  const [, force] = useState(0);

  useEffect(() => {
    const fn = () => force((n) => n + 1);
    subs.add(fn);
    return () => {
      subs.delete(fn);
    };
  }, []);

  return {
    override: getSessionModeOverride(sessionId),
    effective: getEffectiveChatMode(sessionId),
    setOverride: (m) => sessionId && setSessionModeOverride(sessionId, m),
    clear: () => clearSessionModeOverride(sessionId),
  };
}
