/**
 * Tests for openArtifactInPlayground — the shared deeplink writer. Verifies a
 * combined artifact writes the primary (one-shot sessionStorage) AND the overlay
 * (durable localStorage store, so a /build refresh keeps the dual-axis), a
 * single artifact writes only the primary, and a combined artifact missing its
 * overlay degrades to primary-only (graceful, no crash).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openArtifactInPlayground } from '../open-artifact-in-playground';
import { loadOverlayPayload } from '../../../../QueryBuilderV2/overlay-deeplink-store';
import type { QueryArtifact } from '../../../../api/chat-sse-client';

const PRIMARY_KEY = (id: string) => `gds-cube:pending-chat-deeplink:${id}`;

function baseArtifact(overrides: Partial<QueryArtifact>): QueryArtifact {
  return {
    id: 'A1',
    title: 't', summary: 's', source: 'raw',
    query: { measures: ['a.m'] },
    payload: { measures: ['a.m'] },
    deeplinkVia: 'session-storage',
    deeplinkUrl: '#/build?from-chat-artifact=A1',
    ...overrides,
  } as QueryArtifact;
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe('openArtifactInPlayground', () => {
  it('combined: writes the primary key AND the durable overlay store + navigates', () => {
    const history = { push: vi.fn() };
    const artifact = baseArtifact({
      combined: true,
      overlay: { measures: ['b.n'] },
      deeplinkUrl: '#/build?from-chat-artifact=A1&combined=1',
    });
    openArtifactInPlayground(artifact, history);

    expect(JSON.parse(sessionStorage.getItem(PRIMARY_KEY('A1'))!)).toEqual({ measures: ['a.m'] });
    // Overlay lives in the durable store (survives a /build refresh).
    expect(loadOverlayPayload('A1')).toEqual({ measures: ['b.n'] });
    expect(history.push).toHaveBeenCalledTimes(1);
    expect(history.push.mock.calls[0][0]).toMatch(/^\/build\?from-chat-artifact=A1&combined=1&n=/);
  });

  it('single artifact: writes only the primary key, no overlay stored', () => {
    const history = { push: vi.fn() };
    openArtifactInPlayground(baseArtifact({}), history);

    expect(sessionStorage.getItem(PRIMARY_KEY('A1'))).toBeTruthy();
    expect(loadOverlayPayload('A1')).toBeNull();
  });

  it('combined but missing overlay: degrades to primary-only (nothing stored)', () => {
    const history = { push: vi.fn() };
    openArtifactInPlayground(
      baseArtifact({ combined: true, overlay: undefined, deeplinkUrl: '#/build?from-chat-artifact=A1&combined=1' }),
      history,
    );
    expect(sessionStorage.getItem(PRIMARY_KEY('A1'))).toBeTruthy();
    expect(loadOverlayPayload('A1')).toBeNull();
  });

  it('inline single: no sessionStorage writes', () => {
    const history = { push: vi.fn() };
    openArtifactInPlayground(
      baseArtifact({ deeplinkVia: 'inline', deeplinkUrl: '#/build?query=%7B%7D' }),
      history,
    );
    expect(sessionStorage.getItem(PRIMARY_KEY('A1'))).toBeNull();
  });
});
