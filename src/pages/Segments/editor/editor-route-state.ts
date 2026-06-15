/**
 * Router location-state contract for opening the Segments editor pre-seeded
 * from another surface (e.g. the Advisor's proposed cohort) and returning the
 * user to where they came from once they save.
 *
 * The Advisor pushes this on `history.push('/segments/new', state)`; the editor
 * reads it on mount to seed the builder, and on save navigates to `returnTo`.
 */

import type { PredicateNode } from '../../../types/segment-api';

/** Builder seed: any subset is applied; missing fields keep editor defaults. */
export interface EditorPrefill {
  name?: string;
  cube?: string;
  predicateTree?: PredicateNode;
}

export interface EditorReturnTo {
  /** Destination path; a literal `:id` is replaced with the created segment id. */
  pathTemplate: string;
  /** Router location state carried into the return navigation (e.g. driveBoot). */
  state?: unknown;
}

export interface EditorLocationState {
  /** null → start blank ("build new from scratch"); object → seed the builder. */
  advisorPrefill?: EditorPrefill | null;
  /** Where to send the user after a successful create (defaults to the segment). */
  returnTo?: EditorReturnTo;
}

/**
 * Resolve the post-create destination by substituting the freshly-created
 * segment id for the `:id` placeholder in the return path. A template without
 * `:id` is returned unchanged (a fixed destination).
 */
export function resolveReturnPath(returnTo: EditorReturnTo, createdId: string): string {
  return returnTo.pathTemplate.replace(':id', createdId);
}
