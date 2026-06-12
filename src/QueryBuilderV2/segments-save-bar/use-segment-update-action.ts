/**
 * Hook encapsulating the segment "Update" action from playground edit mode.
 *
 * Isolates the async PATCH pipeline from the save-bar render logic:
 *   1. Strip echo filters (game-scoping injections) by exact structural match.
 *   2. Convert the cleaned query to a predicate tree via buildPredicateFromRows.
 *   3. PATCH with { predicate_tree, cube_segments, type:'predicate' }.
 *   4. Navigate to segment detail on success.
 *   5. Surface 400/403/404 as toasts; drop edit mode on auth/not-found errors.
 */

import { useState } from 'react';
import { useHistory } from 'react-router-dom';
import { message } from 'antd';
import type { Query } from '@cubejs-client/core';
import { buildPredicateFromRows } from './build-predicate-from-rows';
import { stripEchoFilters } from './echo-filter-stripper';
import { segmentsClient } from '../../api/segments-client';
import type { SegmentEditSession } from '../../components/PlaygroundQueryBuilder/segment-edit-react-context';

export interface SegmentUpdateActionResult {
  /** True while the PATCH request is in-flight. */
  updating: boolean;
  /** Call to execute the update. Resolves when the navigation fires or on error. */
  executeUpdate: (segmentId: string) => Promise<void>;
}

export function useSegmentUpdateAction(
  executedQuery: Query | null | undefined,
  identityField: string | null,
  editSession: SegmentEditSession | null,
): SegmentUpdateActionResult {
  const history = useHistory();
  const [updating, setUpdating] = useState(false);

  const executeUpdate = async (segmentId: string) => {
    if (!executedQuery || !identityField || !editSession) return;
    setUpdating(true);
    try {
      const stripped = stripEchoFilters(executedQuery, editSession.editContext.echoFilters);
      const tree = buildPredicateFromRows(stripped, [], identityField);
      const cubeSegments = (executedQuery.segments as string[] | undefined) ?? [];

      await segmentsClient.update(segmentId, {
        predicate_tree: tree,
        cube_segments: cubeSegments,
        type: 'predicate',
      });

      message.success(`Segment "${editSession.editContext.segmentName}" updated`);
      editSession.exitEditMode();
      history.push(`/segments/${segmentId}`);
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if (status === 403 || status === 404) {
        message.error(
          status === 403
            ? 'You no longer have permission to edit this segment.'
            : 'Segment not found — it may have been deleted.',
        );
        editSession.exitEditMode();
      } else {
        const serverMsg =
          (err as { message?: string })?.message ??
          'Update failed — the server rejected the predicate.';
        message.error(serverMsg);
      }
    } finally {
      setUpdating(false);
    }
  };

  return { updating, executeUpdate };
}
