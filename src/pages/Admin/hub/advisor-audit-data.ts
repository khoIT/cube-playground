/**
 * Fetch helpers + shared types for the admin advisor-audit panel.
 *
 * The advisor agent runs IN-PROCESS (not a remote chat-service), so these
 * routes need no ?email= proxy — runs already carry their owner. All routes sit
 * behind requireRole('admin') + requireFeature('admin'); apiFetch attaches the
 * Bearer JWT and throws on non-2xx (incl. 401 force-logout).
 */

import { apiFetch } from '../../../api/api-client';

// ─── Wire shapes (mirror advisor-run-store.ts read types) ───────────────────

export interface AdvisorRunSummary {
  sessionId: string;
  gameId: string;
  segmentId: string | null;
  scopeKind: string;
  goal: string;
  mode: string;
  owner: string | null;
  model: string | null;
  turnCount: number;
  totalCostUsd: number;
  finalStopReason: string | null;
  hadError: boolean;
  createdAt: number;
  lastActiveAt: number;
}

export interface AdvisorToolCall {
  id: number;
  callId: string | null;
  tool: string;
  seq: number;
  inputJson: string | null;
  outputDigest: string | null;
  state: string; // 'ok' | 'failed' | 'denied'
  errorMessage: string | null;
  startedAt: number | null;
  endedAt: number | null;
  durationMs: number | null;
}

export interface AdvisorTurn {
  id: number;
  turnIndex: number;
  mode: string;
  message: string | null;
  narration: string | null;
  toolCallCount: number;
  stopReason: string;
  abortCause: string | null;
  costUsd: number;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  toolCalls: AdvisorToolCall[];
}

export interface AdvisorRunDetail {
  run: AdvisorRunSummary;
  turns: AdvisorTurn[];
}

export interface AdvisorEvent {
  id: number;
  turnIndex: number;
  eventIndex: number;
  eventType: string;
  eventJson: string;
  ts: number;
}

export interface AdvisorRunFilter {
  game?: string;
  goal?: string;
  owner?: string;
  stopReason?: string;
  q?: string;
  limit?: number;
}

// ─── Fetch helpers ──────────────────────────────────────────────────────────

export async function fetchAdvisorRuns(filter: AdvisorRunFilter = {}): Promise<AdvisorRunSummary[]> {
  const params = new URLSearchParams();
  if (filter.game) params.set('game', filter.game);
  if (filter.goal) params.set('goal', filter.goal);
  if (filter.owner) params.set('owner', filter.owner);
  if (filter.stopReason && filter.stopReason !== 'all') params.set('stopReason', filter.stopReason);
  if (filter.q) params.set('q', filter.q);
  if (filter.limit != null) params.set('limit', String(filter.limit));
  const qs = params.toString();
  const res = await apiFetch<{ runs: AdvisorRunSummary[] }>(`/api/admin/advisor/runs${qs ? `?${qs}` : ''}`);
  return res.runs;
}

export async function fetchAdvisorRunDetail(sessionId: string): Promise<AdvisorRunDetail> {
  return apiFetch<AdvisorRunDetail>(`/api/admin/advisor/runs/${encodeURIComponent(sessionId)}`);
}

export async function fetchAdvisorRunEvents(
  sessionId: string,
  opts: { turnIndex?: number; cursor?: number; limit?: number } = {},
): Promise<{ events: AdvisorEvent[]; nextCursor: number | null }> {
  const params = new URLSearchParams();
  if (opts.turnIndex != null) params.set('turnIndex', String(opts.turnIndex));
  if (opts.cursor != null) params.set('cursor', String(opts.cursor));
  if (opts.limit != null) params.set('limit', String(opts.limit));
  const qs = params.toString();
  return apiFetch<{ events: AdvisorEvent[]; nextCursor: number | null }>(
    `/api/admin/advisor/runs/${encodeURIComponent(sessionId)}/events${qs ? `?${qs}` : ''}`,
  );
}

export async function fetchAdvisorOwners(): Promise<string[]> {
  const res = await apiFetch<{ owners: string[] }>('/api/admin/advisor/owners');
  return res.owners;
}

// ─── Pure display mappers ─────────────────────────────────────────────────────

export function formatEpochMs(epochMs: number | null | undefined): string {
  if (epochMs == null) return '—';
  return new Date(epochMs).toLocaleString();
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
}

export function formatUsd(usd: number | null | undefined): string {
  if (usd == null) return '—';
  return `$${usd.toFixed(usd < 0.01 ? 4 : usd < 1 ? 3 : 2)}`;
}

export function scopeLabel(run: Pick<AdvisorRunSummary, 'scopeKind' | 'gameId' | 'segmentId'>): string {
  if (run.scopeKind === 'segment' && run.segmentId) return `${run.gameId} · seg ${run.segmentId.slice(0, 8)}`;
  return run.gameId;
}
