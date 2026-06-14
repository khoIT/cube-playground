/**
 * AddAngle — in-card composer for adding a custom investigation angle.
 *
 * Two paths:
 *   "Ask the Advisor" — submits the question; advisor investigates & returns a finding.
 *   "I already believe this" — manager asserts their own answer as a first-class kept
 *   finding, badged "your call (unconfirmed)". Allows a thin-data stage to move forward.
 */
import React, { useState } from 'react';
import type { Stage } from './advisor-types';
import type { InvestigationHandlers } from './use-advisor-investigation';
import { Btn, CARD_STYLE, EYEBROW_STYLE } from './advisor-primitives';

interface AddAngleProps {
  stage: Stage;
  onAdd: InvestigationHandlers['onAdd'];
  onAssert: InvestigationHandlers['onAssert'];
}

export function AddAngle({ stage, onAdd, onAssert }: AddAngleProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  const ask = () => {
    const v = q.trim();
    if (!v) return;
    onAdd(stage.key, v);
    setQ('');
    setOpen(false);
  };

  const assert = () => {
    const v = q.trim();
    if (!v) return;
    onAssert(stage.key, v);
    setQ('');
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 12.5,
          fontWeight: 600,
          padding: '14px 0',
          borderRadius: 'var(--radius-md)',
          border: '1px dashed var(--border-strong)',
          background: 'transparent',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          minHeight: 60,
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 3,
        }}
      >
        <span>+ Add your own angle</span>
        <span style={{ fontWeight: 400, fontSize: 11 }}>
          (ask the Advisor — or state what you already believe)
        </span>
      </button>
    );
  }

  return (
    <div
      style={{
        ...CARD_STYLE,
        padding: '12px 13px',
        borderColor: 'var(--brand)',
        background: 'var(--bg-muted)',
      }}
    >
      <div style={{ ...EYEBROW_STYLE, marginBottom: 6 }}>About "{stage.label}"</div>
      <textarea
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask();
        }}
        rows={2}
        placeholder={`Ask: ${stage.q}`}
        style={{
          width: '100%',
          fontFamily: 'var(--font-sans)',
          fontSize: 13,
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius-sm)',
          padding: '7px 9px',
          outline: 'none',
          resize: 'none',
          background: 'var(--bg-card)',
          color: 'var(--text-primary)',
        }}
      />
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <Btn sm kind="primary" onClick={ask} disabled={!q.trim()}>
          ✨ Ask the Advisor
        </Btn>
        <Btn sm onClick={assert} disabled={!q.trim()}>
          ✋ I already believe this
        </Btn>
        <Btn
          sm
          onClick={() => {
            setOpen(false);
            setQ('');
          }}
        >
          Cancel
        </Btn>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.4 }}>
        "I already believe this" keeps it as <b>your call</b> (unconfirmed) so a thin-data step
        still moves forward.
      </div>
    </div>
  );
}
