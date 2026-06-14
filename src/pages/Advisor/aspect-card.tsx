/**
 * AspectCard — one investigatable angle within a stage.
 *
 * Lifecycle: idle → working → done.
 * Also handles: editing (reword & re-ask), needinfo (advisor needs context).
 *
 * Triage (post-investigation verdict):
 *   ✓ Keep  — true & load-bearing → fills the blueprint slot
 *   ⚑ Flag  — interesting but unsure → stays an open question
 *   ✕ Rule out — looked, doesn't change the plan
 *
 * Scope toggle is demoted to a quiet "skip" — triage is the one primary decision.
 */
import React, { useState } from 'react';
import type { Aspect } from './advisor-types';
import { CONF_CONFIG, TRIAGE_CONFIG, FEAS_CONFIG } from './advisor-stage-config';
import { Pill, Btn, CARD_STYLE, EYEBROW_STYLE, PulsingRow } from './advisor-primitives';
import type { InvestigationHandlers } from './use-advisor-investigation';

const composerInputStyle: React.CSSProperties = {
  width: '100%',
  fontFamily: 'var(--font-sans)',
  fontSize: 13,
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-sm)',
  padding: '7px 9px',
  outline: 'none',
  resize: 'none' as const,
  background: 'var(--bg-card)',
  marginTop: 8,
  color: 'var(--text-primary)',
};

type HandlerProps = Pick<
  InvestigationHandlers,
  | 'onWork'
  | 'onTriage'
  | 'onToggle'
  | 'onOpen'
  | 'onRefine'
  | 'onCancelEdit'
  | 'onResubmit'
  | 'onProvideInfo'
>;

interface AspectCardProps extends HandlerProps {
  a: Aspect;
}

export function AspectCard({
  a,
  onWork,
  onTriage,
  onToggle,
  onOpen,
  onRefine,
  onCancelEdit,
  onResubmit,
  onProvideInfo,
}: AspectCardProps) {
  const [draft, setDraft] = useState(a.q);
  const [info, setInfo] = useState('');

  const isWorking = a.state === 'working';
  const isDone = a.state === 'done';
  const isEditing = a.state === 'editing';
  const isNeedinfo = a.state === 'needinfo';

  // Border colour signals triage status or active state
  const borderColor =
    a.triage === 'keep'
      ? 'var(--success)'
      : a.triage === 'flag'
        ? 'var(--warning)'
        : isNeedinfo
          ? 'var(--warning)'
          : isEditing
            ? 'var(--brand)'
            : 'var(--border-card)';

  // Skipped (scope toggled off) — show collapsed with "+ include"
  if (!a.on) {
    return (
      <div
        style={{
          ...CARD_STYLE,
          padding: '10px 14px',
          opacity: 0.6,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)', textDecoration: 'line-through' }}>
          {a.q}
        </span>
        <button
          onClick={() => onToggle(a.id)}
          style={{
            fontFamily: 'var(--font-sans)',
            flexShrink: 0,
            border: '1px solid var(--border-strong)',
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text-secondary)',
            fontSize: 11.5,
            fontWeight: 600,
            cursor: 'pointer',
            padding: '3px 9px',
          }}
        >
          + include
        </button>
      </div>
    );
  }

  return (
    <div style={{ ...CARD_STYLE, padding: '13px 15px', borderColor }}>
      {/* Header row: question + skip button */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.35, fontFamily: 'var(--font-sans)' }}>
          {a.q}
        </span>
        <button
          onClick={() => onToggle(a.id)}
          title="Set aside — not worth looking at. (Stays available to put back.)"
          style={{
            fontFamily: 'var(--font-sans)',
            flexShrink: 0,
            border: 'none',
            background: 'none',
            color: 'var(--text-muted)',
            fontSize: 11,
            cursor: 'pointer',
            padding: '2px 0',
          }}
        >
          skip
        </button>
      </div>

      {/* Feasibility pill for lever cards */}
      {a.feas && (
        <div style={{ marginTop: 7 }}>
          <Pill bg={FEAS_CONFIG[a.feas].bg} ink={FEAS_CONFIG[a.feas].ink}>
            {FEAS_CONFIG[a.feas].label}
          </Pill>
          {a.feas !== 'true' && a.why && (
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.45 }}>
              Why: {a.why}
              {a.sub && (
                <>
                  <br />
                  <b style={{ color: 'var(--text-secondary)' }}>Nearest we can do today:</b> {a.sub}.
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Idle — "Look into this" CTA */}
      {!isDone && !isWorking && !isEditing && !isNeedinfo && (
        <button
          onClick={() => onWork(a.id)}
          style={{
            fontFamily: 'var(--font-sans)',
            marginTop: 11,
            width: '100%',
            fontSize: 12.5,
            fontWeight: 600,
            padding: '8px 0',
            borderRadius: 'var(--radius-md)',
            border: '1px dashed var(--brand)',
            background: 'var(--bg-muted)',
            color: 'var(--brand)',
            cursor: 'pointer',
          }}
        >
          ✨ Look into this
        </button>
      )}

      {/* Working state */}
      {isWorking && (
        <div style={{ marginTop: 11 }}>
          <PulsingRow>
            <span>✨</span> Advisor is digging…
          </PulsingRow>
        </div>
      )}

      {/* Editing — reword & re-ask */}
      {isEditing && (
        <div style={{ marginTop: 10 }}>
          <div style={{ ...EYEBROW_STYLE, marginBottom: 2 }}>Reword & re-ask</div>
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                onResubmit(a.id, a.stage, draft.trim() || a.q);
              }
            }}
            rows={2}
            style={composerInputStyle}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 7 }}>
            <Btn sm kind="primary" onClick={() => onResubmit(a.id, a.stage, draft.trim() || a.q)}>
              ✨ Re-ask
            </Btn>
            <Btn
              sm
              onClick={() => {
                setDraft(a.q);
                onCancelEdit(a.id);
              }}
            >
              Cancel
            </Btn>
          </div>
        </div>
      )}

      {/* Needs info — advisor couldn't source it */}
      {isNeedinfo && (
        <div style={{ marginTop: 10 }}>
          <div
            style={{
              padding: '10px 12px',
              background: 'var(--warning-soft)',
              borderRadius: 'var(--radius-md)',
              fontSize: 12.5,
              color: 'var(--warning-ink)',
              lineHeight: 1.45,
              display: 'flex',
              gap: 7,
            }}
          >
            <span>🤔</span>
            <span>{a.need}</span>
          </div>
          <textarea
            autoFocus
            value={info}
            onChange={(e) => setInfo(e.target.value)}
            rows={2}
            placeholder='Add the missing context (e.g. "benchmark vs MLBB ARPPU ≈ 95k₫")…'
            style={composerInputStyle}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 7, flexWrap: 'wrap' }}>
            <Btn
              sm
              kind="primary"
              onClick={() => info.trim() && onProvideInfo(a.id, a.stage, info.trim())}
              disabled={!info.trim()}
            >
              Send & retry
            </Btn>
            <Btn
              sm
              onClick={() => {
                setDraft(a.q);
                onRefine(a.id);
              }}
            >
              ✎ Reword instead
            </Btn>
          </div>
        </div>
      )}

      {/* Done — finding + triage controls */}
      {isDone && (
        <div style={{ marginTop: 10 }}>
          <div
            onClick={() => onOpen(a.id)}
            style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.45, cursor: 'pointer' }}
          >
            {a.finding}
          </div>

          {/* Basis note for proof cards */}
          {a.basis && (
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.45 }}>
              📎 {a.basis}
            </div>
          )}

          {/* Pills + triage row */}
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 9, flexWrap: 'wrap' }}
          >
            {a.asserted ? (
              <Pill
                bg="var(--warning-soft)"
                ink="var(--warning-ink)"
                title="your assumption — kept so the experiment can move; not yet confirmed in data"
              >
                ✋ your call · unconfirmed
              </Pill>
            ) : (
              <>
                {a.custom && (
                  <Pill bg="var(--info-soft)" ink="var(--info-ink)" title="you asked this">
                    your angle
                  </Pill>
                )}
                <Pill bg={CONF_CONFIG[a.conf].bg} ink={CONF_CONFIG[a.conf].ink}>
                  {CONF_CONFIG[a.conf].label}
                </Pill>
              </>
            )}

            {a.triage === 'keep' && a.slot && (
              <Pill bg="var(--bg-muted)" ink="var(--brand)" title="this fills the blueprint slot">
                → blueprint
              </Pill>
            )}

            <button
              onClick={() => {
                setDraft(a.q);
                onRefine(a.id);
              }}
              title="reword & re-investigate"
              style={{
                fontFamily: 'var(--font-sans)',
                border: 'none',
                background: 'none',
                color: 'var(--text-muted)',
                fontSize: 11.5,
                fontWeight: 600,
                cursor: 'pointer',
                padding: 0,
              }}
            >
              ✎ refine
            </button>

            <span style={{ flex: 1 }} />

            {/* Triage buttons */}
            {(['keep', 'flag', 'dismiss'] as const).map((t) => {
              const active = a.triage === t;
              const cfg = TRIAGE_CONFIG[t];
              return (
                <button
                  key={t}
                  title={`${cfg.label} — ${cfg.hint}`}
                  onClick={() => onTriage(a.id, active ? null : t)}
                  style={{
                    fontFamily: 'var(--font-sans)',
                    width: 26,
                    height: 26,
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    fontSize: 12,
                    border: `1px solid ${active ? cfg.ink : 'var(--border-strong)'}`,
                    background: active ? cfg.bg : 'var(--bg-card)',
                    color: active ? cfg.ink : 'var(--text-muted)',
                  }}
                >
                  {cfg.icon}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
