/**
 * Hook + types for the user's default chat disambiguation mode.
 *
 * `targeted` ("Confirm before answering") — always ask one focused clarifying
 * question on ambiguity before opening a query.
 * `aggressive` ("Auto-answer with assumptions") — answer with sensible defaults,
 * state the assumptions, and offer a one-click change; ask only when the choice
 * would materially change the answer. The engine threshold + the agent posture
 * are enforced inside chat-service, not here.
 *
 * Default is `aggressive` (answers over questions). The storage key is stable,
 * so existing users keep whatever they previously chose — only first-time users
 * get the new default.
 *
 * Persists in localStorage via the shared user-prefs adapter so the chat
 * panel chip and the settings section stay in sync across mounts.
 */

import { useEffect, useState } from 'react';
import { createUserPrefsStore } from '../../shared/user-prefs/user-prefs-store';

export type ChatDisambiguationMode = 'targeted' | 'aggressive';

const DEFAULT_MODE: ChatDisambiguationMode = 'aggressive';

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
