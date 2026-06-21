/**
 * Persist a cube the assistant referenced via {{field:cube.member}} in a reply
 * it never charted, so the NEXT turn can anchor an otherwise-unresolvable
 * follow-up to it (assistant suggests `etl_money_flow.total_out` in prose →
 * user replies "show inflow vs outflow" → the resolver anchors to
 * `etl_money_flow` instead of returning a canned, cross-cube clarify menu).
 *
 * Only fires when the turn charted nothing — a turn that emitted an artifact
 * already leaves a `lastQuery`/`metric` anchor in disambig memory. All failures
 * are logged and swallowed (non-fatal to the turn).
 */

import type Database from 'better-sqlite3';
import { config } from '../../config.js';
import { mergeResolution } from '../../cache/disambig-memory-adapter.js';
import {
  lastSuggestedCube,
  extractSuggestedFieldRefs,
} from '../../nl-to-query/message-anchored-resolution.js';

interface Args {
  db: Database.Database;
  sessionId: string;
  ownerId: string;
  assistantText: string;
  artifactCount: number;
  logger: { warn: (obj: unknown, msg?: string) => void };
}

export function writeSuggestedCube(args: Args): void {
  const { db, sessionId, ownerId, assistantText, artifactCount, logger } = args;
  if (!config.cacheServiceEnabled) return;
  if (artifactCount > 0 || !assistantText) return;
  const cube = lastSuggestedCube(assistantText);
  if (!cube) return;
  const refs = extractSuggestedFieldRefs(assistantText);
  try {
    mergeResolution(db, sessionId, ownerId, {
      suggestedCube: { value: cube, phrase: refs[refs.length - 1] },
    });
  } catch (err) {
    logger.warn({ err }, '[turn] suggestedCube write failed (non-fatal)');
  }
}
