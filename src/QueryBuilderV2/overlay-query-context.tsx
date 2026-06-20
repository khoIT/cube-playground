/**
 * OverlayQueryContext — carries a combined artifact's OVERLAY query into the
 * builder's center chart WITHOUT touching the heavily-memoized
 * QueryBuilderContext (80+ consumers). The overlay is a read-only second series
 * rendered alongside the primary result; it is NOT part of the editable query
 * state and NOT a compare mode. A null value (the default) is the normal path —
 * the center renders exactly as before.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Query } from '@cubejs-client/core';

interface OverlayContextValue {
  /** The overlay query for the current builder session, or null when not combined. */
  query: Query | null;
  /** Dismiss the overlay (remove it from the durable store + hide it now). No-op when none. */
  clear: () => void;
}

const NOOP = () => {};
const OverlayQueryContext = createContext<OverlayContextValue>({ query: null, clear: NOOP });

export function OverlayQueryProvider({
  overlayQuery,
  onClear,
  children,
}: {
  overlayQuery: Query | null;
  onClear?: () => void;
  children: ReactNode;
}) {
  const value = useMemo<OverlayContextValue>(
    () => ({ query: overlayQuery, clear: onClear ?? NOOP }),
    [overlayQuery, onClear],
  );
  return <OverlayQueryContext.Provider value={value}>{children}</OverlayQueryContext.Provider>;
}

/** The overlay query for the current builder session, or null when not combined. */
export function useOverlayQuery(): Query | null {
  return useContext(OverlayQueryContext).query;
}

/** Dismiss the active overlay from the Results chip. No-op when there's no overlay. */
export function useClearOverlay(): () => void {
  return useContext(OverlayQueryContext).clear;
}
