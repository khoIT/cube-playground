/**
 * Hook + types for the user's default chat disambiguation mode.
 *
 * `targeted` — always ask one focused clarifying question on ambiguity.
 * `aggressive` — auto-resolve when the engine confidence >= threshold,
 * otherwise fall back to a clarifying question. The threshold is enforced
 * inside chat-service (see chat-service/src/nl-to-query/), not here.
 *
 * Persists in localStorage via the shared user-prefs adapter so the chat
 * panel chip and the settings section stay in sync across mounts.
 */

import { useEffect, useState } from 'react';
import { createUserPrefsStore } from '../../shared/user-prefs/user-prefs-store';

export type ChatDisambiguationMode = 'targeted' | 'aggressive';

const DEFAULT_MODE: ChatDisambiguationMode = 'targeted';

const store = createUserPrefsStore<ChatDisambiguationMode>(
  'chat:disambiguation-mode',
  DEFAULT_MODE,
);

function readSafe(): ChatDisambiguationMode {
  const v = store.read();
  return v === 'targeted' || v === 'aggressive' ? v : DEFAULT_MODE;
}

export function getChatDisambiguationMode(): ChatDisambiguationMode {
  return readSafe();
}

export function useChatDisambiguationMode(): {
  mode: ChatDisambiguationMode;
  setMode: (next: ChatDisambiguationMode) => void;
} {
  const [mode, setLocal] = useState<ChatDisambiguationMode>(readSafe);

  useEffect(() => store.subscribe(() => setLocal(readSafe())), []);

  return {
    mode,
    setMode: (next) => store.write(next),
  };
}
