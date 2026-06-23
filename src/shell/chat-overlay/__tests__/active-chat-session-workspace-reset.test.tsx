/**
 * The chat panel's active-session pointer must drop when the workspace changes:
 * sessions are scoped per workspace, so a switch should not leave the previous
 * workspace's conversation rendered. Verifies the module-level reset listener.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getActiveChatSession,
  setActiveChatSession,
} from '../use-active-chat-session';

const WORKSPACE_CHANGE_EVENT = 'gds-cube:workspace-change';

describe('active chat session — workspace isolation', () => {
  beforeEach(() => setActiveChatSession(null));

  it('clears the active session on a workspace-change event', () => {
    setActiveChatSession('sess-from-prod');
    expect(getActiveChatSession()).toBe('sess-from-prod');

    window.dispatchEvent(
      new CustomEvent(WORKSPACE_CHANGE_EVENT, { detail: { workspaceId: 'local' } }),
    );

    expect(getActiveChatSession()).toBeNull();
  });

  it('stays null when no session is active', () => {
    window.dispatchEvent(new CustomEvent(WORKSPACE_CHANGE_EVENT));
    expect(getActiveChatSession()).toBeNull();
  });
});
