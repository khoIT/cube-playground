/**
 * Tests for useChatSurfaces visibility matrix.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useChatSurfaces } from '../use-chat-surfaces';

// ---------------------------------------------------------------------------
// Mock chat-panel-open-store so tests control the open flag directly.
// ---------------------------------------------------------------------------

const mockGetOpen = vi.fn(() => false);

vi.mock('../chat-panel-open-store', () => {
  return {
    useChatPanelOpen: () => mockGetOpen(),
    getOpen: () => mockGetOpen(),
    setOpen: vi.fn(),
    onOpenChange: vi.fn(() => () => {}),
    getWidth: vi.fn(() => 420),
    setWidth: vi.fn(),
    onWidthChange: vi.fn(() => () => {}),
    useChatPanelWidth: vi.fn(() => 420),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderAt(path: string, panelOpen: boolean) {
  mockGetOpen.mockReturnValue(panelOpen);
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
  );
  const { result } = renderHook(() => useChatSurfaces(), { wrapper });
  return result.current;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useChatSurfaces', () => {
  beforeEach(() => {
    mockGetOpen.mockReturnValue(false);
  });

  it('/chat → pageVisible only', () => {
    const s = renderAt('/chat', false);
    expect(s.pageVisible).toBe(true);
    expect(s.fabVisible).toBe(false);
    expect(s.panelVisible).toBe(false);
  });

  it('/chat/abc → pageVisible only', () => {
    const s = renderAt('/chat/abc', false);
    expect(s.pageVisible).toBe(true);
    expect(s.fabVisible).toBe(false);
    expect(s.panelVisible).toBe(false);
  });

  it('/build + panel closed → fabVisible only', () => {
    const s = renderAt('/build', false);
    expect(s.fabVisible).toBe(true);
    expect(s.panelVisible).toBe(false);
    expect(s.pageVisible).toBe(false);
  });

  it('/build + panel open → panelVisible only', () => {
    const s = renderAt('/build', true);
    expect(s.panelVisible).toBe(true);
    expect(s.fabVisible).toBe(false);
    expect(s.pageVisible).toBe(false);
  });
});
