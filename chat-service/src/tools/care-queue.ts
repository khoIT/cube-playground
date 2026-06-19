/**
 * Tool: care_queue
 *
 * Lists the VIP-care playbooks available for a game (GET /api/care/playbooks)
 * and, when a playbook or status filter is given, the open cases for it
 * (GET /api/care/cases). Each playbook is annotated with its matching genre
 * lever (signal + dual benchmark) where the library maps one, and its
 * availability is surfaced honestly — a playbook whose required data is absent
 * shows as unavailable rather than being silently dropped.
 *
 * Read-only. Case mutations (treat / sweep) are confirm-gated and live
 * downstream — this tool never writes.
 */

import { z } from 'zod';
import { getJson, ServerClientError } from '../services/server-client.js';
import type { ToolContext } from '../types.js';
import { fetchLibrary, type LibraryLever } from './recommendation-citation.js';

export const name = 'care_queue';
export const description =
  'List the VIP-care playbooks for a game with their availability (gated by the ' +
  "game's data), each annotated with its genre lever (signal + benchmark) where " +
  'mapped. Pass a playbook id or status to also return the open cases for it. ' +
  'Use to answer "what can CS act on for this game" and "what is in the queue". ' +
  'Read-only — never writes. Returns ok:false reason:"care-forbidden" if the ' +
  'caller lacks access.';

export const inputSchema = {
  game_id: z.string().min(1).describe('Game id, e.g. "cfm_vn"'),
  playbook: z.string().optional().describe('Filter to one playbook id (e.g. "02"). Also fetches its cases.'),
  status: z
    .enum(['new', 'in_review', 'treated', 'resolved', 'dismissed'])
    .optional()
    .describe('Filter cases by status. Presence triggers a case fetch.'),
};

interface RawPlaybook {
  id: string;
  name: string;
  priority: string;
  availability: string;
  watchedMetric?: { label?: string; kpiTarget?: string };
  action?: { slaMinutes?: number };
}
interface PlaybooksResponse { playbooks: RawPlaybook[]; counts?: unknown }
interface RawCase { id: string; uid: string; playbook_id: string; playbook_name?: string; status: string; opened_at?: string }
interface CasesResponse { cases: RawCase[]; total: number }

interface AnnotatedPlaybook {
  id: string;
  name: string;
  priority: string;
  availability: string;
  kpi?: string;
  slaMinutes?: number;
  lever?: { id: string; signal: string; leverFamily?: string; benchmark: LibraryLever['benchmark'] };
}
type OkResult = {
  ok: true;
  playbooks: AnnotatedPlaybook[];
  cases?: Array<{ id: string; uid: string; playbookId: string; playbookName?: string; status: string; openedAt?: string }>;
  caseTotal?: number;
};
type ErrResult = { ok: false; reason: 'care-forbidden' | 'engine-unavailable'; detail?: unknown };

/** Map a server error to the tool's machine reason. */
function mapError(err: unknown): ErrResult {
  if (err instanceof ServerClientError) {
    if (err.status === 403) return { ok: false, reason: 'care-forbidden', detail: err.body };
    return { ok: false, reason: 'engine-unavailable', detail: { status: err.status, body: err.body } };
  }
  return { ok: false, reason: 'engine-unavailable', detail: String(err) };
}

export async function handler(
  args: { game_id: string; playbook?: string; status?: string },
  ctx: ToolContext,
): Promise<OkResult | ErrResult> {
  let pbRes: PlaybooksResponse;
  try {
    pbRes = await getJson<PlaybooksResponse>(`/api/care/playbooks?game=${encodeURIComponent(args.game_id)}`, ctx);
  } catch (err) {
    return mapError(err);
  }

  // Library lever annotation: index levers by the playbook ids they map to.
  const library = await fetchLibrary(args.game_id, ctx);
  const leverByPlaybook = new Map<string, LibraryLever>();
  for (const lever of library?.levers ?? []) {
    for (const pid of lever.action.mapsToPlaybookIds ?? []) {
      if (!leverByPlaybook.has(pid)) leverByPlaybook.set(pid, lever);
    }
  }

  const playbooks: AnnotatedPlaybook[] = (pbRes.playbooks ?? []).map((p) => {
    const lever = leverByPlaybook.get(p.id);
    return {
      id: p.id,
      name: p.name,
      priority: p.priority,
      availability: p.availability,
      ...(p.watchedMetric?.kpiTarget || p.watchedMetric?.label
        ? { kpi: p.watchedMetric.kpiTarget ?? p.watchedMetric.label }
        : {}),
      ...(p.action?.slaMinutes != null ? { slaMinutes: p.action.slaMinutes } : {}),
      ...(lever
        ? { lever: { id: lever.id, signal: lever.signal, leverFamily: lever.action.leverFamily, benchmark: lever.benchmark } }
        : {}),
    };
  });

  // Cases only when a playbook/status filter is supplied.
  if (args.playbook || args.status) {
    const qs = new URLSearchParams({ game: args.game_id });
    if (args.playbook) qs.set('playbook', args.playbook);
    if (args.status) qs.set('status', args.status);
    try {
      const caseRes = await getJson<CasesResponse>(`/api/care/cases?${qs.toString()}`, ctx);
      return {
        ok: true,
        playbooks,
        cases: (caseRes.cases ?? []).map((c) => ({
          id: c.id,
          uid: c.uid,
          playbookId: c.playbook_id,
          ...(c.playbook_name ? { playbookName: c.playbook_name } : {}),
          status: c.status,
          ...(c.opened_at ? { openedAt: c.opened_at } : {}),
        })),
        caseTotal: caseRes.total,
      };
    } catch (err) {
      return mapError(err);
    }
  }

  return { ok: true, playbooks };
}
