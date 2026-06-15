/**
 * DriveArtifact — what a finished Drive (live AI) investigation hands to the
 * Decide screen, so both postures (manual Explore + Drive) converge there.
 *
 * The canonical piece is the agent-scaffolded ExperimentDraft, which is now
 * self-describing (carries its own blueprint + readout). The agent persists it
 * server-side (the SSE edge can't carry structured tool output), so on turn
 * completion we fetch the most-recent draft for the segment and wrap it.
 */

import type { ExperimentDraft, AdvisorGoal } from '../../api/advisor';
import { listDrafts } from '../../api/advisor';
import type { GoalKey } from './advisor-types';

export interface DriveArtifact {
  source: 'drive';
  /** Which investigation produced it (provenance). */
  sessionId: string | null;
  goal: GoalKey;
  segmentId: string;
  gameId: string;
  /** The canonical, self-describing experiment artifact. */
  draft: ExperimentDraft;
}

/** Narrow the agent goal ('both' has no manual equivalent) to a Decide GoalKey. */
function toGoalKey(goal: AdvisorGoal): GoalKey {
  return goal === 'engagement' ? 'engagement' : 'revenue';
}

/**
 * Fetch the draft the agent scaffolded during this Drive session and wrap it as
 * a hand-off artifact. Returns null when no draft exists yet for the segment
 * (the agent didn't reach scaffold_draft — the caller offers a steer fallback).
 */
export async function fetchDriveArtifact(opts: {
  segmentId: string;
  gameId: string;
  goal: AdvisorGoal;
  sessionId: string | null;
}): Promise<DriveArtifact | null> {
  const { drafts } = await listDrafts(opts.segmentId);
  const draft = drafts[0]; // store orders updated_at DESC → this session's draft
  if (!draft) return null;
  return {
    source: 'drive',
    sessionId: opts.sessionId,
    goal: toGoalKey(opts.goal),
    segmentId: opts.segmentId,
    gameId: opts.gameId,
    draft,
  };
}
