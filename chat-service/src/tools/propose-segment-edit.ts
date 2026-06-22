/**
 * Tool: propose_segment_edit
 *
 * Modifies an EXISTING segment's predicate instead of rebuilding it from
 * scratch. Loads the current tree from the server, applies a small set of edit
 * ops (add_filter / remove_filter / replace_tree), validates the result with the
 * same predicate rules, previews the new cohort size, and emits a
 * `segment_proposal` carrying an `edit` block. The FE confirms by PATCHing
 * /api/segments/:id — this tool NEVER writes.
 *
 * Admin gate: cohort redefinition is owner/admin-only (PATCH returns 403
 * otherwise). The full segment record exposes `can_administer`, so we refuse
 * early with a clean message rather than emitting a proposal that will 403.
 */

import { z } from 'zod';
import { getJson, ServerClientError } from '../services/server-client.js';
import { fetchPreviewCount } from './segment-preview-count.js';
import { applyEditOps, type EditOp } from './segment-edit-ops.js';
import type { ToolContext } from '../types.js';
import type { PredicateNode } from '../types/predicate-tree.js';
import type { SegmentProposal } from './propose-segment.js';

export const name = 'propose_segment_edit';
export const description =
  'Modify an existing segment\'s predicate (add a filter, remove a filter, or ' +
  'replace the whole tree) and emit a segment_proposal with an `edit` block the ' +
  'user confirms in the UI. Use when the user says "add/remove/change … to/from my ' +
  '<name> segment" rather than describing a brand-new segment. Call get_segment or ' +
  'list_segments first to resolve the segment id. This tool emits a proposal; it ' +
  'never writes — the FE PATCHes on confirm and the segment re-refreshes.';

const EditOpSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('add_filter'),
    member: z.string().describe('Fully-qualified member on the segment\'s cube, e.g. "mf_users.country".'),
    operator: z.enum(['equals', 'notEquals', 'gt', 'gte', 'lt', 'lte', 'set', 'notSet']),
    values: z.array(z.union([z.string(), z.number()])).optional(),
  }),
  z.object({
    kind: z.literal('remove_filter'),
    member: z.string().describe('Member whose leaves should be dropped, e.g. "mf_users.country".'),
  }),
  z.object({
    kind: z.literal('replace_tree'),
    predicate_tree: z.unknown().describe('A full replacement predicate tree (escape hatch).'),
  }),
]);

export const inputSchema = {
  segment_id: z.string().min(1).describe('UUID of the segment to edit (from get_segment / list_segments).'),
  ops: z.array(EditOpSchema).min(1).describe('Edit operations applied in order. last-write-wins.'),
  language: z.enum(['en', 'vi', 'mixed']).default('en'),
};

type OkResult = { ok: true; proposal_emitted: true; segment_id: string; estCount: number };
type ErrResult = {
  ok: false;
  error: 'not_found' | 'forbidden' | 'no_predicate' | 'invalid_filters' | 'unknown' | 'server_error';
  detail: string;
};

interface SegmentRecord {
  id: string;
  name: string;
  cube?: string | null;
  can_administer?: boolean;
  predicate_tree?: PredicateNode | null;
}

export async function handler(
  args: { segment_id: string; ops: EditOp[]; language?: 'en' | 'vi' | 'mixed' },
  ctx: ToolContext,
): Promise<OkResult | ErrResult> {
  const isVi = args.language === 'vi' || args.language === 'mixed';

  let seg: SegmentRecord;
  try {
    seg = await getJson<SegmentRecord>(`/api/segments/${encodeURIComponent(args.segment_id)}`, ctx);
  } catch (err) {
    if (err instanceof ServerClientError && err.status === 404) {
      return { ok: false, error: 'not_found', detail: `No segment with id ${args.segment_id}.` };
    }
    return { ok: false, error: 'server_error', detail: String(err) };
  }

  // Only the owner or an admin may redefine a cohort — refuse early so we never
  // emit a proposal whose PATCH would 403.
  if (seg.can_administer === false) {
    return {
      ok: false,
      error: 'forbidden',
      detail:
        `Only the segment owner or an admin can change "${seg.name}"'s definition. ` +
        `You can view it, but editing the cohort is restricted.`,
    };
  }

  const current = seg.predicate_tree;
  if (!current || typeof current !== 'object') {
    return {
      ok: false,
      error: 'no_predicate',
      detail:
        `Segment "${seg.name}" has no predicate tree to edit (it may be a static uid-list segment). ` +
        `Editing predicate filters is only supported for predicate-based segments.`,
    };
  }

  const cube = (seg.cube ?? '').trim() || (current.kind === 'leaf' ? current.member.split('.')[0] : '');
  if (!cube) {
    return { ok: false, error: 'no_predicate', detail: `Could not resolve the cube for segment "${seg.name}".` };
  }

  const applied = applyEditOps(current, args.ops, cube);
  if (!applied.ok) return { ok: false, error: applied.error as ErrResult['error'], detail: applied.detail };

  // Best-effort dry-run of the EDITED cohort size (same mechanism as create).
  const previewCount = await fetchPreviewCount(ctx, {
    game_id: ctx.gameId,
    cube,
    predicate_tree: applied.tree,
  });

  const disclosures = buildEditDisclosures({ name: seg.name, added: applied.added, removed: applied.removed, isVi });
  if (previewCount != null) {
    disclosures.push(
      isVi
        ? `~${previewCount.toLocaleString('en-US')} người dùng khớp sau khi sửa (số chính xác tính khi làm mới).`
        : `~${previewCount.toLocaleString('en-US')} users match after this edit (exact size on refresh).`,
    );
  }

  const proposal: SegmentProposal = {
    type: 'segment_proposal',
    name: seg.name,
    game_id: ctx.gameId,
    cube,
    predicate_tree: applied.tree,
    resolved: {
      estCount: previewCount ?? 0,
      population: isVi ? `phân khúc "${seg.name}" đã sửa` : `edited "${seg.name}"`,
    },
    disclosures,
    suggestedVisibility: 'personal',
    edit: { segment_id: seg.id, previous_predicate_tree: current },
  };

  ctx.sseEmitter.emit('segment_proposal', proposal);
  return { ok: true, proposal_emitted: true, segment_id: seg.id, estCount: previewCount ?? 0 };
}

function buildEditDisclosures(p: {
  name: string;
  added: string[];
  removed: string[];
  isVi: boolean;
}): string[] {
  const lines: string[] = [];
  if (p.added.length > 0) {
    lines.push((p.isVi ? 'Thêm: ' : 'Adding: ') + p.added.join(p.isVi ? '; ' : '; '));
  }
  if (p.removed.length > 0) {
    lines.push((p.isVi ? 'Bỏ: ' : 'Removing: ') + p.removed.join('; '));
  }
  lines.push(
    p.isVi
      ? `Xác nhận sẽ cập nhật phân khúc "${p.name}" và kích hoạt làm mới lại (thành viên được tính lại).`
      : `Confirming updates "${p.name}" and triggers a re-refresh (membership is recomputed).`,
  );
  return lines;
}
