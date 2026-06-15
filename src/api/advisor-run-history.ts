/**
 * Client for the user-facing advisor run history (the caller's OWN past Drive
 * investigations). Backed by GET /api/advisor/runs[/:sessionId], which is
 * owner-scoped server-side — these calls never return another user's runs.
 */

import { apiFetch } from './api-client';

export interface AdvisorRunListItem {
  sessionId: string;
  gameId: string;
  segmentId: string | null;
  scopeKind: string;
  goal: string;
  mode: string;
  finalStopReason: string | null;
  turnCount: number;
  totalCostUsd: number;
  createdAt: number;
  lastActiveAt: number;
}

export interface AdvisorReplayToolCall {
  tool: string;
  state: string;
  validated: boolean;
}

export interface AdvisorReplayTurn {
  turnIndex: number;
  mode: string;
  message: string | null;
  narration: string | null;
  stopReason: string;
  toolCalls: AdvisorReplayToolCall[];
}

export interface AdvisorRunReplay {
  run: AdvisorRunListItem;
  turns: AdvisorReplayTurn[];
}

/** The signed-in user's recent advisor runs, newest first. */
export function fetchMyAdvisorRuns(): Promise<{ runs: AdvisorRunListItem[] }> {
  return apiFetch<{ runs: AdvisorRunListItem[] }>('/api/advisor/runs');
}

/** One of the caller's runs as a read-only transcript (404 if not theirs). */
export function fetchAdvisorRunReplay(sessionId: string): Promise<AdvisorRunReplay> {
  return apiFetch<AdvisorRunReplay>(`/api/advisor/runs/${encodeURIComponent(sessionId)}`);
}
