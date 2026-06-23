/**
 * Regression: switching workspace must drop any playground deeplink from the
 * URL hash.
 *
 * A `?query=` deeplink encodes physical cube member names from the workspace it
 * was built in (prod `jus_vn__active_daily.dau` vs local `jus_vn_active_daily.dau`).
 * Carried across a switch, the new workspace can't resolve them ("Cube not
 * found") and the remounted QueryTabs seeds its first tab with the foreign
 * query. The strip happens at the switch source (setWorkspaceId) because the
 * token re-mint a switch triggers remounts the playground — an in-component
 * effect keyed on a mount-initialized ref misses the switch when it remounts.
 */

import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceProvider, useWorkspaceContext } from '../workspace-context';

vi.mock('../../auth/auth-storage', () => ({
  readAppToken: () => null,
}));

vi.mock('../../hooks/server-prefs-store', () => ({
  getPref: () => 'prod',
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
        { id: 'prod', label: 'Production', gameModel: 'prefix', authMode: 'none', isDefault: false },
        { id: 'local', label: 'Local', gameModel: 'game_id', authMode: 'minted', isDefault: true },
      ],
    }),
  } as Response;
}

// Captures setWorkspaceId from context so the test can drive a switch.
let switchTo: ((id: string) => void) | null = null;
function Probe() {
  const { setWorkspaceId, ready } = useWorkspaceContext();
  switchTo = ready ? setWorkspaceId : null;
  return null;
}

describe('workspace switch strips playground deeplink from hash', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => mockWorkspacesResponse()));
    switchTo = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.location.hash = '';
  });

  it('drops ?query= when switching off the playground page', async () => {
    window.location.hash = '#/build?query=%7B%22measures%22%3A%5B%22jus_vn__active_daily.dau%22%5D%7D';

    render(
      <WorkspaceProvider>
        <Probe />
      </WorkspaceProvider>,
    );

    await waitFor(() => expect(switchTo).toBeTypeOf('function'));
    act(() => switchTo!("local"));

    expect(window.location.hash).toBe('#/build');
  });

  it('preserves non-deeplink params on /build (e.g. a view flag)', async () => {
    window.location.hash = '#/build?query=%7B%7D&view=table';

    render(
      <WorkspaceProvider>
        <Probe />
      </WorkspaceProvider>,
    );

    await waitFor(() => expect(switchTo).toBeTypeOf('function'));
    act(() => switchTo!("local"));

    expect(window.location.hash).toBe('#/build?view=table');
  });

  it('leaves a non-playground route untouched', async () => {
    window.location.hash = '#/segments?query=keep-me';

    render(
      <WorkspaceProvider>
        <Probe />
      </WorkspaceProvider>,
    );

    await waitFor(() => expect(switchTo).toBeTypeOf('function'));
    act(() => switchTo!("local"));

    expect(window.location.hash).toBe('#/segments?query=keep-me');
  });
});
