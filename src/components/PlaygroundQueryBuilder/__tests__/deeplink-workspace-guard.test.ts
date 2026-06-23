/**
 * The guard drops a playground deeplink that was opened under one workspace
 * once the active workspace changes — the bug where switching prod → local kept
 * the prod query (`jus_vn__active_daily.dau`) and the new workspace 404'd it.
 *
 * Read (isDeeplinkForeign) is pure; the origin stamp moves only via commit.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  isDeeplinkForeign,
  commitDeeplinkWorkspace,
  __resetDeeplinkWorkspaceGuard,
} from '../deeplink-workspace-guard';

describe('deeplink workspace guard', () => {
  beforeEach(() => {
    __resetDeeplinkWorkspaceGuard();
  });

  it('honors a deeplink on first sight (no origin yet)', () => {
    expect(isDeeplinkForeign('prod', true)).toBe(false);
  });

  it('keeps a deeplink native while the workspace is unchanged', () => {
    commitDeeplinkWorkspace('prod', true);
    expect(isDeeplinkForeign('prod', true)).toBe(false);
  });

  it('flags the deeplink foreign after a switch, until the new workspace is committed', () => {
    // Opened under prod.
    commitDeeplinkWorkspace('prod', true);
    // User switches to local — the prod query is now foreign.
    expect(isDeeplinkForeign('local', true)).toBe(true);
    // The component commits the active workspace (its effect runs)...
    commitDeeplinkWorkspace('local', true);
    // ...and local's own subsequent query pushes read as native.
    expect(isDeeplinkForeign('local', true)).toBe(false);
  });

  it('reads the same verdict on repeat calls (pure — StrictMode double-invoke safe)', () => {
    commitDeeplinkWorkspace('prod', true);
    expect(isDeeplinkForeign('local', true)).toBe(true);
    expect(isDeeplinkForeign('local', true)).toBe(true); // unchanged: no mutation in the read
  });

  it('never flags when there is no deeplink in the URL', () => {
    commitDeeplinkWorkspace('prod', true);
    expect(isDeeplinkForeign('local', false)).toBe(false);
  });

  it('clears the origin when the URL loses its deeplink, so a later deeplink re-stamps', () => {
    commitDeeplinkWorkspace('prod', true);
    commitDeeplinkWorkspace('prod', false); // URL deeplink gone → origin cleared
    // A fresh deeplink opened under local is now native, not foreign.
    expect(isDeeplinkForeign('local', true)).toBe(false);
  });

  it('does not treat the boot transition (empty → resolved id) as a switch', () => {
    // Registry not resolved yet: empty workspace id must not stamp or judge.
    expect(isDeeplinkForeign('', true)).toBe(false);
    commitDeeplinkWorkspace('', true); // no-op stamp
    // Workspace resolves to prod — still native, not a foreign switch.
    expect(isDeeplinkForeign('prod', true)).toBe(false);
    commitDeeplinkWorkspace('prod', true);
    expect(isDeeplinkForeign('prod', true)).toBe(false);
  });
});
