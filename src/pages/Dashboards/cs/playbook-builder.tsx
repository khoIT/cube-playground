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
 *   - 24px 32px padding, maxWidth 1320, margin 0 auto
 *   - var(--font-sans) only; design tokens throughout, no raw hex
 *   - Page-header mirrors CS Monitor (icon + title)
 *   - Viewer role: form renders read-only; save button hidden
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useHistory, useLocation, useParams } from 'react-router-dom';
import { HeartHandshake, ChevronLeft, AlertTriangle, CheckCircle2, Calculator, Zap } from 'lucide-react';
import { useGameContext } from '../../../components/Header/use-game-context';
import { useAuthUser } from '../../../auth/auth-context';
import { useCarePlaybooks } from './use-care-playbooks';
import { createPlaybook, updatePlaybook } from './use-playbook-mutations';
import { previewCount, sweepSegment, type PreviewCountResult, type SweepSegmentResult } from './use-playbook-preview';
import { mutationTargetFor, resolveSweepTargetId } from './playbook-mutation-target';
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
  maxWidth: 1320,
  margin: '0 auto',
  fontFamily: 'var(--font-sans)',
};

// Two-column shell: authoring sections on the left, sticky live-segment rail on
// the right (match count + data readiness + save/sweep stay in view while editing).
const twoColStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 360px',
  gap: 22,
  alignItems: 'start',
};
const railColStyle: React.CSSProperties = {
  position: 'sticky',
  top: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};
const railCardStyle: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-xl)',
  boxShadow: 'var(--shadow-sm)',
  padding: 16,
};
const railTitleStyle: React.CSSProperties = {
  fontSize: 10.5,
  textTransform: 'uppercase',
  letterSpacing: '0.07em',
  color: 'var(--text-muted)',
  fontWeight: 700,
  marginBottom: 12,
};
const railBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 7,
  width: '100%',
  padding: '9px 14px',
  borderRadius: 'var(--radius-md)',
  fontSize: 12.5,
  fontWeight: 600,
  fontFamily: 'var(--font-sans)',
  border: '1px solid var(--border-strong)',
  background: 'var(--bg-card)',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
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
  style,
}: {
  label: string;
  children: React.ReactNode;
  /** Width override merged over the default flex sizing (e.g. narrow operator column). */
  style?: React.CSSProperties;
}) {
  return (
    <div style={style ? { ...fieldStyle, ...style } : fieldStyle}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

// Segmented control for the rule-kind picker — mirrors the redesign's .segctl
// (replaces the dropdown that, wrapped in a column-flex Field, reserved vertical
// flex-basis and left a white gap beneath itself).
const segCtlStyle: React.CSSProperties = {
  display: 'inline-flex',
  flexWrap: 'wrap',
  gap: 2,
  background: 'var(--bg-muted)',
  borderRadius: 'var(--radius-md)',
  padding: 3,
};
const segBtnStyle: React.CSSProperties = {
  border: 0,
  background: 'transparent',
  fontFamily: 'var(--font-sans)',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text-muted)',
  padding: '6px 13px',
  borderRadius: 'var(--radius-sm)',
};
const segBtnOnStyle: React.CSSProperties = {
  background: 'var(--bg-card)',
  color: 'var(--text-primary)',
  boxShadow: 'var(--shadow-sm)',
};

// Member / Operator / Value column widths for the trigger-condition row.
const memberFieldStyle: React.CSSProperties = { flex: '2 1 240px' };
const opFieldStyle: React.CSSProperties = { flex: '0 0 150px' };
const valueFieldStyle: React.CSSProperties = { flex: '0 0 160px' };
const windowFieldStyle: React.CSSProperties = { flex: '1 1 170px' };

function RuleKindSegmented({
  value,
  onChange,
  disabled,
}: {
  value: ThresholdRule['kind'];
  onChange: (k: ThresholdRule['kind']) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label style={labelStyle}>Rule kind</label>
      <div style={segCtlStyle}>
        {THRESHOLD_KINDS.map((k) => {
          const on = k.value === value;
          return (
            <button
              key={k.value}
              type="button"
              title={k.description}
              disabled={disabled}
              onClick={() => !disabled && onChange(k.value)}
              style={{
                ...segBtnStyle,
                ...(on ? segBtnOnStyle : null),
                cursor: disabled ? 'not-allowed' : 'pointer',
              }}
            >
              {k.label}
            </button>
          );
        })}
      </div>
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
  { value: 'cao',  label: 'High' },
  { value: 'tb',   label: 'Medium' },
  { value: 'thap', label: 'Low' },
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
    case 'event':      return { kind: 'event',      member: '', window: 'last 7 days', op: 'in' };
    case 'percentile': return { kind: 'percentile', of: '', p: 90, op: 'gte' };
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
  member,
  onChange,
  disabled,
}: {
  bands: TierBand[];
  /** Watched member — used only to render the compiled cohort-filter caption. */
  member?: string;
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

  // The lowest band by `min` is the entry threshold: a tierStep rule compiles to
  // `member >= lowest.min` (see server compileRule). Higher bands are display-only
  // tiers attributed at snapshot time — editing them does NOT change the cohort.
  const lowestIdx = bands.reduce(
    (lo, b, idx) => (lo === -1 || b.min < bands[lo].min ? idx : lo),
    -1,
  );
  const lowest = lowestIdx >= 0 ? bands[lowestIdx] : undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {bands.map((b, i) => {
        const isTrigger = i === lowestIdx;
        return (
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
          <span
            style={{
              flex: '0 0 92px',
              fontSize: 10,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              color: isTrigger ? 'var(--brand)' : 'var(--text-muted)',
            }}
            title={
              isTrigger
                ? 'Lowest band — this is the entry threshold that gates the cohort'
                : 'Display-only tier — does not affect who enters the playbook'
            }
          >
            {isTrigger ? '◀ trigger' : 'tier label'}
          </span>
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
        );
      })}
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
      {lowest && (
        <div
          style={{
            marginTop: 2,
            fontSize: 11,
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-sans)',
          }}
        >
          Gates cohort:{' '}
          <code style={{ fontSize: 10.5, fontFamily: 'var(--font-mono, monospace)' }}>
            {member || '(member)'} ≥ {lowest.min.toLocaleString()}
          </code>
          {bands.length > 1 && ' — higher bands are display-only tiers'}
        </div>
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
      {/* Kind selector — segmented control (see RuleKindSegmented). */}
      <RuleKindSegmented
        value={rule.kind}
        onChange={(k) => onChange(defaultRule(k))}
        disabled={disabled}
      />

      {/* Kind-specific fields — uniform Member / Operator / Value row. */}
      {rule.kind === 'abs' && (
        <div style={rowStyle}>
          <Field label="Member (cube.measure)" style={memberFieldStyle}>
            <input
              style={inputStyle}
              value={rule.member}
              placeholder="e.g. user_recharge_daily.ltv_vnd"
              disabled={disabled}
              onChange={(e) => onChange({ ...rule, member: e.target.value })}
            />
          </Field>
          <Field label="Operator" style={opFieldStyle}>
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
          <Field label="Value" style={valueFieldStyle}>
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
          <div style={rowStyle}>
            <Field label="Member (cube.dimension)" style={memberFieldStyle}>
              <input
                style={inputStyle}
                value={rule.member}
                placeholder="e.g. mf_users.vip_tier"
                disabled={disabled}
                onChange={(e) => onChange({ ...rule, member: e.target.value })}
              />
            </Field>
            {/* Tier entry is always "reached" (≥ the lowest band) — the operator is
                shown for layout parity but fixed; the band mins carry the value. */}
            <Field label="Operator" style={opFieldStyle}>
              <select style={selectStyle} value="reaches" disabled title="Tier entry is ≥ the lowest band">
                <option value="reaches">≥ reaches</option>
              </select>
            </Field>
          </div>
          <div>
            <label style={labelStyle}>Tier bands (lowest min = entry threshold)</label>
            <TierBandsEditor
              bands={rule.bands}
              member={rule.member}
              onChange={(b) => onChange({ ...rule, bands: b })}
              disabled={disabled}
            />
          </div>
        </>
      )}

      {rule.kind === 'event' && (() => {
        // "anniversary" expands to an OR of milestone-day ranges, which has no
        // negation form — only "in window" is meaningful. Lock the operator to
        // 'in' so a "not in window" pick can't silently drop to an empty cohort.
        const isAnniversaryWindow = rule.window.trim().toLowerCase() === 'anniversary';
        return (
        <div style={rowStyle}>
          <Field label="Event member (time dimension)" style={memberFieldStyle}>
            <input
              style={inputStyle}
              value={rule.member}
              placeholder="e.g. mf_users.first_deposit_at"
              disabled={disabled}
              onChange={(e) => onChange({ ...rule, member: e.target.value })}
            />
          </Field>
          <Field label="Operator" style={opFieldStyle}>
            <select
              style={selectStyle}
              value={isAnniversaryWindow ? 'in' : (rule.op ?? 'in')}
              disabled={disabled || isAnniversaryWindow}
              title={isAnniversaryWindow ? 'Anniversary windows only support "in window"' : undefined}
              onChange={(e) => onChange({ ...rule, op: e.target.value as 'in' | 'notIn' })}
            >
              <option value="in">in window</option>
              {!isAnniversaryWindow && <option value="notIn">not in window</option>}
            </select>
          </Field>
          <Field label="Time window" style={windowFieldStyle}>
            <input
              style={inputStyle}
              value={rule.window}
              placeholder="last 7 days"
              disabled={disabled}
              // Switching to an anniversary window forces op back to 'in' (notIn is unsupported there).
              onChange={(e) => {
                const window = e.target.value;
                const next: ThresholdRule =
                  window.trim().toLowerCase() === 'anniversary'
                    ? { ...rule, window, op: 'in' }
                    : { ...rule, window };
                onChange(next);
              }}
            />
          </Field>
        </div>
        );
      })()}

      {rule.kind === 'percentile' && (
        <>
          <div style={rowStyle}>
            <Field label="Distribution member" style={memberFieldStyle}>
              <input
                style={inputStyle}
                value={rule.of}
                placeholder="e.g. mf_users.ltv_vnd"
                disabled={disabled}
                onChange={(e) => onChange({ ...rule, of: e.target.value })}
              />
            </Field>
            <Field label="Operator" style={opFieldStyle}>
              <select
                style={selectStyle}
                value={rule.op ?? 'gte'}
                disabled={disabled}
                onChange={(e) => onChange({ ...rule, op: e.target.value as 'gte' | 'lte' })}
              >
                <option value="gte">≥ (top Pn)</option>
                <option value="lte">≤ (bottom Pn)</option>
              </select>
            </Field>
            <Field label="Percentile (0–100)" style={valueFieldStyle}>
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
          </div>
          <Field label="Gate predicate (optional)" style={memberFieldStyle}>
            <input
              style={inputStyle}
              value={rule.gate ?? ''}
              placeholder="optional filter member"
              disabled={disabled}
              onChange={(e) => onChange({ ...rule, gate: e.target.value || undefined })}
            />
          </Field>
        </>
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

/** Persistable playbook fields the create/update mutations accept. */
interface PersistFields {
  name: string;
  group: PlaybookGroup;
  priority: PlaybookPriority;
  condition: ThresholdRule;
  watchedMetric: WatchedMetricInput;
  action: ActionInput;
  dataRequirements: string[];
  supplementalPredicate: PredicateNode | null;
}

/** Result of validating the current form into persistable fields. */
type BuildFieldsResult = { fields: PersistFields } | { error: string };

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

  // ── Save / Count / Sweep ────────────────────────────────────────────────────

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Live match-count (read-only Trino dry run) state.
  const [counting, setCounting] = useState(false);
  const [countResult, setCountResult] = useState<PreviewCountResult | null>(null);
  const [countError, setCountError] = useState<string | null>(null);
  const countAbortRef = useRef<AbortController | null>(null);

  // Per-segment sweep (persist then open/lapse just this playbook) state.
  const [sweeping, setSweeping] = useState(false);
  const [sweepResult, setSweepResult] = useState<SweepSegmentResult | null>(null);
  const [sweepError, setSweepError] = useState<string | null>(null);

  // Build the persistable fields from the current form, or report why not. The
  // single source for what Save, Count, and Save&sweep all act on — so a counted
  // cohort can't drift from what a save+sweep would persist and open.
  const buildFields = useCallback((): BuildFieldsResult => {
    // A half-built supplemental tree is invalid — block rather than persist a
    // filter the cohort query can't translate.
    const hasPredicate = treeHasContent(predicateHelpers.tree);
    if (hasPredicate && !predicateHelpers.isValid) {
      return { error: 'Complete or remove the supplemental predicate filter first.' };
    }
    const supplementalPredicate: PredicateNode | null = hasPredicate ? predicateHelpers.tree : null;
    const action: ActionInput = {
      text: actionText,
      channels: actionChannels,
      slaMinutes: actionSla === '' ? undefined : Number(actionSla),
    };
    const dataRequirements = [
      ...new Set([
        ...ruleMembers(condition),
        ...(hasPredicate ? predicateMembers(predicateHelpers.tree) : []),
        watchedMetric.member,
      ].filter(Boolean)),
    ];
    return { fields: { name, group, priority, condition, watchedMetric, action, dataRequirements, supplementalPredicate } };
  }, [name, group, priority, condition, watchedMetric, actionText, actionChannels, actionSla, predicateHelpers]);

  // Persist the current form and return the RESOLVED display id (the id the
  // sweep filters on), or null on a validation block. Routes the same 4 ways as
  // the merge layer: PATCH an override/custom row by its row id; POST a fresh
  // override for a seed (display id stays the seed id); POST net-new (display id
  // is the new row id). Throws on API error so callers can surface it.
  const persist = useCallback(async (signal: AbortSignal): Promise<string | null> => {
    const built = buildFields();
    if ('error' in built) { setSaveError(built.error); return null; }
    const { fields } = built;
    // Editing an existing playbook routes by its mutation target: override/custom
    // rows PATCH by overrideId; a seed POSTs a fresh override. Clone/new always
    // create (target stays null).
    const mutation = mode === 'edit' && sourcePlaybook && !isClone ? mutationTargetFor(sourcePlaybook) : null;

    let createdRowId: string | undefined;
    if (mutation?.kind === 'patch') {
      await updatePlaybook(mutation.overrideId, fields, signal);
    } else if (mutation?.kind === 'createFromSeed') {
      await createPlaybook(gameId, { base_id: mutation.baseId, ...fields }, signal);
    } else if (isClone) {
      createdRowId = (await createPlaybook(gameId, { base_id: null, ...fields }, signal)).id;
    } else {
      createdRowId = (await createPlaybook(gameId, { base_id: baseIdFromUrl ?? null, ...fields }, signal)).id;
    }
    // The sweep filters on the resolved DISPLAY id, which differs from the row id
    // for overrides/seeds — resolve it from the same routing inputs.
    return resolveSweepTargetId({ mutation, sourceDisplayId: sourcePlaybook?.id, isClone, baseIdFromUrl, createdRowId });
  }, [buildFields, mode, isClone, baseIdFromUrl, gameId, sourcePlaybook]);

  const handleSave = useCallback(async () => {
    if (isViewer) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setSaving(true);
    setSaveError(null);
    try {
      const id = await persist(ctrl.signal);
      if (id === null) return; // validation block — error already set
      history.push('/dashboards/cs');
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [isViewer, persist, history]);

  // The condition's members; count is meaningless without at least one.
  const conditionHasMember = ruleMembers(condition).some(Boolean);

  const handleCount = useCallback(async () => {
    if (isViewer) return;
    const built = buildFields();
    if ('error' in built) { setCountError(built.error); setCountResult(null); return; }
    countAbortRef.current?.abort();
    const ctrl = new AbortController();
    countAbortRef.current = ctrl;
    setCounting(true);
    setCountError(null);
    setCountResult(null);
    try {
      const r = await previewCount(
        gameId,
        editId ?? 'new',
        { condition: built.fields.condition, supplementalPredicate: built.fields.supplementalPredicate },
        ctrl.signal,
      );
      setCountResult(r);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setCountError(err instanceof Error ? err.message : 'Count failed');
    } finally {
      setCounting(false);
    }
  }, [isViewer, buildFields, gameId, editId]);

  // Auto-run the live count once on initial load so the match number is the
  // first thing the editor sees (the count is the co-star of this surface, per
  // the redesign). Fires only after the form pre-fills from an existing
  // playbook, and only when the count button would itself be enabled (a
  // condition member is set, all members are available, and the user is not a
  // viewer). It never re-fires on keystroke — subsequent counts stay explicit
  // via the button, keeping the cold-Trino query off the edit hot path.
  const autoCounted = useRef(false);
  useEffect(() => {
    if (autoCounted.current) return;
    if (isViewer) return;
    if (!sourcePlaybook) return; // a blank "new" form has nothing to count yet
    if (!conditionHasMember || !allMembersAvailable) return;
    autoCounted.current = true;
    void handleCount();
  }, [isViewer, sourcePlaybook, conditionHasMember, allMembersAvailable, handleCount]);

  const handleSaveAndSweep = useCallback(async () => {
    if (isViewer) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setSweeping(true);
    setSweepError(null);
    setSweepResult(null);
    setSaveError(null);
    try {
      const id = await persist(ctrl.signal);
      if (id === null) return; // validation block — error already set
      const r = await sweepSegment(gameId, id, ctrl.signal);
      setSweepResult(r);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setSweepError(err instanceof Error ? err.message : 'Save & sweep failed');
    } finally {
      setSweeping(false);
    }
  }, [isViewer, persist, gameId]);

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
      {/* Page header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 4,
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
          <HeartHandshake size={24} color="var(--brand)" />
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

      <p style={{ margin: '2px 0 20px', fontSize: 12.5, color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>
        Tune the trigger condition, then count matching VIPs against live data before you save. Save &amp; sweep
        opens cases for this one segment now.
      </p>

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

      <div style={twoColStyle}>
        {/* Left column — the four authoring sections */}
        <div>

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

        </div>{/* end left column */}

        {/* Right column — sticky live-segment rail */}
        <div style={railColStyle}>
          {/* Live match count — a read-only dry run against live data. Explicit
              click only: the cold query can take several seconds, so it never
              auto-fires while the condition is being edited. */}
          <div style={railCardStyle}>
            <div style={railTitleStyle}>Live match · VIPs in this segment</div>
            <div style={{ minHeight: 46, marginBottom: 13 }}>
              {counting ? (
                <>
                  <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1, color: 'var(--text-muted)' }}>—</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>Querying live data — can take several seconds.</div>
                </>
              ) : countResult ? (
                countResult.note ? (
                  <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{countResult.note}</div>
                ) : (
                  <>
                    <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                      {countResult.matched.toLocaleString()}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>
                      <strong style={{ color: 'var(--success-ink)' }}>VIP{countResult.matched === 1 ? '' : 's'} match</strong>
                      {countResult.elapsedMs != null && <> · {countResult.elapsedMs}ms</>}
                    </div>
                  </>
                )
              ) : (
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Run a count to see how many VIPs match.</div>
              )}
            </div>

            {!isViewer && (
              <button
                type="button"
                onClick={handleCount}
                disabled={counting || !conditionHasMember || !allMembersAvailable}
                title={
                  !conditionHasMember
                    ? 'Set a condition member first'
                    : !allMembersAvailable
                    ? `Some members are unavailable for ${gameId}`
                    : 'Count matching VIPs against live data'
                }
                style={{
                  ...railBtnStyle,
                  background: 'var(--bg-muted)',
                  borderColor: 'var(--border-card)',
                  color: counting || !conditionHasMember || !allMembersAvailable ? 'var(--text-muted)' : 'var(--text-secondary)',
                  cursor: counting || !conditionHasMember || !allMembersAvailable ? 'not-allowed' : 'pointer',
                }}
              >
                <Calculator size={14} />
                {counting ? 'Counting…' : 'Count matches'}
              </button>
            )}
            {!counting && countError && (
              <div style={{ fontSize: 12, color: 'var(--destructive-ink)', marginTop: 8 }}>{countError}</div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--info)', display: 'inline-block' }} />
              VIP-base gated (LTV ≥ ₫1M), same as the sweep.
            </div>
          </div>

          {/* Data readiness — moved out of the condition card so it stays visible. */}
          <div style={railCardStyle}>
            <div style={railTitleStyle}>Data readiness · {gameId}</div>
            {isReady ? (
              <MemberReadinessPanel members={pickedMembers} playbooks={playbooks} gameId={gameId} />
            ) : (
              <div style={{ padding: '10px 14px', background: 'var(--bg-muted)', borderRadius: 'var(--radius-md)', fontSize: 12, color: 'var(--text-muted)' }}>
                Loading registry…
              </div>
            )}
          </div>

          {/* Save actions — editor/admin only. */}
          {!isViewer && (
            <div style={railCardStyle}>
              <div style={railTitleStyle}>Save</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || !name.trim()}
                  style={{
                    ...railBtnStyle,
                    background: saving || !name.trim() ? 'var(--border-card)' : 'var(--brand)',
                    borderColor: saving || !name.trim() ? 'var(--border-card)' : 'var(--brand)',
                    color: saving || !name.trim() ? 'var(--text-muted)' : 'var(--text-on-brand)',
                    cursor: saving || !name.trim() ? 'not-allowed' : 'pointer',
                  }}
                >
                  {saving ? 'Saving…' : 'Save playbook'}
                </button>

                {/* Save then open/lapse cases for just this one playbook. */}
                <button
                  type="button"
                  onClick={handleSaveAndSweep}
                  disabled={saving || sweeping || !name.trim()}
                  title="Save, then sweep this one segment (open/lapse its cases now)"
                  style={{
                    ...railBtnStyle,
                    background: saving || sweeping || !name.trim() ? 'var(--bg-muted)' : 'var(--brand-soft, var(--bg-muted))',
                    borderColor: 'var(--brand)',
                    color: saving || sweeping || !name.trim() ? 'var(--text-muted)' : 'var(--brand)',
                    cursor: saving || sweeping || !name.trim() ? 'not-allowed' : 'pointer',
                  }}
                >
                  <Zap size={14} />
                  {sweeping ? 'Sweeping…' : 'Save & sweep this segment'}
                </button>

                <button
                  type="button"
                  onClick={() => history.push('/dashboards/cs')}
                  disabled={saving}
                  style={{ ...railBtnStyle, cursor: saving ? 'not-allowed' : 'pointer' }}
                >
                  Cancel
                </button>
              </div>

              {!allMembersAvailable && pickedMembers.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 11.5,
                    color: 'var(--warning-ink)',
                    background: 'var(--warning-soft)',
                    padding: '7px 10px',
                    borderRadius: 'var(--radius-md)',
                    marginTop: 10,
                  }}
                >
                  <AlertTriangle size={12} />
                  Enabling is blocked until all members are available for {gameId}.
                </div>
              )}

              {saveError && (
                <div style={{ padding: '10px 12px', background: 'var(--destructive-soft)', color: 'var(--destructive-ink)', borderRadius: 'var(--radius-md)', fontSize: 12.5, marginTop: 10 }}>
                  {saveError}
                </div>
              )}
              {sweepError && (
                <div style={{ padding: '10px 12px', background: 'var(--destructive-soft)', color: 'var(--destructive-ink)', borderRadius: 'var(--radius-md)', fontSize: 12.5, marginTop: 10 }}>
                  {sweepError}
                </div>
              )}
              {sweepResult && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9, padding: '12px 13px', background: 'var(--success-soft)', color: 'var(--success-ink)', borderRadius: 'var(--radius-md)', fontSize: 12.5, marginTop: 10 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                    <CheckCircle2 size={14} />
                    Swept this segment — {sweepResult.opened} opened · {sweepResult.lapsed} removed (no longer match)
                  </span>
                  <button
                    type="button"
                    onClick={() => history.push('/dashboards/cs')}
                    style={{ alignSelf: 'flex-start', padding: '5px 12px', background: 'none', border: '1px solid var(--success-ink)', borderRadius: 'var(--radius-md)', fontSize: 12, fontWeight: 600, color: 'var(--success-ink)', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}
                  >
                    Back to monitor
                  </button>
                </div>
              )}
            </div>
          )}
        </div>{/* end rail */}
      </div>{/* end two-column */}
    </div>
  );
}
