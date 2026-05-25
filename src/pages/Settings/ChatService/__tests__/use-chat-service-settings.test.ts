/**
 * Tests for useChatServiceSettings + readChatServiceSettings.
 * Uses vitest + jsdom (localStorage available in test env).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  readChatServiceSettings,
  useChatServiceSettings,
  type ChatServiceSettings,
} from '../use-chat-service-settings';

const STORAGE_KEY = 'chat-service.settings';

const DEFAULTS: ChatServiceSettings = {
  defaultModel: null,
  bypassCache: false,
  showDebugLinks: false,
  rawEventsDefaultExpanded: false,
};

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// readChatServiceSettings (non-hook helper)
// ---------------------------------------------------------------------------

describe('readChatServiceSettings', () => {
  it('returns defaults when localStorage is empty', () => {
    expect(readChatServiceSettings()).toEqual(DEFAULTS);
  });

  it('returns defaults on corrupt JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json}');
    expect(readChatServiceSettings()).toEqual(DEFAULTS);
  });

  it('returns defaults on partial / missing keys', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ bypassCache: true }));
    const result = readChatServiceSettings();
    expect(result.bypassCache).toBe(true);
    expect(result.defaultModel).toBeNull();
    expect(result.showDebugLinks).toBe(false);
    expect(result.rawEventsDefaultExpanded).toBe(false);
  });

  it('reads full settings correctly', () => {
    const stored: ChatServiceSettings = {
      defaultModel: 'claude-haiku-4-5',
      bypassCache: true,
      showDebugLinks: true,
      rawEventsDefaultExpanded: true,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    expect(readChatServiceSettings()).toEqual(stored);
  });

  it('rejects wrong types and returns defaults for each field', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ defaultModel: 42, bypassCache: 'yes', showDebugLinks: 1 }),
    );
    const result = readChatServiceSettings();
    expect(result.defaultModel).toBeNull();
    expect(result.bypassCache).toBe(false);
    expect(result.showDebugLinks).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// useChatServiceSettings (React hook)
// ---------------------------------------------------------------------------

describe('useChatServiceSettings', () => {
  it('returns defaults when storage is empty', () => {
    const { result } = renderHook(() => useChatServiceSettings());
    const [settings] = result.current;
    expect(settings).toEqual(DEFAULTS);
  });

  it('patch merges partial update into current state', () => {
    const { result } = renderHook(() => useChatServiceSettings());
    act(() => {
      result.current[1]({ bypassCache: true });
    });
    expect(result.current[0].bypassCache).toBe(true);
    // Other fields unchanged
    expect(result.current[0].defaultModel).toBeNull();
    expect(result.current[0].showDebugLinks).toBe(false);
  });

  it('debounces localStorage write by 250ms', () => {
    const { result } = renderHook(() => useChatServiceSettings());
    act(() => {
      result.current[1]({ showDebugLinks: true });
    });
    // Write not yet committed
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(250);
    });
    const written = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as ChatServiceSettings;
    expect(written.showDebugLinks).toBe(true);
  });

  it('multiple rapid patches only write once after 250ms', () => {
    const { result } = renderHook(() => useChatServiceSettings());
    act(() => {
      result.current[1]({ bypassCache: true });
      result.current[1]({ showDebugLinks: true });
      result.current[1]({ defaultModel: 'claude-opus-4-6' });
    });
    act(() => { vi.advanceTimersByTime(100); });
    // Still not written
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    act(() => { vi.advanceTimersByTime(200); });
    const written = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as ChatServiceSettings;
    expect(written.defaultModel).toBe('claude-opus-4-6');
    expect(written.bypassCache).toBe(true);
    expect(written.showDebugLinks).toBe(true);
  });

  it('patch does not clobber unrelated keys', () => {
    const { result } = renderHook(() => useChatServiceSettings());
    act(() => {
      result.current[1]({ rawEventsDefaultExpanded: true });
    });
    expect(result.current[0].bypassCache).toBe(false);
    expect(result.current[0].rawEventsDefaultExpanded).toBe(true);
  });

  it('reads pre-existing localStorage value on mount', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ defaultModel: 'claude-sonnet-4-6', bypassCache: true, showDebugLinks: false, rawEventsDefaultExpanded: false }),
    );
    const { result } = renderHook(() => useChatServiceSettings());
    expect(result.current[0].defaultModel).toBe('claude-sonnet-4-6');
    expect(result.current[0].bypassCache).toBe(true);
  });
});
