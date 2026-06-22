/**
 * Refine row under a query artifact card: context-aware chips + a free-text
 * refinement input. A click or submit sends a natural-language follow-up turn
 * via the same path the follow-up chips use; the agent re-runs with the prior
 * query as merge context and re-emits a refined artifact. No new endpoint.
 *
 * Collapsed by default: the card footer shows a single quiet "Refine" toggle so
 * the chrome doesn't compete with the chart. Expanding reveals the chips +
 * free-text input. Keeping the row folded lets two cards tile side-by-side
 * cleanly without their footers crowding the data.
 */

import { ReactElement, useState } from 'react';
import { SlidersHorizontal, ChevronUp } from 'lucide-react';
import { T, Icon } from '../../../shell/theme';
import { generateRefineChips } from '../services/generate-refine-chips';
import styles from './query-refine-row.module.css';

interface Props {
  /** The artifact's CubeQuery — drives which chips are offered. */
  query: unknown;
  /** Send a refinement as a follow-up turn (reuses the followup send path). */
  onRefine: (text: string) => void;
}

const chipStyle: React.CSSProperties = {
  padding: '5px 11px',
  borderRadius: 999,
  border: '1px solid var(--shell-border-strong)',
  background: 'var(--surface-raised)',
  color: 'var(--shell-text-emphasis)',
  cursor: 'pointer',
  fontFamily: T.fSans,
  fontSize: 12.5,
};

// Quiet, pill-shaped toggle mirroring the reasoning disclosure on the assistant
// header — a subtle affordance, not a call-to-action.
const toggleStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 11px',
  background: 'none',
  border: '1px solid var(--shell-border)',
  borderRadius: 'var(--radius-pill)',
  cursor: 'pointer',
  color: 'var(--shell-text-subtle)',
  fontFamily: T.fSans,
  fontSize: 12,
  fontWeight: 500,
  letterSpacing: '0.02em',
};

export function QueryRefineRow({ query, onRefine }: Props): ReactElement | null {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState('');
  const chips = generateRefineChips(query);

  function submitFreeText(): void {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onRefine(trimmed);
    setDraft('');
  }

  // Collapsed: just the toggle. One row of quiet chrome under the chart.
  if (!expanded) {
    return (
      <button type="button" onClick={() => setExpanded(true)} aria-expanded={false} style={toggleStyle}>
        <Icon icon={SlidersHorizontal} size={13} color={'var(--shell-text-subtle)'} />
        Refine query
      </button>
    );
  }

  return (
    <div className={styles.row}>
      <button
        type="button"
        onClick={() => setExpanded(false)}
        aria-expanded={true}
        aria-label="Hide refine options"
        style={{
          ...toggleStyle,
          alignSelf: 'flex-start',
          textTransform: 'uppercase',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.05em',
        }}
      >
        Refine
        <Icon icon={ChevronUp} size={13} color={'var(--shell-text-subtle)'} />
      </button>
      {chips.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {chips.map((chip) => (
            // Both labels are rendered; a container query on .row shows the full
            // label when the column is wide and the short one when it is narrow.
            // The full text is always the tooltip and the text sent on click.
            <button key={chip.id} type="button" data-chip-id={chip.id} title={chip.text} style={chipStyle} onClick={() => onRefine(chip.text)}>
              <span className={styles.labelFull}>{chip.text}</span>
              <span className={styles.labelShort}>{chip.shortText}</span>
            </button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={draft}
          placeholder="Refine this query — e.g. break down by country"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitFreeText();
          }}
          style={{
            flex: 1,
            minWidth: 0,
            padding: '6px 12px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--shell-border)',
            background: 'var(--bg-card)',
            color: 'var(--shell-text)',
            fontFamily: T.fSans,
            fontSize: 13,
          }}
        />
        <button
          type="button"
          onClick={submitFreeText}
          disabled={!draft.trim()}
          style={{
            padding: '0 14px',
            borderRadius: 'var(--radius-md)',
            border: 'none',
            background: draft.trim() ? 'var(--shell-brand)' : 'var(--bg-muted)',
            color: draft.trim() ? 'var(--text-on-brand)' : 'var(--shell-text-subtle)',
            cursor: draft.trim() ? 'pointer' : 'default',
            fontFamily: T.fSans,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Refine
        </button>
      </div>
    </div>
  );
}
