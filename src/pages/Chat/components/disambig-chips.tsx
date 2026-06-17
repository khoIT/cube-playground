/**
 * DisambigChips — clickable pill row rendered below an assistant turn whose
 * disambiguate_query tool returned a clarification, OR whose agent ended the
 * turn with an offer_choices option set (slot 'choice').
 *
 * Each chip's pinText, when sent as the next user message, lets the BE
 * disambiguator (with session memory) resolve the slot without re-asking.
 * For engine slots the same click also writes the resolution into kv_cache
 * server-side; for 'choice' the pinText is a self-contained instruction that
 * the next turn's disambiguator resolves on its own.
 *
 * Styling: the three engine slots keep the quiet neutral pill so they read as
 * a gentle clarification. The agent-authored 'choice' slot uses the brand
 * accent ladder (soft fill + brand border at rest → solid brand on hover) so
 * the next-step actions stand out as the primary affordance of the turn.
 */
import React from 'react';
import { T } from '../../../shell/theme';
import { postChatAudit } from '../../../api/chat-audit-client';
import type { DisambigOption } from '../../../api/chat-sse-client';

interface Props {
  prompt: string;
  slot: 'metric' | 'dimension' | 'timeRange' | 'choice';
  options: ReadonlyArray<DisambigOption>;
  onPick: (pinText: string) => void;
}

// Scoped hover/focus styling for the prominent 'choice' chips. Inline styles
// can't express :hover, so we inject the rule once (mirrors the pattern used
// by ConceptHoverCard). Tokens only — adapts for dark mode.
const CHOICE_CHIP_CLASS = 'disambig-choice-chip';
const CHOICE_CHIP_CSS = `
.${CHOICE_CHIP_CLASS} {
  background: var(--brand-soft);
  border: 1px solid var(--brand);
  color: var(--brand-hover);
}
.${CHOICE_CHIP_CLASS}:hover,
.${CHOICE_CHIP_CLASS}:focus-visible {
  background: var(--brand);
  color: var(--text-on-brand);
  outline: none;
}
`;

export function DisambigChips({ prompt, slot, options, onPick }: Props) {
  if (options.length === 0) return null;

  const isChoice = slot === 'choice';

  return (
    <div data-testid="disambig-chips" data-slot={slot} style={{ marginTop: 10 }}>
      {isChoice && <style>{CHOICE_CHIP_CSS}</style>}
      <div
        style={{
          fontSize: 11,
          color: 'var(--shell-text-subtle)',
          marginBottom: 6,
          fontFamily: T.fSans,
        }}
      >
        {prompt}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {options.map((opt, idx) => (
          <button
            key={`${opt.label}-${idx}`}
            type="button"
            data-chip-label={opt.label}
            className={isChoice ? CHOICE_CHIP_CLASS : undefined}
            onClick={() => {
              postChatAudit({
                kind: 'disambig_chip_picked',
                detail: { slot, label: opt.label },
              });
              onPick(opt.pinText);
            }}
            style={
              isChoice
                ? {
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 13px',
                    borderRadius: 999,
                    cursor: 'pointer',
                    fontFamily: T.fSans,
                    fontSize: 12.5,
                    fontWeight: 600,
                    transition: 'background 0.12s ease, color 0.12s ease',
                  }
                : {
                    padding: '6px 12px',
                    borderRadius: 999,
                    border: `1px solid var(--shell-border-strong)`,
                    background: 'var(--surface-raised)',
                    color: 'var(--shell-text-emphasis)',
                    cursor: 'pointer',
                    fontFamily: T.fSans,
                    fontSize: 12.5,
                  }
            }
          >
            {isChoice && (
              <span aria-hidden style={{ fontSize: 11, opacity: 0.9 }}>
                ▸
              </span>
            )}
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
