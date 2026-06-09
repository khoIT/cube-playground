/**
 * PlaybookBuilder — /dashboards/cs/playbooks/new  +  /dashboards/cs/playbooks/:id/edit
 *
 * 4-section authoring surface:
 *   1. Identity    — name, group (NHÓM 1–4), priority (cao/tb/thap)
 *   2. Condition   — ThresholdRule kind selector + params; Segments predicate builder embedded
 *                    for the abs/tierStep/event kinds that map to a cohort predicate
 *   3. Watched metric — member + label + kpiTarget
 *   4. Action      — text, channel multiselect, SLA minutes
 *   + Data-readiness panel — live availability check per picked member
 *
 * Authoring flow:
 *   - new         → POST with base_id=null (net-new custom playbook)
 *   - edit seed   → POST with base_id=<seedId> (idempotent upsert; override row created)
 *   - edit override → PATCH /:overrideId
 *   - clone       → POST with base_id=null (net-new, name pre-filled with "Copy of …")
 *
 * Design compliance:
 *   - 24px 32px padding, maxWidth 960, margin 0 auto
 *   - var(--font-sans) only; design tokens throughout, no raw hex
 *   - Page-header mirrors CS Monitor (eyebrow + icon + title)
 *   - Viewer role: form renders read-only; save button hidden
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useHistory, useLocation, useParams } from 'react-router-dom';
import { BookOpen, ChevronLeft, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useGameContext } from '../../../components/Header/use-game-context';
import { useAuthUser } from '../../../auth/auth-context';
import { useCarePlaybooks } from './use-care-playbooks';
import { createPlaybook, updatePlaybook } from './use-playbook-mutations';
import { mutationTargetFor } from './playbook-mutation-target';
import { renderRoot } from '../../Segments/editor/predicate-builder/predicate-group';
import { usePredicateState } from '../../Segments/editor/hooks/use-predicate-state';
import type { ThresholdRule, TierBand } from '../../../types/threshold-rule';
import type { PredicateNode } from '../../../types/segment-api';
import type { ResolvedPlaybook, PlaybookGroup, PlaybookPriority } from './use-care-playbooks';
import type { WatchedMetricInput, ActionInput } from './use-playbook-mutations';

// ── Route params ──────────────────────────────────────────────────────────────

interface BuilderParams {
  id?: string; // override row id when editing
}

// ── Query-string helpers ──────────────────────────────────────────────────────

function useQueryParams(): URLSearchParams {
  const { search } = useLocation();
  return new URLSearchParams(search);
}

// ── Styles ────────────────────────────────────────────────────────────────────

const pageStyle: React.CSSProperties = {
  padding: '24px 32px',
  maxWidth: 960,
  margin: '0 auto',
  fontFamily: 'var(--font-sans)',
};

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-xl)',
  boxShadow: 'var(--shadow-sm)',
  padding: '20px 24px',
  marginBottom: 20,
};

const sectionTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: 'var(--text-primary)',
  marginBottom: 14,
  letterSpacing: '-0.01em',
  fontFamily: 'var(--font-sans)',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11.5,
  fontWeight: 600,
  color: 'var(--text-secondary)',
  marginBottom: 5,
  fontFamily: 'var(--font-sans)',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-md)',
  fontSize: 13,
  fontFamily: 'var(--font-sans)',
  background: 'var(--bg-card)',
  color: 'var(--text-primary)',
  boxSizing: 'border-box',
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: 'pointer',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 16,
  flexWrap: 'wrap',
};

const fieldStyle: React.CSSProperties = {
  flex: '1 1 180px',
  minWidth: 0,
};

// ── Small field components ────────────────────────────────────────────────────

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={fieldStyle}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

// ── NHÓM → PlaybookGroup mapping ──────────────────────────────────────────────

const GROUP_OPTIONS: { value: PlaybookGroup; label: string }[] = [
  { value: 'payment', label: 'NHÓM 1 · Payment' },
  { value: 'ingame',  label: 'NHÓM 2 · In-game' },
  { value: 'churn',   label: 'NHÓM 3 · Churn' },
  { value: 'event',   label: 'NHÓM 4 · Time & Event' },
];

const PRIORITY_OPTIONS: { value: PlaybookPriority; label: string }[] = [
  { value: 'cao',  label: 'Cao (High)' },
  { value: 'tb',   label: 'TB (Medium)' },
  { value: 'thap', label: 'Thấp (Low)' },
];

const CHANNEL_OPTIONS = [
  { value: 'in_game',   label: 'In-game' },
  { value: 'zalo_zns',  label: 'Zalo ZNS' },
  { value: 'call',      label: 'Call' },
  { value: 'push',      label: 'Push notification' },
];

const THRESHOLD_KINDS: { value: ThresholdRule['kind']; label: string; description: string }[] = [
  { value: 'abs',        label: 'Absolute',   description: 'Member compared to a fixed value' },
  { value: 'tierStep',   label: 'Tier step',  description: 'Member crosses a VIP tier band' },
  { value: 'event',      label: 'Event',      description: 'Member event within a time window' },
  { value: 'percentile', label: 'Percentile', description: 'Member at or above the P-th percentile' },
  { value: 'ratio',      label: 'Ratio',      description: 'Recent vs baseline self-comparison (trigger)' },
];

// ── Default ThresholdRule per kind ────────────────────────────────────────────

function defaultRule(kind: ThresholdRule['kind']): ThresholdRule {
  switch (kind) {
    case 'abs':        return { kind: 'abs',        member: '', op: 'gte', value: 0 };
    case 'tierStep':   return { kind: 'tierStep',   member: '', bands: [{ label: 'Silver', min: 1 }] };
    case 'event':      return { kind: 'event',      member: '', window: 'last 7 days' };
    case 'percentile': return { kind: 'percentile', of: '', p: 90 };
    case 'ratio':      return { kind: 'ratio',      member: '', vs: '', value: 0.5, op: 'lt' };
  }
}

// ── Derive dataRequirements from ThresholdRule ────────────────────────────────

function ruleMembers(rule: ThresholdRule): string[] {
  switch (rule.kind) {
    case 'abs':
    case 'event':
    case 'tierStep':
      return rule.member ? [rule.member] : [];
    case 'percentile':
      return rule.gate ? [rule.of, rule.gate].filter(Boolean) : rule.of ? [rule.of] : [];
    case 'ratio':
      return [rule.member, rule.vs].filter(Boolean);
  }
}

/** Logical members referenced by any leaf in a predicate tree (for readiness). */
function predicateMembers(node: PredicateNode): string[] {
  if (node.kind === 'leaf') return node.member ? [node.member] : [];
  return node.children.flatMap(predicateMembers);
}

/** A predicate tree the user actually authored (root group has children). */
function treeHasContent(node: PredicateNode): boolean {
  return node.kind === 'group' && node.children.length > 0;
}

// ── Availability checker (derives from registry availability field) ────────────

function MemberReadinessPanel({
  members,
  playbooks,
  gameId,
}: {
  members: string[];
  playbooks: ResolvedPlaybook[];
  gameId: string;
}) {
  if (members.length === 0) {
    return (
      <div
        style={{
          padding: '12px 14px',
          background: 'var(--bg-muted)',
          borderRadius: 'var(--radius-md)',
          fontSize: 12,
          color: 'var(--text-muted)',
        }}
      >
        No members picked yet — add a condition to check data availability for{' '}
        <strong>{gameId}</strong>.
      </div>
    );
  }

  // Check which members appear in any playbook's dataRequirements for this game.
  // A member is "available" if at least one live/partial playbook uses it.
  const availableMembers = new Set<string>();
  for (const pb of playbooks) {
    if (pb.availability !== 'unavailable') {
      for (const m of pb.dataRequirements) {
        availableMembers.add(m);
      }
    }
  }

  const rows = members.map((m) => {
    const isAvailable = availableMembers.has(m) || m === '';
    return { member: m, available: isAvailable };
  });

  const allAvailable = rows.every((r) => r.available);

  return (
    <div
      style={{
        padding: '12px 14px',
        background: allAvailable ? 'var(--success-soft)' : 'var(--warning-soft)',
        borderRadius: 'var(--radius-md)',
        fontSize: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontWeight: 600,
          color: allAvailable ? 'var(--success-ink)' : 'var(--warning-ink)',
          marginBottom: rows.length > 1 ? 8 : 0,
        }}
      >
        {allAvailable ? (
          <CheckCircle2 size={13} />
        ) : (
          <AlertTriangle size={13} />
        )}
        {allAvailable
          ? `All members available for ${gameId}`
          : `Some members not confirmed available for ${gameId} — enabling will be blocked until data exists`}
      </div>
      {rows.length > 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
          {rows.map((r) => (
            <div
              key={r.member}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                color: r.available ? 'var(--success-ink)' : 'var(--warning-ink)',
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: r.available ? 'var(--success)' : 'var(--warning)',
                  flexShrink: 0,
                }}
              />
              <code style={{ fontSize: 11, fontFamily: 'var(--font-mono, monospace)' }}>
                {r.member || '(empty)'}
              </code>
              <span style={{ marginLeft: 'auto', fontSize: 10.5, opacity: 0.75 }}>
                {r.available ? 'available' : 'not found'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Channel multiselect ───────────────────────────────────────────────────────

function ChannelMultiSelect({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  function toggle(ch: string) {
    if (disabled) return;
    if (value.includes(ch)) {
      onChange(value.filter((c) => c !== ch));
    } else {
      onChange([...value, ch]);
    }
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
      {CHANNEL_OPTIONS.map((opt) => {
        const active = value.includes(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => toggle(opt.value)}
            disabled={disabled}
            style={{
              fontSize: 11.5,
              fontWeight: 600,
              padding: '5px 12px',
              borderRadius: 'var(--radius-full)',
              cursor: disabled ? 'not-allowed' : 'pointer',
              border: '1px solid',
              borderColor: active ? 'var(--brand)' : 'var(--border-card)',
              background: active ? 'var(--brand-soft, #eff6ff)' : 'var(--bg-card)',
              color: active ? 'var(--brand)' : 'var(--text-secondary)',
              fontFamily: 'var(--font-sans)',
              transition: 'all 0.1s',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ── TierStep bands editor ─────────────────────────────────────────────────────

function TierBandsEditor({
  bands,
  onChange,
  disabled,
}: {
  bands: TierBand[];
  onChange: (bands: TierBand[]) => void;
  disabled?: boolean;
}) {
  function updateBand(i: number, patch: Partial<TierBand>) {
    if (disabled) return;
    const next = bands.map((b, idx) => (idx === i ? { ...b, ...patch } : b));
    onChange(next);
  }

  function addBand() {
    if (disabled) return;
    onChange([...bands, { label: '', min: 0 }]);
  }

  function removeBand(i: number) {
    if (disabled) return;
    onChange(bands.filter((_, idx) => idx !== i));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {bands.map((b, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            style={{ ...inputStyle, flex: '1 1 120px' }}
            value={b.label}
            placeholder="Tier label"
            disabled={disabled}
            onChange={(e) => updateBand(i, { label: e.target.value })}
          />
          <input
            type="number"
            style={{ ...inputStyle, flex: '0 0 100px' }}
            value={b.min}
            placeholder="Min value"
            disabled={disabled}
            onChange={(e) => updateBand(i, { min: Number(e.target.value) })}
          />
          {!disabled && bands.length > 1 && (
            <button
              type="button"
              onClick={() => removeBand(i)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: 16,
                lineHeight: 1,
                padding: '0 4px',
              }}
              title="Remove band"
            >
              ×
            </button>
          )}
        </div>
      ))}
      {!disabled && (
        <button
          type="button"
          onClick={addBand}
          style={{
            alignSelf: 'flex-start',
            fontSize: 11.5,
            color: 'var(--brand)',
            background: 'none',
            border: '1px dashed var(--border-card)',
            borderRadius: 'var(--radius-md)',
            padding: '4px 10px',
            cursor: 'pointer',
            fontFamily: 'var(--font-sans)',
          }}
        >
          + Add band
        </button>
      )}
    </div>
  );
}

// ── ThresholdRule editor ──────────────────────────────────────────────────────

function ConditionEditor({
  rule,
  onChange,
  disabled,
}: {
  rule: ThresholdRule;
  onChange: (r: ThresholdRule) => void;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Kind selector */}
      <Field label="Rule kind">
        <select
          style={selectStyle}
          value={rule.kind}
          disabled={disabled}
          onChange={(e) => onChange(defaultRule(e.target.value as ThresholdRule['kind']))}
        >
          {THRESHOLD_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label} — {k.description}
            </option>
          ))}
        </select>
      </Field>

      {/* Kind-specific fields */}
      {rule.kind === 'abs' && (
        <div style={rowStyle}>
          <Field label="Member (cube.measure)">
            <input
              style={inputStyle}
              value={rule.member}
              placeholder="e.g. user_recharge_daily.ltv_vnd"
              disabled={disabled}
              onChange={(e) => onChange({ ...rule, member: e.target.value })}
            />
          </Field>
          <Field label="Operator">
            <select
              style={selectStyle}
              value={rule.op}
              disabled={disabled}
              onChange={(e) => onChange({ ...rule, op: e.target.value as AbsOp })}
            >
              <option value="gte">≥ (gte)</option>
              <option value="gt">&gt; (gt)</option>
              <option value="lte">≤ (lte)</option>
              <option value="lt">&lt; (lt)</option>
              <option value="equals">= (equals)</option>
            </select>
          </Field>
          <Field label="Value">
            <input
              type="number"
              style={inputStyle}
              value={rule.value}
              disabled={disabled}
              onChange={(e) => onChange({ ...rule, value: Number(e.target.value) })}
            />
          </Field>
        </div>
      )}

      {rule.kind === 'tierStep' && (
        <>
          <Field label="Member (cube.dimension)">
            <input
              style={inputStyle}
              value={rule.member}
              placeholder="e.g. mf_users.vip_tier"
              disabled={disabled}
              onChange={(e) => onChange({ ...rule, member: e.target.value })}
            />
          </Field>
          <div>
            <label style={labelStyle}>Tier bands (label + minimum value)</label>
            <TierBandsEditor bands={rule.bands} onChange={(b) => onChange({ ...rule, bands: b })} disabled={disabled} />
          </div>
        </>
      )}

      {rule.kind === 'event' && (
        <div style={rowStyle}>
          <Field label="Event member (time dimension)">
            <input
              style={inputStyle}
              value={rule.member}
              placeholder="e.g. mf_users.first_deposit_at"
              disabled={disabled}
              onChange={(e) => onChange({ ...rule, member: e.target.value })}
            />
          </Field>
          <Field label="Time window">
            <input
              style={inputStyle}
              value={rule.window}
              placeholder="last 7 days"
              disabled={disabled}
              onChange={(e) => onChange({ ...rule, window: e.target.value })}
            />
          </Field>
        </div>
      )}

      {rule.kind === 'percentile' && (
        <div style={rowStyle}>
          <Field label="Distribution member">
            <input
              style={inputStyle}
              value={rule.of}
              placeholder="e.g. mf_users.ltv_vnd"
              disabled={disabled}
              onChange={(e) => onChange({ ...rule, of: e.target.value })}
            />
          </Field>
          <Field label="Percentile (0–100)">
            <input
              type="number"
              min={0}
              max={100}
              style={inputStyle}
              value={rule.p}
              disabled={disabled}
              onChange={(e) => onChange({ ...rule, p: Number(e.target.value) })}
            />
          </Field>
          <Field label="Gate predicate (optional)">
            <input
              style={inputStyle}
              value={rule.gate ?? ''}
              placeholder="optional filter member"
              disabled={disabled}
              onChange={(e) => onChange({ ...rule, gate: e.target.value || undefined })}
            />
          </Field>
        </div>
      )}

      {rule.kind === 'ratio' && (
        <>
          <div style={rowStyle}>
            <Field label="Recent window member (numerator)">
              <input
                style={inputStyle}
                value={rule.member}
                placeholder="e.g. user_recharge_daily.revenue_7d"
                disabled={disabled}
                onChange={(e) => onChange({ ...rule, member: e.target.value })}
              />
            </Field>
            <Field label="Baseline member (denominator)">
              <input
                style={inputStyle}
                value={rule.vs}
                placeholder="e.g. user_recharge_daily.revenue_30d_avg"
                disabled={disabled}
                onChange={(e) => onChange({ ...rule, vs: e.target.value })}
              />
            </Field>
          </div>
          <div style={rowStyle}>
            <Field label="Ratio operator">
              <select
                style={selectStyle}
                value={rule.op}
                disabled={disabled}
                onChange={(e) => onChange({ ...rule, op: e.target.value as RatioOp })}
              >
                <option value="lt">&lt; (drop below threshold)</option>
                <option value="lte">≤ (lte)</option>
                <option value="gt">&gt; (spike above threshold)</option>
                <option value="gte">≥ (gte)</option>
              </select>
            </Field>
            <Field label="Ratio threshold (0–∞)">
              <input
                type="number"
                step="0.01"
                style={inputStyle}
                value={rule.value}
                disabled={disabled}
                onChange={(e) => onChange({ ...rule, value: Number(e.target.value) })}
              />
            </Field>
          </div>
          <div
            style={{
              padding: '8px 12px',
              background: 'var(--info-soft)',
              color: 'var(--info-ink)',
              borderRadius: 'var(--radius-md)',
              fontSize: 11.5,
            }}
          >
            Ratio rules are evaluated per-member by the trigger engine — not compiled to a
            static cohort filter. The playbook runs in <strong>trigger</strong> mode.
          </div>
        </>
      )}
    </div>
  );
}

// Local type helpers (avoid re-importing from server shape)
type AbsOp = 'gt' | 'lt' | 'gte' | 'lte' | 'equals';
type RatioOp = 'gt' | 'lt' | 'gte' | 'lte';

// ── Predicate builder wrapper ─────────────────────────────────────────────────
// Wraps the Segments predicate builder (renderRoot + usePredicateState) as an
// optional supplemental AND/OR filter on top of the threshold rule.

interface SupplementalPredicateProps {
  helpers: ReturnType<typeof usePredicateState>;
  disabled?: boolean;
}

function SupplementalPredicateSection({ helpers, disabled }: SupplementalPredicateProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        border: '1px solid var(--border-card)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          background: 'var(--bg-muted)',
          border: 'none',
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--text-secondary)',
          fontFamily: 'var(--font-sans)',
          textAlign: 'left',
        }}
      >
        <span>Additional AND/OR predicate filter (optional)</span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
          {expanded ? '▲ collapse' : '▼ expand'}
        </span>
      </button>

      {expanded && !disabled && (
        <div style={{ padding: 14 }}>
          <p
            style={{
              margin: '0 0 10px',
              fontSize: 11.5,
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-sans)',
            }}
          >
            Layer an AND/OR predicate on top of the threshold rule. Members entered here
            also count toward data-readiness checks. Use mart members (
            <code style={{ fontSize: 10.5 }}>mf_*</code>,{' '}
            <code style={{ fontSize: 10.5 }}>cons_*</code>) — raw{' '}
            <code style={{ fontSize: 10.5 }}>etl_*</code> tables are expensive and may block enabling.
          </p>
          {renderRoot(helpers.tree, {
            toggleConj: helpers.toggleConj,
            addLeaf: helpers.addLeaf,
            addGroup: helpers.addGroup,
            removeNode: helpers.removeNode,
            setLeafMember: helpers.setLeafMember,
            setLeafOp: helpers.setLeafOp,
            setLeafValues: helpers.setLeafValues,
          })}
        </div>
      )}

      {expanded && disabled && (
        <div style={{ padding: 14, fontSize: 12, color: 'var(--text-muted)' }}>
          Read-only — viewers cannot modify predicates.
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function PlaybookBuilderPage() {
  const { id: editId } = useParams<BuilderParams>();
  const history = useHistory();
  const query = useQueryParams();
  const { gameId: ctxGame } = useGameContext();
  // Honor an explicit ?game= override (e.g. opened from the Case Ledger of a game
  // that differs from the global selector) so the registry + availability checks
  // resolve against the playbook's actual game, not the ambient context.
  const gameId = query.get('game') || ctxGame;
  const user = useAuthUser();

  const isViewer = user?.role === 'viewer';

  // mode: "new" | "edit-seed" (edit a seed → POST with base_id) | "edit-override" (PATCH)
  // Determined from URL params set by the entry-point (grid row kebab).
  const mode = editId ? 'edit' : 'new';
  const baseIdFromUrl = query.get('base_id'); // set when cloning or editing a seed
  const isClone = query.get('clone') === '1';

  // Registry — needed to pre-fill edit forms and for availability checks.
  const { status: registryStatus, playbooks } = useCarePlaybooks(gameId);

  // Find the playbook being edited/cloned (from registry).
  const sourcePlaybook: ResolvedPlaybook | undefined = playbooks.find(
    (p) => p.id === (editId ?? baseIdFromUrl ?? ''),
  );

  // ── Form state ────────────────────────────────────────────────────────────

  const [name, setName] = useState('');
  const [group, setGroup] = useState<PlaybookGroup>('payment');
  const [priority, setPriority] = useState<PlaybookPriority>('tb');
  const [condition, setCondition] = useState<ThresholdRule>({ kind: 'abs', member: '', op: 'gte', value: 0 });
  const [watchedMetric, setWatchedMetric] = useState<WatchedMetricInput>({ member: '', label: '' });
  const [actionText, setActionText] = useState('');
  const [actionChannels, setActionChannels] = useState<string[]>([]);
  const [actionSla, setActionSla] = useState<number | ''>('');

  const predicateHelpers = usePredicateState();

  // Pre-fill from source playbook (edit or clone).
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current) return;
    if (registryStatus !== 'success') return;
    if (!sourcePlaybook) return;
    prefilled.current = true;

    setName(isClone ? `Copy of ${sourcePlaybook.name}` : sourcePlaybook.name);
    setGroup(sourcePlaybook.group);
    setPriority(sourcePlaybook.priority);
    if (sourcePlaybook.condition) {
      setCondition(sourcePlaybook.condition as ThresholdRule);
    }
    setWatchedMetric({
      member: sourcePlaybook.watchedMetric.member,
      label: sourcePlaybook.watchedMetric.label,
      kpiTarget: sourcePlaybook.watchedMetric.kpiTarget,
    });
    setActionText(sourcePlaybook.action.text);
    setActionChannels(sourcePlaybook.action.channels);
    setActionSla(sourcePlaybook.action.slaMinutes ?? '');
    // Re-hydrate the supplemental filter so edit/clone can adjust it (not lose it).
    if (sourcePlaybook.supplementalPredicate) {
      predicateHelpers.replaceTree(sourcePlaybook.supplementalPredicate);
    }
  }, [registryStatus, sourcePlaybook, isClone, predicateHelpers]);

  // ── Derived data-readiness ────────────────────────────────────────────────

  const pickedMembers = [
    ...ruleMembers(condition),
    ...(treeHasContent(predicateHelpers.tree) ? predicateMembers(predicateHelpers.tree) : []),
  ];
  const availableMembers = new Set<string>();
  for (const pb of playbooks) {
    if (pb.availability !== 'unavailable') {
      for (const m of pb.dataRequirements) availableMembers.add(m);
    }
  }
  const allMembersAvailable =
    pickedMembers.length === 0 ||
    pickedMembers.every((m) => !m || availableMembers.has(m));

  // ── Save ──────────────────────────────────────────────────────────────────

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleSave = useCallback(async () => {
    if (isViewer) return;

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setSaving(true);
    setSaveError(null);

    const action: ActionInput = {
      text: actionText,
      channels: actionChannels,
      slaMinutes: actionSla === '' ? undefined : Number(actionSla),
    };

    // Supplemental AND/OR filter: send the tree when authored & complete, null to
    // clear, undefined when never touched. A half-built tree blocks save rather
    // than silently persisting an invalid filter the cohort sweep can't translate.
    const hasPredicate = treeHasContent(predicateHelpers.tree);
    if (hasPredicate && !predicateHelpers.isValid) {
      setSaveError('Complete or remove the supplemental predicate filter before saving.');
      setSaving(false);
      return;
    }
    const supplementalPredicate: PredicateNode | null = hasPredicate ? predicateHelpers.tree : null;

    const dataRequirements = [
      ...new Set([
        ...ruleMembers(condition),
        ...(hasPredicate ? predicateMembers(predicateHelpers.tree) : []),
        watchedMetric.member,
      ].filter(Boolean)),
    ];

    const fields = { name, group, priority, condition, watchedMetric, action, dataRequirements, supplementalPredicate };

    try {
      // Editing an existing playbook routes by its mutation target: override/
      // custom rows PATCH by overrideId (NOT the display id, which is the seed
      // base-id for overrides); a seed POSTs a fresh override.
      const target = mode === 'edit' && sourcePlaybook && !isClone ? mutationTargetFor(sourcePlaybook) : null;

      if (target?.kind === 'patch') {
        await updatePlaybook(target.overrideId, fields, ctrl.signal);
      } else if (target?.kind === 'createFromSeed') {
        await createPlaybook(gameId, { base_id: target.baseId, ...fields }, ctrl.signal);
      } else if (isClone) {
        // Clone → net-new (base_id = null), name already pre-filled as "Copy of …"
        await createPlaybook(gameId, { base_id: null, ...fields }, ctrl.signal);
      } else {
        // New playbook (blank or pre-filled from a base_id query param).
        await createPlaybook(gameId, { base_id: baseIdFromUrl ?? null, ...fields }, ctrl.signal);
      }

      // Navigate back to monitor on success.
      history.push('/dashboards/cs');
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [
    isViewer,
    mode,
    editId,
    isClone,
    baseIdFromUrl,
    gameId,
    name,
    group,
    priority,
    condition,
    watchedMetric,
    actionText,
    actionChannels,
    actionSla,
    sourcePlaybook,
    predicateHelpers,
    history,
  ]);

  // ── Page title logic ──────────────────────────────────────────────────────

  const pageTitle = isClone
    ? 'Clone playbook'
    : mode === 'edit'
    ? 'Edit playbook'
    : 'New playbook';

  const isReady = registryStatus !== 'loading' && registryStatus !== 'idle';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={pageStyle}>
      {/* Eyebrow */}
      <div
        style={{
          fontSize: 10.5,
          textTransform: 'uppercase',
          letterSpacing: '0.09em',
          color: 'var(--text-muted)',
          fontWeight: 600,
          marginBottom: 5,
        }}
      >
        Dashboards · CS · VIP Care
      </div>

      {/* Page header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <button
            type="button"
            onClick={() => history.push('/dashboards/cs')}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              padding: 0,
            }}
            title="Back to CS Monitor"
          >
            <ChevronLeft size={18} />
          </button>
          <BookOpen size={22} color="var(--brand)" />
          <h1
            style={{
              margin: 0,
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-sans)',
            }}
          >
            {pageTitle}
          </h1>
          {sourcePlaybook && (
            <span
              style={{
                fontSize: 11.5,
                color: 'var(--text-muted)',
                background: 'var(--bg-muted)',
                padding: '3px 9px',
                borderRadius: 'var(--radius-full)',
              }}
            >
              #{sourcePlaybook.id} · {sourcePlaybook.source}
            </span>
          )}
        </div>

        <span
          style={{
            fontSize: 11.5,
            color: 'var(--text-muted)',
            background: 'var(--bg-muted)',
            padding: '4px 11px',
            borderRadius: 'var(--radius-full)',
            fontWeight: 600,
          }}
        >
          {gameId}
        </span>
      </div>

      {isViewer && (
        <div
          style={{
            padding: '10px 14px',
            background: 'var(--warning-soft)',
            color: 'var(--warning-ink)',
            borderRadius: 'var(--radius-md)',
            fontSize: 12.5,
            marginBottom: 16,
          }}
        >
          You have <strong>viewer</strong> access — this form is read-only. Contact an editor or
          admin to make changes.
        </div>
      )}

      {/* ── Section 1: Identity ──────────────────────────────────────────── */}
      <div style={cardStyle}>
        <div style={sectionTitle}>1 · Identity</div>
        <div style={rowStyle}>
          <div style={{ flex: '2 1 240px', minWidth: 0 }}>
            <label style={labelStyle}>Playbook name</label>
            <input
              style={inputStyle}
              value={name}
              placeholder="e.g. High-roller spend drop"
              disabled={isViewer}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <Field label="Group (NHÓM)">
            <select
              style={selectStyle}
              value={group}
              disabled={isViewer}
              onChange={(e) => setGroup(e.target.value as PlaybookGroup)}
            >
              {GROUP_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Priority">
            <select
              style={selectStyle}
              value={priority}
              disabled={isViewer}
              onChange={(e) => setPriority(e.target.value as PlaybookPriority)}
            >
              {PRIORITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      {/* ── Section 2: Condition ─────────────────────────────────────────── */}
      <div style={cardStyle}>
        <div style={sectionTitle}>2 · Trigger condition</div>
        <ConditionEditor rule={condition} onChange={setCondition} disabled={isViewer} />

        <div style={{ marginTop: 16 }}>
          <SupplementalPredicateSection helpers={predicateHelpers} disabled={isViewer} />
        </div>

        {/* Live data-readiness panel */}
        <div style={{ marginTop: 14 }}>
          <label style={{ ...labelStyle, marginBottom: 8 }}>
            Data readiness for <strong>{gameId}</strong>
          </label>
          {isReady ? (
            <MemberReadinessPanel
              members={pickedMembers}
              playbooks={playbooks}
              gameId={gameId}
            />
          ) : (
            <div
              style={{
                padding: '10px 14px',
                background: 'var(--bg-muted)',
                borderRadius: 'var(--radius-md)',
                fontSize: 12,
                color: 'var(--text-muted)',
              }}
            >
              Loading registry…
            </div>
          )}
        </div>
      </div>

      {/* ── Section 3: Watched metric ─────────────────────────────────────── */}
      <div style={cardStyle}>
        <div style={sectionTitle}>3 · Watched metric</div>
        <div style={rowStyle}>
          <div style={{ flex: '2 1 220px', minWidth: 0 }}>
            <label style={labelStyle}>Cube member (measure or dimension)</label>
            <input
              style={inputStyle}
              value={watchedMetric.member}
              placeholder="e.g. user_recharge_daily.ltv_vnd"
              disabled={isViewer}
              onChange={(e) =>
                setWatchedMetric((prev) => ({ ...prev, member: e.target.value }))
              }
            />
          </div>
          <Field label="Display label">
            <input
              style={inputStyle}
              value={watchedMetric.label}
              placeholder="e.g. LTV (VND)"
              disabled={isViewer}
              onChange={(e) =>
                setWatchedMetric((prev) => ({ ...prev, label: e.target.value }))
              }
            />
          </Field>
          <Field label="KPI target (optional)">
            <input
              style={inputStyle}
              value={watchedMetric.kpiTarget ?? ''}
              placeholder="e.g. ≥ ₫50M"
              disabled={isViewer}
              onChange={(e) =>
                setWatchedMetric((prev) => ({
                  ...prev,
                  kpiTarget: e.target.value || undefined,
                }))
              }
            />
          </Field>
        </div>
      </div>

      {/* ── Section 4: Action ────────────────────────────────────────────── */}
      <div style={cardStyle}>
        <div style={sectionTitle}>4 · Action</div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Action text (shown to CS agent)</label>
          <textarea
            style={{
              ...inputStyle,
              minHeight: 72,
              resize: 'vertical',
            }}
            value={actionText}
            placeholder="Describe the care action to take for this VIP…"
            disabled={isViewer}
            onChange={(e) => setActionText(e.target.value)}
          />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Contact channels</label>
          <ChannelMultiSelect
            value={actionChannels}
            onChange={setActionChannels}
            disabled={isViewer}
          />
        </div>

        <Field label="SLA (minutes, optional — default 1440 = 24h)">
          <input
            type="number"
            min={1}
            style={{ ...inputStyle, maxWidth: 180 }}
            value={actionSla}
            placeholder="1440"
            disabled={isViewer}
            onChange={(e) =>
              setActionSla(e.target.value === '' ? '' : Number(e.target.value))
            }
          />
        </Field>
      </div>

      {/* ── Save bar ─────────────────────────────────────────────────────── */}
      {!isViewer && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '16px 0 8px',
          }}
        >
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !name.trim()}
            style={{
              padding: '9px 22px',
              background: saving || !name.trim() ? 'var(--border-card)' : 'var(--brand)',
              color: saving || !name.trim() ? 'var(--text-muted)' : '#fff',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              fontSize: 13,
              fontWeight: 600,
              cursor: saving || !name.trim() ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--font-sans)',
              transition: 'background 0.12s',
            }}
          >
            {saving ? 'Saving…' : 'Save playbook'}
          </button>

          <button
            type="button"
            onClick={() => history.push('/dashboards/cs')}
            disabled={saving}
            style={{
              padding: '9px 18px',
              background: 'none',
              border: '1px solid var(--border-card)',
              borderRadius: 'var(--radius-md)',
              fontSize: 13,
              color: 'var(--text-secondary)',
              cursor: saving ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--font-sans)',
            }}
          >
            Cancel
          </button>

          {!allMembersAvailable && pickedMembers.length > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 11.5,
                color: 'var(--warning-ink)',
                background: 'var(--warning-soft)',
                padding: '5px 10px',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <AlertTriangle size={12} />
              Playbook will be saved but enabling is blocked until all members are available
              for {gameId}.
            </div>
          )}
        </div>
      )}

      {saveError && (
        <div
          style={{
            padding: '10px 14px',
            background: 'var(--destructive-soft)',
            color: 'var(--destructive-ink)',
            borderRadius: 'var(--radius-md)',
            fontSize: 12.5,
            marginTop: 8,
          }}
        >
          {saveError}
        </div>
      )}
    </div>
  );
}
