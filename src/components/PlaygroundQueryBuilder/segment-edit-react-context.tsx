/**
 * React context that carries an active segment-edit session from
 * QueryBuilderContainer down to SegmentsSaveBar (deep inside QueryBuilderResults)
 * without prop-drilling through files we don't own.
 *
 * Provider: QueryBuilderContainer (wraps the entire CubeProvider tree).
 * Consumer: SegmentsSaveBar (reads via useSegmentEditSession).
 *
 * Null means no segment is currently being edited (normal exploration mode).
 */

import { createContext, useContext } from 'react';
import type { SegmentType } from '../../types/segment-api';
import type { SegmentEditContext } from '../../utils/playground-deeplink';

export interface SegmentEditSession {
  /** The resolved edit context from the ?edit-segment= deeplink. */
  editContext: SegmentEditContext;
  /** True when the active game differs from editContext.gameId — Update is blocked. */
  gameMismatch: boolean;
  /** Segment type fetched at session boot — 'manual' triggers conversion confirm. */
  segmentType: SegmentType | null;
  /** False when the caller lacks owner/admin rights — Update button is hidden. */
  canAdminister: boolean;
  /** Called when the user clicks ✕ in the banner, Update completes, or the
   *  cube/tab changes mid-session (guards against overwriting with an
   *  unrelated query). */
  exitEditMode: () => void;
}

export const SegmentEditSessionContext = createContext<SegmentEditSession | null>(null);

/** Returns the active segment edit session, or null if in normal explore mode. */
export function useSegmentEditSession(): SegmentEditSession | null {
  return useContext(SegmentEditSessionContext);
}
