/**
 * Tests for useDevAuditShortcuts:
 * - cmd-K fires onCmdK when within /dev/chat-audit route
 * - ctrl-K fires onCmdK (non-mac fallback)
 * - does NOT fire when outside /dev/chat-audit route
 * - cleans up listener on unmount
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useDevAuditShortcuts } from '../use-dev-audit-shortcuts';

// ── test harness component ────────────────────────────────────────────────────

function Harness({ onCmdK }: { onCmdK: () => void }) {
  useDevAuditShortcuts({ onCmdK });
  return null;
}

function renderAt(pathname: string, onCmdK: () => void) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <Harness onCmdK={onCmdK} />
    </MemoryRouter>,
  );
}

// ── helpers ───────────────────────────────────────────────────────────────────

function fireMetaK() {
  fireEvent.keyDown(document, { key: 'k', metaKey: true });
}

function fireCtrlK() {
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
}

function fireMetaOther() {
  fireEvent.keyDown(document, { key: 'p', metaKey: true });
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('useDevAuditShortcuts', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // The hook gates the modifier by platform (meta on mac, ctrl elsewhere).
  // jsdom reports a non-mac platform, so tests that assert the cmd-K (meta) path
  // fires must stub a mac platform first.
  function stubMac() {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
  }

  it('fires onCmdK when meta+K pressed on /dev/chat-audit/sessions', () => {
    stubMac();
    const onCmdK = vi.fn();
    renderAt('/dev/chat-audit/sessions', onCmdK);
    fireMetaK();
    expect(onCmdK).toHaveBeenCalledOnce();
  });

  it('fires onCmdK on any /dev/chat-audit/* sub-route', () => {
    stubMac();
    const onCmdK = vi.fn();
    renderAt('/dev/chat-audit/leaderboard', onCmdK);
    fireMetaK();
    expect(onCmdK).toHaveBeenCalledOnce();
  });

  it('fires onCmdK with ctrl+K (non-mac modifier)', () => {
    // Stub navigator.platform to non-mac so ctrlKey path is used
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
    const onCmdK = vi.fn();
    renderAt('/dev/chat-audit/search', onCmdK);
    fireCtrlK();
    expect(onCmdK).toHaveBeenCalledOnce();
  });

  it('does NOT fire when outside /dev/chat-audit', () => {
    const onCmdK = vi.fn();
    renderAt('/settings', onCmdK);
    fireMetaK();
    expect(onCmdK).not.toHaveBeenCalled();
  });

  it('does NOT fire on meta+P (wrong key)', () => {
    const onCmdK = vi.fn();
    renderAt('/dev/chat-audit/sessions', onCmdK);
    fireMetaOther();
    expect(onCmdK).not.toHaveBeenCalled();
  });

  it('removes event listener on unmount — no fire after unmount', () => {
    const onCmdK = vi.fn();
    const { unmount } = renderAt('/dev/chat-audit/sessions', onCmdK);
    unmount();
    fireMetaK();
    expect(onCmdK).not.toHaveBeenCalled();
  });

  it('calls preventDefault when cmd-K fires in dev-audit', () => {
    stubMac();
    const onCmdK = vi.fn();
    renderAt('/dev/chat-audit/sessions', onCmdK);
    const event = new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
    document.dispatchEvent(event);
    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it('does NOT fire when an INPUT element has focus', () => {
    const onCmdK = vi.fn();
    renderAt('/dev/chat-audit/sessions', onCmdK);
    // Attach a real input to document and focus it so activeElement is the input
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    try {
      fireEvent.keyDown(input, { key: 'k', metaKey: true });
      expect(onCmdK).not.toHaveBeenCalled();
    } finally {
      document.body.removeChild(input);
    }
  });

  it('does NOT fire when a TEXTAREA element has focus', () => {
    const onCmdK = vi.fn();
    renderAt('/dev/chat-audit/sessions', onCmdK);
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();
    try {
      fireEvent.keyDown(textarea, { key: 'k', metaKey: true });
      expect(onCmdK).not.toHaveBeenCalled();
    } finally {
      document.body.removeChild(textarea);
    }
  });

  it('does NOT fire when a contenteditable element has focus', () => {
    const onCmdK = vi.fn();
    renderAt('/dev/chat-audit/sessions', onCmdK);
    const div = document.createElement('div');
    div.contentEditable = 'true';
    document.body.appendChild(div);
    div.focus();
    try {
      fireEvent.keyDown(div, { key: 'k', metaKey: true });
      expect(onCmdK).not.toHaveBeenCalled();
    } finally {
      document.body.removeChild(div);
    }
  });
});
