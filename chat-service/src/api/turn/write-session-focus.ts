/**
 * Snapshot the turn's resolved disambiguation slots + skill + last artifact id
 * into the session focus bag, then broadcast the updated bag on the open
 * stream so the chat-header chip refreshes without a poll.
 *
 * Extracted from the turn handler. The focus bag carries structured context
 * forward across compaction (SDK resume gives prose continuity; focus gives the
 * model a structured anchor). No-op when the focus-store flag is off; all
 * failures are logged and swallowed (non-fatal to the turn).
 */

import type Database from 'better-sqlite3';
import { config } from '../../config.js';
import type { QueryArtifact } from '../../types.js';
import { getFocus, mergeFocus, type SessionFocus } from '../../cache/session-focus-adapter.js';
import { getResolutions } from '../../cache/disambig-memory-adapter.js';
import { emitFocusUpdated } from '../chat-session-focus.js';

interface Args {
  db: Database.Database;
  sessionId: string;
  ownerId: string;
  skill: string;
  collectedArtifacts: QueryArtifact[];
  logger: { warn: (obj: unknown, msg?: string) => void };
}

export function writeSessionFocus(args: Args): void {
  if (!config.chatContextFocusStoreEnabled) return;
  const { db, sessionId, ownerId, skill, collectedArtifacts, logger } = args;
  try {
    const res = getResolutions(db, sessionId);
    const delta: Partial<SessionFocus> = { skill: { value: skill } };
    if (res.metric) delta.metric = res.metric;
    if (res.dimension) delta.dimension = res.dimension;
    if (res.timeRange) delta.timeRange = res.timeRange;
    if (res.filters) delta.filters = res.filters;
    if (res.intent) delta.intent = res.intent;
    if (res.concept) delta.concept = res.concept;
    if (res.entity) delta.entity = res.entity;
    const lastArtifact = collectedArtifacts[collectedArtifacts.length - 1];
    if (lastArtifact) delta.artifactRef = { value: lastArtifact.id };
    mergeFocus(db, sessionId, ownerId, delta);
    // Re-read the bag (merge re-derives `updatedAt`) and broadcast on the
    // current stream so an open hook sees the bag identical to GET /focus.
    try {
      emitFocusUpdated(sessionId, getFocus(db, sessionId));
    } catch (broadcastErr) {
      logger.warn({ err: broadcastErr }, '[turn] focus_updated broadcast failed (non-fatal)');
    }
  } catch (focusErr) {
    logger.warn({ err: focusErr }, '[turn] focus write failed (non-fatal)');
  }
}
