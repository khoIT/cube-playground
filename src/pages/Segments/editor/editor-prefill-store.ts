/**
 * Hash-history bridge for opening the Segments editor pre-seeded.
 *
 * react-router v5 runs on history@4, whose hash history SILENTLY DROPS
 * `location.state` — there is nowhere in the URL hash to persist it. So
 * `history.push('/segments/new', state)` arrives at the editor with
 * `location.state === undefined`, and the builder cannot prefill the name,
 * cube, or predicate (nor honour a returnTo target).
 *
 * We stash the EditorLocationState in sessionStorage under a fixed slot and
 * consume it once on the editor's mount. sessionStorage (not a module variable)
 * so a hard reload mid-flow still resolves, and it is scoped to the tab.
 */

import type { EditorLocationState } from './editor-route-state';

const KEY = 'cube:segment-editor-prefill';

/** Stash editor entry-state just before navigating to /segments/new. */
export function stashEditorPrefill(state: EditorLocationState): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // sessionStorage unavailable (private mode / quota) — prefill is best-effort.
  }
}

/** Read and clear the stashed entry-state (one-shot). Null if nothing stashed. */
export function consumeEditorPrefill(): EditorLocationState | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    return JSON.parse(raw) as EditorLocationState;
  } catch {
    return null;
  }
}
