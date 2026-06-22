/**
 * SegmentProposalCard — renders a chat segment_proposal SSE event as an
 * interactive confirm card. The agent proposes; the user confirms (or edits).
 *
 * Three actions:
 *   Create      → POST /api/segments (type predicate, tags ['ai-generated'])
 *                 → success toast with link + card morphs into the created
 *                   hand-off view (view segment / create another)
 *   Open editor → /segments/new pre-seeded via EditorLocationState.advisorPrefill
 *   Cancel      → dismiss (no write)
 *
 * Sub-components (PredicateChip, StatPill, VisibilitySelect, summarisePredicate)
 * live in segment-proposal-card-parts.tsx to keep each file under 200 lines.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { Users, ExternalLink, X, CheckCircle, AlertCircle } from 'lucide-react';
import { message } from 'antd';
import { T, Icon } from '../../../shell/theme';
import { segmentsClient } from '../../../api/segments-client';
import { useServerPref } from '../../../hooks/use-server-pref';
import { invalidateSegmentIds } from '../../Segments/use-segment-ids';
import { SegmentApiError } from '../../../api/api-client';
import type { SegmentProposalPayload } from '../../../api/segment-proposal';
import type { SegmentVisibility, PredicateNode, Segment } from '../../../types/segment-api';
import type { EditorLocationState } from '../../Segments/editor/editor-route-state';
import { stashEditorPrefill } from '../../Segments/editor/editor-prefill-store';
import { formatCompact } from '../../Segments/detail/cards/format-value';
import {
  summarisePredicate,
  PredicateChip,
  StatPill,
  VisibilitySelect,
} from './segment-proposal-card-parts';
import { SegmentCreatedCard } from './segment-created-card';

interface SegmentProposalCardProps {
  proposal: SegmentProposalPayload;
}

/** Stable per-proposal key derived from its content. The proposal is replayed
 *  verbatim from chat message history on reload, so the same proposal hashes to
 *  the same key — letting us remember which segment it already created. */
function proposalKey(p: SegmentProposalPayload): string {
  const basis = `${p.game_id}|${p.cube}|${p.name}|${JSON.stringify(p.predicate_tree)}`;
  let h = 5381;
  for (let i = 0; i < basis.length; i += 1) h = ((h << 5) + h + basis.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function SegmentProposalCard({ proposal }: SegmentProposalCardProps) {
  const history = useHistory();
  const [name, setName] = useState(proposal.name);
  const [visibility, setVisibility] = useState<SegmentVisibility>(proposal.suggestedVisibility);
  const [creating, setCreating] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  // On success the card stays mounted and morphs into the created receipt view
  // (view-segment / create-another) rather than vanishing.
  const [created, setCreated] = useState<Segment | null>(null);
  // Persisted across reloads: which segment id this proposal already created.
  const prefKey = useMemo(() => `gds-cube:chat-seg-created:${proposalKey(proposal)}`, [proposal]);
  const [createdId, setCreatedId, clearCreatedId] = useServerPref<string | null>(prefKey, null);

  // Re-hydrate the created receipt on reload: if this proposal already created a
  // segment, fetch it fresh (so status/count reflect the completed refresh). A
  // deleted/missing segment clears the pref and falls back to the proposal form.
  useEffect(() => {
    if (!createdId || created) return;
    let cancelled = false;
    segmentsClient.get(createdId)
      .then((seg) => { if (!cancelled) setCreated(seg); })
      .catch(() => { if (!cancelled) clearCreatedId(); });
    return () => { cancelled = true; };
  }, [createdId, created, clearCreatedId]);

  if (dismissed) return null;

  const { resolved, disclosures, predicate_tree, game_id, cube } = proposal;

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) { void message.warning('Please enter a segment name.'); return; }
    setCreating(true);
    try {
      const seg = await segmentsClient.create({
        name: trimmed,
        type: 'predicate',
        cube,
        game_id,
        predicate_tree,
        tags: ['ai-generated'],
        visibility,
      });
      // Drop the cached segment-id/row list so the sidebar nav surfaces the new
      // segment on its next render (mirrors the editor's create path).
      invalidateSegmentIds();
      // Segment enters status='refreshing' automatically — the server kicks the
      // first refresh cycle. Toast links directly to the new segment detail.
      void message.success(
        <span>
          Segment created —{' '}
          <a
            href={`#/segments/${seg.id}`}
            style={{ color: 'var(--brand)', textDecoration: 'underline' }}
            onClick={(e) => { e.preventDefault(); history.push(`/segments/${seg.id}`); }}
          >
            view {trimmed}
          </a>{' '}
          (refreshing…)
        </span>,
        5,
      );
      // Keep the toast AND morph the card into its created receipt state.
      // Persist the id so the receipt survives a chat reload.
      setCreatedId(seg.id);
      setCreated(seg);
    } catch (err) {
      const msg = err instanceof SegmentApiError ? err.message
        : err instanceof Error ? err.message
        : 'Failed to create segment.';
      void message.error(msg);
    } finally {
      setCreating(false);
    }
  };

  const handleOpenEditor = () => {
    const state: EditorLocationState = {
      advisorPrefill: {
        name: name.trim() || proposal.name,
        cube,
        predicateTree: predicate_tree as PredicateNode,
      },
    };
    // Hash history drops location.state, so bridge it through sessionStorage;
    // the state arg is kept for router setups that preserve it (tests).
    stashEditorPrefill(state);
    history.push('/segments/new', state);
  };

  // Up to 3 leaf-condition chips; overflow count shown as "+N more".
  const summary = summarisePredicate(predicate_tree);
  const allChips = summary.split(' AND ').flatMap((s) => s.split(' OR '));
  const chips = allChips.slice(0, 3);
  const overflowCount = allChips.length - chips.length;

  const btnDisabled = creating || !name.trim();

  // Success → receipt view. "Create another" clears it (and the persisted id)
  // back to the form so the user can spin up a second segment in the same turn.
  // View nav is allowed even while refreshing — the detail page shows its own
  // building state.
  if (created) {
    return (
      <SegmentCreatedCard
        segment={created}
        chips={chips}
        overflowCount={overflowCount}
        onView={() => history.push(`/segments/${created.id}`)}
        onCreateAnother={() => { clearCreatedId(); setCreated(null); }}
      />
    );
  }

  // Persisted as created but the re-hydration fetch is still in flight — hold a
  // quiet placeholder so the proposal form doesn't flash before the receipt.
  if (createdId) {
    return (
      <div
        style={{
          border: '1px solid var(--border-card)', borderRadius: 12, background: 'var(--surface-raised)',
          padding: '16px 24px', margin: '12px 0', display: 'flex', alignItems: 'center', gap: 8,
          fontFamily: T.fSans, fontSize: 12, color: 'var(--shell-text-faint)',
        }}
      >
        <Icon icon={CheckCircle} size={13} color="var(--shell-text-faint)" />
        Loading created segment…
      </div>
    );
  }

  return (
    <div
      style={{
        border: '1px solid var(--border-strong)',
        borderRadius: 12,
        background: 'var(--surface-raised)',
        boxShadow: 'var(--shadow-sm)',
        overflow: 'hidden',
        width: '100%',
        margin: '12px 0',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 24px', borderBottom: '1px solid var(--shell-bg-subtle)' }}>
        <Icon icon={Users} size={16} color="var(--info-ink)" />
        <span style={{ flex: 1, fontFamily: T.fSans, fontSize: 14, fontWeight: 600, color: 'var(--shell-text)' }}>
          Segment proposal
        </span>
        <span style={{ padding: '2px 8px', borderRadius: 12, background: 'var(--info-soft)', border: '1px solid var(--info-ink)40', fontFamily: T.fSans, fontSize: 11, fontWeight: 500, color: 'var(--info-ink)', flexShrink: 0 }}>
          {game_id}
        </span>
      </div>

      {/* Body */}
      <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Editable name */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontFamily: T.fSans, fontSize: 11, fontWeight: 600, color: 'var(--shell-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={creating}
            style={{ fontFamily: T.fSans, fontSize: 13, color: 'var(--shell-text)', background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-md)', padding: '6px 10px', outline: 'none', width: '100%', boxSizing: 'border-box' }}
          />
        </div>

        {/* Predicate chips */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontFamily: T.fSans, fontSize: 11, fontWeight: 600, color: 'var(--shell-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Filters</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            {chips.map((chip, i) => <PredicateChip key={i} label={chip.trim()} />)}
            {overflowCount > 0 && <span style={{ fontFamily: T.fSans, fontSize: 11, color: 'var(--shell-text-faint)' }}>+{overflowCount} more</span>}
          </div>
        </div>

        {/* Stats: population + est. size + optional cutoff */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          <StatPill label="Population" value={resolved.population} />
          <StatPill label="Est. size" value={`≈ ${formatCompact(resolved.estCount)}`} title={`${resolved.estCount.toLocaleString()} users (approximate)`} />
          {resolved.cutoff != null && <StatPill label="Cutoff" value={`≈ ${resolved.cutoff.toLocaleString()}`} title="Approximate — computed with approx_percentile" />}
        </div>

        {/* Disclosures verbatim */}
        {disclosures.length > 0 && (
          <div style={{ padding: '8px 12px', background: 'var(--warning-soft)', borderLeft: '3px solid var(--warning-ink)', borderRadius: 'var(--radius-sm)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {disclosures.map((d, i) => <span key={i} style={{ fontFamily: T.fSans, fontSize: 12, color: 'var(--warning-ink)', lineHeight: 1.5 }}>{d}</span>)}
          </div>
        )}

        <VisibilitySelect value={visibility} onChange={setVisibility} disabled={creating} />
      </div>

      {/* Footer actions */}
      <div style={{ padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 8, borderTop: '1px solid var(--shell-bg-subtle)' }}>
        <button type="button" onClick={handleCreate} disabled={btnDisabled}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 16px', borderRadius: 6, background: btnDisabled ? 'var(--bg-muted)' : 'var(--brand)', border: 'none', cursor: btnDisabled ? 'not-allowed' : 'pointer', fontFamily: T.fSans, fontSize: 13, fontWeight: 600, color: btnDisabled ? 'var(--text-muted)' : 'var(--text-on-brand)', opacity: creating ? 0.7 : 1 }}>
          <Icon icon={CheckCircle} size={13} color={btnDisabled ? 'var(--text-muted)' : 'var(--text-on-brand)'} />
          {creating ? 'Creating…' : 'Create segment'}
        </button>
        <button type="button" onClick={handleOpenEditor} disabled={creating}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 6, background: 'var(--bg-card)', border: '1px solid var(--border-card)', cursor: creating ? 'not-allowed' : 'pointer', fontFamily: T.fSans, fontSize: 12, fontWeight: 500, color: 'var(--shell-text-secondary)' }}>
          <Icon icon={ExternalLink} size={12} color="var(--shell-text-secondary)" />
          Open in editor
        </button>
        <button type="button" onClick={() => setDismissed(true)} disabled={creating}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 10px', borderRadius: 6, background: 'none', border: 'none', cursor: creating ? 'not-allowed' : 'pointer', fontFamily: T.fSans, fontSize: 12, color: 'var(--shell-text-faint)' }}>
          <Icon icon={X} size={12} color="var(--shell-text-faint)" />
          Cancel
        </button>
        {!name.trim() && !creating && (
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, fontFamily: T.fSans, fontSize: 11, color: 'var(--warning-ink)' }}>
            <Icon icon={AlertCircle} size={12} color="var(--warning-ink)" />
            Name required
          </span>
        )}
      </div>
    </div>
  );
}
