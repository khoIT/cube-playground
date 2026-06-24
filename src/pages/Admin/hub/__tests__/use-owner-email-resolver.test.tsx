/**
 * Tests for useOwnerEmailResolver — maps a session owner_id (Keycloak sub) to
 * the owner's email for the admin chat-audit Sessions owner filter, with
 * fallback to label then ownerId.
 */

import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// Mock the admin users source the resolver builds its sub→email map from.
const mockUsers = vi.fn();
vi.mock('../../access/use-admin-access', () => ({
  useAdminUsers: () => ({ users: mockUsers(), loading: false, error: null, refetch: vi.fn() }),
}));

import { useOwnerEmailResolver } from '../use-owner-email-resolver';

function setup() {
  return renderHook(() => useOwnerEmailResolver());
}

describe('useOwnerEmailResolver', () => {
  it('resolves a known sub to its email', () => {
    mockUsers.mockReturnValue([
      { email: 'alice@vng.com.vn', kcSub: 'sub-alice', role: 'admin', status: 'active', workspaces: [], gamesByWorkspace: {}, features: {}, lastLogin: null },
    ]);
    const { result } = setup();
    expect(result.current({ ownerId: 'sub-alice', label: null })).toBe('alice@vng.com.vn');
  });

  it('falls back to label when the sub is unknown', () => {
    mockUsers.mockReturnValue([]);
    const { result } = setup();
    expect(result.current({ ownerId: 'sub-x', label: 'Some Label' })).toBe('Some Label');
  });

  it('falls back to ownerId when neither email nor label is available', () => {
    mockUsers.mockReturnValue([]);
    const { result } = setup();
    expect(result.current({ ownerId: 'starter-question-verifier', label: null })).toBe('starter-question-verifier');
  });

  it('ignores users with a null kcSub when building the map', () => {
    mockUsers.mockReturnValue([
      { email: 'no-sub@vng.com.vn', kcSub: null, role: 'viewer', status: 'active', workspaces: [], gamesByWorkspace: {}, features: {}, lastLogin: null },
    ]);
    const { result } = setup();
    // ownerId '' would never match; an unrelated sub falls through to ownerId.
    expect(result.current({ ownerId: 'sub-y', label: null })).toBe('sub-y');
  });
});
