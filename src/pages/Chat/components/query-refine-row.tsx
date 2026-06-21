/**
 * Refine row under a query artifact card: context-aware chips + a free-text
 * refinement input. A click or submit sends a natural-language follow-up turn
 * via the same path the follow-up chips use; the agent re-runs with the prior
 * query as merge context and re-emits a refined artifact. No new endpoint.
 */

import { ReactElement, useState } from 'react';
import { T } from '../../../shell/theme';
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

export function QueryRefineRow({ query, onRefine }: Props): ReactElement | null {
  const [draft, setDraft] = useState('');
  const chips = generateRefineChips(query);

  function submitFreeText(): void {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onRefine(trimmed);
    setDraft('');
  }

  return (
    <div className={styles.row}>
      <span style={{ fontFamily: T.fSans, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--shell-text-subtle)' }}>
        Refine
      </span>
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
