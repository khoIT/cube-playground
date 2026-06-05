/**
 * Regression: the workspace registry fetch MUST carry the app JWT.
 *
 * A tokenless `fetch('/api/workspaces')` makes the server take its
 * "anonymous → return ALL workspaces" branch, bypassing the per-user grant
 * filter — so a grant-restricted user (e.g. prod-only) would still see `local`
 * in the switcher. This only repros on real-auth stacks (:11000 / prod), never
 * in AUTH_DISABLED dev, so a unit test is the cheapest guard.
 */

import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceProvider } from '../workspace-context';

const readAppTokenMock = vi.fn<[], string | null>(() => null);

vi.mock('../../auth/auth-storage', () => ({
  readAppToken: () => readAppTokenMock(),
}));

// No persisted selection + inert pref store so the provider runs its fetch path.
vi.mock('../../hooks/server-prefs-store', () => ({
  getPref: () => null,
  setPref: vi.fn(),
  subscribe: () => () => {},
}));

vi.mock('../../api/feature-open-beacon', () => ({
  recordWorkspaceSwitch: vi.fn(),
}));

function mockWorkspacesResponse() {
  return {
    ok: true,
    json: async () => ({
      workspaces: [
        { id: 'prod', label: 'Prod cube-dev', gameModel: 'prefix', authMode: 'none', isDefault: false },
      ],
    }),
  } as Response;
}

describe('WorkspaceProvider registry fetch auth', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => mockWorkspacesResponse());
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    readAppTokenMock.mockReset();
  });

  it('attaches Authorization: Bearer when an app token is present', async () => {
    readAppTokenMock.mockReturnValue('test-token');

    render(
      <WorkspaceProvider>
        <div />
      </WorkspaceProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces', {
      headers: { Authorization: 'Bearer test-token' },
    });
  });

  it('stays tokenless (anonymous path) when no app token exists', async () => {
    readAppTokenMock.mockReturnValue(null);

    render(
      <WorkspaceProvider>
        <div />
      </WorkspaceProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces', undefined);
  });
});
