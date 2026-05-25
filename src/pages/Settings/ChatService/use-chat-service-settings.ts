/**
 * useChatServiceSettings — localStorage-backed hook for chat-service runtime toggles.
 *
 * Key: `chat-service.settings` (JSON)
 * Defaults returned on missing or corrupt JSON (never throws on parse failure).
 * Writes are debounced 250ms to avoid hammering localStorage on rapid slider drags.
 *
 * Also exports `readChatServiceSettings()` for non-React consumers (SSE client).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface ChatServiceSettings {
  /** Override model per /turn request. null = use server default. */
  defaultModel: string | null;
  /** Send X-Bypass-Cache: 1 on every /turn when true. */
  bypassCache: boolean;
  /** Show a "Debug" link next to each chat session header. */
  showDebugLinks: boolean;
  /** Open raw-SDK-events accordion expanded by default in DevAudit. */
  rawEventsDefaultExpanded: boolean;
}

const STORAGE_KEY = 'chat-service.settings';

const DEFAULTS: ChatServiceSettings = {
  defaultModel: null,
  bypassCache: false,
  showDebugLinks: false,
  rawEventsDefaultExpanded: false,
};

/**
 * Parse settings from localStorage. Returns defaults on any parse error.
 * Safe to call outside React tree.
 */
export function readChatServiceSettings(): ChatServiceSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<ChatServiceSettings>;
    return {
      defaultModel: typeof parsed.defaultModel === 'string' ? parsed.defaultModel : null,
      bypassCache: typeof parsed.bypassCache === 'boolean' ? parsed.bypassCache : DEFAULTS.bypassCache,
      showDebugLinks: typeof parsed.showDebugLinks === 'boolean' ? parsed.showDebugLinks : DEFAULTS.showDebugLinks,
      rawEventsDefaultExpanded:
        typeof parsed.rawEventsDefaultExpanded === 'boolean'
          ? parsed.rawEventsDefaultExpanded
          : DEFAULTS.rawEventsDefaultExpanded,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function writeSettings(settings: ChatServiceSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Quota exceeded or private mode — silently ignore
  }
}

/**
 * Hook: [settings, patch] tuple.
 * patch accepts a partial update and merges it into the current settings.
 * Write to localStorage is debounced 250ms.
 */
export function useChatServiceSettings(): [ChatServiceSettings, (patch: Partial<ChatServiceSettings>) => void] {
  const [settings, setSettings] = useState<ChatServiceSettings>(() => readChatServiceSettings());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync from storage on mount (handles concurrent tabs)
  useEffect(() => {
    setSettings(readChatServiceSettings());
  }, []);

  const patch = useCallback((update: Partial<ChatServiceSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...update };
      // Cancel pending write and schedule a fresh one
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        writeSettings(next);
        debounceRef.current = null;
      }, 250);
      return next;
    });
  }, []);

  // Flush any pending write on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
        // Write immediately on unmount to avoid data loss
        writeSettings(readChatServiceSettings());
      }
    };
  }, []);

  return [settings, patch];
}
