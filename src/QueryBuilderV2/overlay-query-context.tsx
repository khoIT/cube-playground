/**
 * OverlayQueryContext — carries a combined artifact's OVERLAY query into the
 * builder's center chart WITHOUT touching the heavily-memoized
 * QueryBuilderContext (80+ consumers). The overlay is a read-only second series
 * rendered alongside the primary result; it is NOT part of the editable query
 * state and NOT a compare mode. A null value (the default) is the normal path —
 * the center renders exactly as before.
 */

import { createContext, useContext, type ReactNode } from 'react';
import type { Query } from '@cubejs-client/core';

const OverlayQueryContext = createContext<Query | null>(null);

export function OverlayQueryProvider({
  overlayQuery,
  children,
}: {
  overlayQuery: Query | null;
  children: ReactNode;
}) {
  return <OverlayQueryContext.Provider value={overlayQuery}>{children}</OverlayQueryContext.Provider>;
}

/** The overlay query for the current builder session, or null when not combined. */
export function useOverlayQuery(): Query | null {
  return useContext(OverlayQueryContext);
}
