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
import { Play, Check } from 'lucide-react';
import { T } from '../../../shell/theme';
import { postChatAudit } from '../../../api/chat-audit-client';
import type { DisambigOption } from '../../../api/chat-sse-client';

interface Props {
  prompt: string;
  slot: 'metric' | 'dimension' | 'timeRange' | 'choice';
  options: ReadonlyArray<DisambigOption>;
  /**
   * pinText of the option the user already picked (matched from the following
   * user turn when a session reloads). The matching chip renders in the
   * selected (filled) state but stays clickable so the user can re-pick a
   * different option — same affordance as the live turn.
   */
  selectedPinText?: string | null;
  onPick: (pinText: string) => void;
}

// Scoped hover/focus styling for the prominent 'choice' chips. Inline styles
// can't express :hover, so we inject the rule once (mirrors the pattern used
// by ConceptHoverCard). Tokens only — adapts for dark mode.
const CHOICE_CHIP_CLASS = 'disambig-choice-chip';
const CHOICE_ARROW_CLASS = 'disambig-choice-arrow';
const CHOICE_CHIP_CSS = `
.${CHOICE_CHIP_CLASS} {
  background: var(--shell-brand-soft);
  border: 1px solid var(--shell-brand-border);
  color: var(--shell-brand-hover);
  box-shadow: 0 1px 2px rgba(var(--brand-rgb), 0.06);
}
/* Hover/focus lifts the chip with a soft brand glow and fills it solid — reads
   as the primary next-step affordance of the turn. */
.${CHOICE_CHIP_CLASS}:hover,
.${CHOICE_CHIP_CLASS}:focus-visible {
  background: var(--brand);
  border-color: var(--brand);
  color: var(--text-on-brand);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(var(--brand-rgb), 0.28);
  outline: none;
}
.${CHOICE_CHIP_CLASS}:active { transform: translateY(0); }
.${CHOICE_ARROW_CLASS} { transition: transform .13s ease, color .13s ease; }
.${CHOICE_CHIP_CLASS}:hover .${CHOICE_ARROW_CLASS},
.${CHOICE_CHIP_CLASS}:focus-visible .${CHOICE_ARROW_CLASS} {
  color: var(--text-on-brand);
  transform: translateX(2px);
}
/* Already-picked choice chip: rests in the filled (solid brand) state so the
   prior selection reads at a glance, while remaining clickable to re-pick. */
.${CHOICE_CHIP_CLASS}--selected {
  background: var(--brand);
  border-color: var(--brand);
  color: var(--text-on-brand);
}
.${CHOICE_CHIP_CLASS}--selected .${CHOICE_ARROW_CLASS} { color: var(--text-on-brand); }
`;

export function DisambigChips({ prompt, slot, options, selectedPinText, onPick }: Props) {
  if (options.length === 0) return null;

  const isChoice = slot === 'choice';

  return (
    <div
      data-testid="disambig-chips"
      data-slot={slot}
      style={
        // Choice (agent-authored next steps) reads as a distinct "suggested
        // next step" register: a top divider separates the CTAs from the prose
        // above. Engine slots stay a quiet inline clarification.
        isChoice
          ? { marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--shell-border)' }
          : { marginTop: 10 }
      }
    >
      {isChoice && <style>{CHOICE_CHIP_CSS}</style>}
      <div
        style={{
          fontSize: 11,
          color: 'var(--shell-text-subtle)',
          marginBottom: isChoice ? 10 : 6,
          fontFamily: T.fSans,
        }}
      >
        {prompt}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: isChoice ? 10 : 8 }}>
        {options.map((opt, idx) => {
          const isSelected = !!selectedPinText && opt.pinText === selectedPinText;
          const choiceClass = isChoice
            ? `${CHOICE_CHIP_CLASS}${isSelected ? ` ${CHOICE_CHIP_CLASS}--selected` : ''}`
            : undefined;
          // Neutral (engine-slot) selected chip: brand-tinted to echo the
          // choice-chip selection without the solid fill the choice slot uses.
          const neutralSelectedStyle = isSelected
            ? {
              border: '1px solid var(--brand)',
              background: 'var(--brand-soft)',
              color: 'var(--brand-hover)',
            }
            : {};
          return (
            <button
              key={`${opt.label}-${idx}`}
              type="button"
              data-chip-label={opt.label}
              aria-pressed={isSelected}
              className={choiceClass}
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
                    gap: 7,
                    // Fixed height (matches the artifact's "Open in Playground"
                    // CTA) with horizontal-only padding so all action buttons
                    // share one height; vertical centering does the rest.
                    height: 34,
                    padding: '0 16px 0 13px',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    fontFamily: T.fSans,
                    fontSize: 13.5,
                    fontWeight: 600,
                    transition:
                      'background .13s ease, color .13s ease, transform .13s ease, box-shadow .13s ease, border-color .13s ease',
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
                    ...neutralSelectedStyle,
                  }
              }
            >
              {isChoice && (
                // SVG icon (not a unicode glyph): centers cleanly via flex with
                // no font baseline offset, and inherits the chip's text color via
                // currentColor — so on the solid-brand hover/selected fill it
                // turns white instead of vanishing into the background. No inline
                // color: that would override the hover/selected color cascade.
                <span
                  aria-hidden
                  className={CHOICE_ARROW_CLASS}
                  style={{ display: 'inline-flex', alignItems: 'center', lineHeight: 0 }}
                >
                  {isSelected ? (
                    <Check size={14} strokeWidth={2.5} />
                  ) : (
                    <Play size={10} fill="currentColor" fillOpacity={0.8} stroke="currentColor" strokeWidth={1} />
                  )}
                </span>
              )}
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
