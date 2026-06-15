/**
 * Care History Tab — Member-360 tab showing the full cross-playbook care history
 * for a UID.
 *
 * Structure:
 *   RecommendedAction  — top open case → action text + channels + SLA (from playbook).
 *   Timeline           — every case ordered by opened_at desc, with outcome tags.
 *   TreatmentForm      — PATCH status→treated with channel / action / notes.
 *                        Gated: viewer role sees read-only; editor/admin can write.
 *
 * Data:
 *   GET /api/care/cases/vip/:uid?game=  — via useVipCaseHistory hook.
 *   GET /api/care/playbooks?game=       — via useCarePlaybooks hook (playbook metadata).
 *   PATCH /api/care/cases/:id           — via patchCareCase helper.
 *
 * Design tokens only (var(--*)). No raw hex. Mirrors SectionCard pattern from
 * Member-360 detail tabs.
 */

import React, { useState } from 'react';
import { Clock, Phone, CheckCircle2, XCircle, AlertCircle, Zap } from 'lucide-react';
import { useVipCaseHistory, patchCareCase } from '../../Dashboards/cs/use-care-cases';
import type { CareCase, CareCasePatch } from '../../Dashboards/cs/use-care-cases';
import { useCarePlaybooks } from '../../Dashboards/cs/use-care-playbooks';
import type { ResolvedPlaybook } from '../../Dashboards/cs/use-care-playbooks';
import { useAuthUser } from '../../../auth/auth-context';

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return `${Math.floor(ms / 60_000)}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function absoluteDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
}

// ── Status / outcome visual helpers ──────────────────────────────────────────

const STATUS_ICON: Record<string, React.ReactNode> = {
  new:        <AlertCircle size={14} color="var(--info-ink)" />,
  in_review:  <Clock size={14} color="var(--warning-ink)" />,
  treated:    <CheckCircle2 size={14} color="var(--success-ink)" />,
  resolved:   <CheckCircle2 size={14} color="var(--success-ink)" />,
  dismissed:  <XCircle size={14} color="var(--muted-ink)" />,
};

const STATUS_LABEL: Record<string, string> = {
  new: 'New', in_review: 'In review', treated: 'Treated',
  resolved: 'Resolved', dismissed: 'Dismissed',
};

const STATUS_PILL: Record<string, React.CSSProperties> = {
  new:        { background: 'var(--info-soft)',        color: 'var(--info-ink)' },
  in_review:  { background: 'var(--warning-soft)',     color: 'var(--warning-ink)' },
  treated:    { background: 'var(--success-soft)',     color: 'var(--success-ink)' },
  resolved:   { background: 'var(--success-soft)',     color: 'var(--success-ink)' },
  dismissed:  { background: 'var(--muted-soft)',       color: 'var(--muted-ink)' },
};

function StatusPill({ status }: { status: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        ...(STATUS_PILL[status] ?? STATUS_PILL.new),
        fontSize: 10.5,
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: 'var(--radius-full)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {STATUS_ICON[status]}
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

// ── Snapshot display ──────────────────────────────────────────────────────────

function SnapshotChips({ raw }: { raw: string | null }) {
  if (!raw) return null;
  let snap: Record<string, unknown>;
  try { snap = JSON.parse(raw) as Record<string, unknown>; }
  catch { return null; }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
      {Object.entries(snap).slice(0, 4).map(([k, v]) => (
        <span
          key={k}
          style={{
            fontSize: 10,
            background: 'var(--bg-muted)',
            color: 'var(--text-secondary)',
            borderRadius: 'var(--radius-sm)',
            padding: '1px 6px',
            fontFamily: 'var(--font-sans)',
          }}
          title={`${k}: ${String(v)}`}
        >
          {k.split('.').pop()}: <strong>{String(v)}</strong>
        </span>
      ))}
    </div>
  );
}

// ── Recommended Action panel ──────────────────────────────────────────────────

interface RecommendedActionProps {
  cases: CareCase[];
  playbooks: ResolvedPlaybook[];
}

export function RecommendedAction({ cases, playbooks }: RecommendedActionProps) {
  const pbMap = new Map(playbooks.map((p) => [p.id, p]));

  // Find the top open case by playbook priority (cao < tb < thap).
  const PRIORITY_RANK: Record<string, number> = { cao: 0, tb: 1, thap: 2 };
  const openCases = cases.filter((c) => c.status === 'new' || c.status === 'in_review');
  if (openCases.length === 0) return null;

  const topCase = [...openCases].sort((a, b) => {
    const pa = pbMap.get(a.playbook_id)?.priority ?? 'thap';
    const pb = pbMap.get(b.playbook_id)?.priority ?? 'thap';
    return (PRIORITY_RANK[pa] ?? 2) - (PRIORITY_RANK[pb] ?? 2);
  })[0];

  const pb = pbMap.get(topCase.playbook_id);
  if (!pb) return null;

  const slaLabel = pb.action.slaMinutes
    ? pb.action.slaMinutes < 60
      ? `${pb.action.slaMinutes}m`
      : `${Math.round(pb.action.slaMinutes / 60)}h`
    : '24h';

  return (
    <div
      style={{
        background: 'var(--info-soft)',
        border: '1px solid var(--info-ink)',
        borderRadius: 'var(--radius-lg)',
        padding: '12px 16px',
        marginBottom: 16,
        fontFamily: 'var(--font-sans)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
        <Zap size={14} color="var(--info-ink)" />
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--info-ink)' }}>
          Recommended next action
        </span>
        <span style={{ fontSize: 10.5, color: 'var(--text-muted)', marginLeft: 'auto' }}>
          SLA: {slaLabel}
        </span>
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
        {pb.action.text}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
        <Phone size={12} color="var(--text-muted)" />
        {pb.action.channels.map((ch) => (
          <span
            key={ch}
            style={{
              fontSize: 11,
              background: 'var(--bg-card)',
              color: 'var(--text-secondary)',
              borderRadius: 'var(--radius-full)',
              padding: '2px 8px',
              fontWeight: 500,
            }}
          >
            {ch.replace('_', ' ')}
          </span>
        ))}
        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
          via {pb.name}
        </span>
      </div>
    </div>
  );
}

// ── Treatment form ────────────────────────────────────────────────────────────

interface TreatmentFormProps {
  caseId: string;
  onDone: () => void;
  availableChannels: string[];
}

function TreatmentForm({ caseId, onDone, availableChannels }: TreatmentFormProps) {
  const [channel, setChannel] = useState(availableChannels[0] ?? '');
  const [actionTaken, setActionTaken] = useState('');
  const [notes, setNotes] = useState('');
  const [outcome, setOutcome] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      const patch: CareCasePatch = {
        status: 'treated',
        channel_used: channel || undefined,
        action_taken: actionTaken || undefined,
        notes: notes || undefined,
        outcome: outcome || undefined,
      };
      await patchCareCase(caseId, patch);
      onDone();
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
      setSaving(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    border: '1px solid var(--border-card)',
    borderRadius: 'var(--radius-md)',
    padding: '6px 10px',
    fontSize: 12,
    fontFamily: 'var(--font-sans)',
    background: 'var(--bg-card)',
    color: 'var(--text-primary)',
    width: '100%',
    boxSizing: 'border-box',
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        background: 'var(--bg-muted)',
        border: '1px solid var(--border-card)',
        borderRadius: 'var(--radius-lg)',
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        fontFamily: 'var(--font-sans)',
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 2 }}>
        Mark as treated
      </div>

      {/* Channel */}
      {availableChannels.length > 0 && (
        <div>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Channel used</label>
          <select value={channel} onChange={(e) => setChannel(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
            {availableChannels.map((ch) => (
              <option key={ch} value={ch}>{ch.replace('_', ' ')}</option>
            ))}
            <option value="">Other</option>
          </select>
        </div>
      )}

      {/* Action taken */}
      <div>
        <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Action taken</label>
        <input
          type="text"
          value={actionTaken}
          onChange={(e) => setActionTaken(e.target.value)}
          placeholder="Brief description of action…"
          style={inputStyle}
        />
      </div>

      {/* Notes */}
      <div>
        <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any context, member response, follow-up…"
          rows={2}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      </div>

      {/* Outcome */}
      <div>
        <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Outcome</label>
        <select value={outcome} onChange={(e) => setOutcome(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
          <option value="">— select —</option>
          <option value="positive">Positive</option>
          <option value="neutral">Neutral</option>
          <option value="negative">Negative</option>
          <option value="pending">Pending follow-up</option>
        </select>
      </div>

      {saveError && (
        <div style={{ fontSize: 11, color: 'var(--destructive-ink)', background: 'var(--destructive-soft)', padding: '6px 10px', borderRadius: 'var(--radius-md)' }}>
          {saveError}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
        <button
          type="submit"
          disabled={saving}
          style={{
            background: saving ? 'var(--bg-muted)' : 'var(--brand)',
            color: saving ? 'var(--text-muted)' : 'var(--text-on-brand)',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            padding: '6px 16px',
            fontSize: 12,
            fontWeight: 600,
            cursor: saving ? 'not-allowed' : 'pointer',
            fontFamily: 'var(--font-sans)',
          }}
        >
          {saving ? 'Saving…' : 'Log treatment'}
        </button>
        <button
          type="button"
          onClick={onDone}
          style={{
            background: 'transparent',
            border: '1px solid var(--border-card)',
            borderRadius: 'var(--radius-md)',
            padding: '6px 14px',
            fontSize: 12,
            cursor: 'pointer',
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-sans)',
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── Timeline row ──────────────────────────────────────────────────────────────

interface TimelineRowProps {
  c: CareCase;
  playbookName: string;
  canWrite: boolean;
  onTreated: () => void;
  channels: string[];
}

function TimelineRow({ c, playbookName, canWrite, onTreated, channels }: TimelineRowProps) {
  const [showForm, setShowForm] = useState(false);
  const isOpen = c.status === 'new' || c.status === 'in_review';

  return (
    <div
      style={{
        borderLeft: `3px solid ${isOpen ? 'var(--info-ink)' : 'var(--border-card)'}`,
        paddingLeft: 14,
        marginBottom: 16,
        fontFamily: 'var(--font-sans)',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
        <StatusPill status={c.status} />
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
          {playbookName}
        </span>
        {c.condition_lapsed === 1 && (
          <span style={{ fontSize: 10, background: 'var(--warning-soft)', color: 'var(--warning-ink)', borderRadius: 'var(--radius-full)', padding: '1px 6px', fontWeight: 600 }}>
            lapsed
          </span>
        )}
        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
          {absoluteDate(c.opened_at ?? c.created_at ?? null)}
        </span>
      </div>

      {/* Stats snapshot at match time */}
      <SnapshotChips raw={c.stats_snapshot_json} />

      {/* Outcome / treatment details */}
      {c.status !== 'new' && c.status !== 'in_review' && (
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-secondary)', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {c.treated_at && (
            <span>Treated {relativeTime(c.treated_at)}</span>
          )}
          {c.channel_used && (
            <span style={{ background: 'var(--bg-muted)', borderRadius: 'var(--radius-full)', padding: '1px 7px' }}>
              via {c.channel_used.replace('_', ' ')}
            </span>
          )}
          {c.outcome && (
            <span
              style={{
                background: c.outcome === 'positive' ? 'var(--success-soft)' : c.outcome === 'negative' ? 'var(--destructive-soft)' : 'var(--muted-soft)',
                color: c.outcome === 'positive' ? 'var(--success-ink)' : c.outcome === 'negative' ? 'var(--destructive-ink)' : 'var(--muted-ink)',
                borderRadius: 'var(--radius-full)',
                padding: '1px 7px',
                fontWeight: 600,
              }}
            >
              {c.outcome}
            </span>
          )}
          {c.notes && (
            <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>{c.notes}</span>
          )}
        </div>
      )}

      {/* Treatment form or "Mark treated" trigger (gated to editor/admin) */}
      {isOpen && canWrite && (
        <div style={{ marginTop: 8 }}>
          {showForm ? (
            <TreatmentForm
              caseId={c.id}
              availableChannels={channels}
              onDone={() => { setShowForm(false); onTreated(); }}
            />
          ) : (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '4px 12px',
                background: 'var(--success-soft)',
                color: 'var(--success-ink)',
                border: '1px solid var(--success-ink)',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
              }}
            >
              Mark treated
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main CareHistoryTab ───────────────────────────────────────────────────────

interface CareHistoryTabProps {
  gameId: string | null;
  uid: string;
}

/**
 * Renders inside the Member-360 Details tab panel.
 * Shows recommended action + full case timeline for the given UID.
 *
 * Write actions (Mark treated) are gated: viewer role sees read-only timeline.
 * editor / admin roles see the treatment form.
 */
export function CareHistoryTab({ gameId, uid }: CareHistoryTabProps) {
  const user = useAuthUser();
  const canWrite = user?.role === 'editor' || user?.role === 'admin';

  const { status: casesStatus, cases, error: casesError } = useVipCaseHistory(gameId, uid);
  const { status: pbStatus, playbooks } = useCarePlaybooks(gameId ?? '');

  // Refresh key — incrementing triggers re-fetch after treatment PATCH.
  const [refreshKey, setRefreshKey] = useState(0);
  // Re-trigger the history hook by bumping the key is done via a parent pattern;
  // instead we track locally when a treatment was logged so the hook re-fires
  // via its own gameId/uid deps staying stable. We use an internal invalidation
  // pattern: store latest patch timestamp and use it as a dependency sentinel.
  const [lastPatched, setLastPatched] = useState<number>(0);

  // The VipCaseHistory hook re-fetches on uid/gameId change. For same-uid PATCH
  // refreshes, we trigger a component remount via the key pattern.
  const handleTreated = () => {
    setLastPatched(Date.now());
    setRefreshKey((k) => k + 1);
  };

  const pbMap = new Map(playbooks.map((p) => [p.id, p]));

  const loading = casesStatus === 'idle' || casesStatus === 'loading' || pbStatus === 'idle' || pbStatus === 'loading';

  if (!gameId) {
    return (
      <div style={{ color: 'var(--text-muted)', fontSize: 13, fontFamily: 'var(--font-sans)' }}>
        Select a game to view care history.
      </div>
    );
  }

  if (casesError) {
    return (
      <div style={{ padding: 12, background: 'var(--destructive-soft)', color: 'var(--destructive-ink)', borderRadius: 'var(--radius-md)', fontSize: 13 }}>
        Failed to load care history: {casesError}
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[1, 2].map((n) => (
          <div key={n} style={{ height: 52, background: 'var(--bg-muted)', borderRadius: 'var(--radius-md)', opacity: 0.6 }} />
        ))}
      </div>
    );
  }

  if (cases.length === 0) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, fontFamily: 'var(--font-sans)' }}>
        No care cases for this member.
      </div>
    );
  }

  // Sort: open first (new/in_review), then by opened_at desc.
  const sorted = [...cases].sort((a, b) => {
    const aOpen = a.status === 'new' || a.status === 'in_review' ? 0 : 1;
    const bOpen = b.status === 'new' || b.status === 'in_review' ? 0 : 1;
    if (aOpen !== bOpen) return aOpen - bOpen;
    return new Date(b.opened_at ?? b.created_at ?? 0).getTime() - new Date(a.opened_at ?? a.created_at ?? 0).getTime();
  });

  return (
    // key=refreshKey forces full remount so useVipCaseHistory re-fires after PATCH.
    <div key={`${uid}-${lastPatched}`} style={{ fontFamily: 'var(--font-sans)' }}>
      {/* Recommended action panel (top open case only) */}
      <RecommendedAction cases={cases} playbooks={playbooks} />

      {/* Viewer-only notice */}
      {!canWrite && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-muted)', borderRadius: 'var(--radius-md)', padding: '6px 12px', marginBottom: 12, fontStyle: 'italic' }}>
          You have viewer access — treatment actions are read-only.
        </div>
      )}

      {/* Timeline */}
      <div style={{ marginTop: 4 }}>
        {sorted.map((c) => {
          const pb = pbMap.get(c.playbook_id);
          const playbookName = c.playbook_name ?? pb?.name ?? c.playbook_id;
          const channels = pb?.action.channels ?? [];
          return (
            <TimelineRow
              key={`${c.id}-${refreshKey}`}
              c={c}
              playbookName={playbookName}
              canWrite={canWrite}
              onTreated={handleTreated}
              channels={channels}
            />
          );
        })}
      </div>
    </div>
  );
}
