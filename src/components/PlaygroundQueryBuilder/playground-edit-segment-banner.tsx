/**
 * Persistent banner shown at the top of the playground when the user arrived
 * via a segment "Open in Playground" definition deeplink.
 *
 * Communicates:
 *   - Which segment is being refined (name).
 *   - That measures / order / limit are NOT part of the segment definition.
 *   - How to exit edit mode (✕ button drops context; save bar reverts to
 *     create-new behaviour).
 *   - A game-mismatch warning when the active game differs from the segment's
 *     game — in that state Update is disabled regardless.
 */

import { ReactElement } from 'react';

interface Props {
  segmentName: string;
  /** True when the active workspace game differs from the segment's game ID.
   *  Update is blocked — warn the user so they know why. */
  gameMismatch: boolean;
  /** Called when the user clicks ✕ or the mismatch "dismiss" link. */
  onExit: () => void;
}

export function PlaygroundEditSegmentBanner({ segmentName, gameMismatch, onExit }: Props): ReactElement {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '7px 14px',
        background: gameMismatch ? 'var(--warning-soft)' : 'var(--info-soft)',
        borderBottom: '1px solid var(--border-card)',
        fontFamily: 'var(--font-sans)',
        fontSize: 12,
        color: gameMismatch ? 'var(--warning-ink)' : 'var(--info-soft, var(--text-secondary))',
        flexShrink: 0,
      }}
    >
      {/* Mode label */}
      <span
        style={{
          fontWeight: 600,
          fontSize: 11,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          marginRight: 2,
        }}
      >
        Refining
      </span>

      {/* Segment name */}
      <span
        style={{
          fontWeight: 600,
          color: 'var(--text-primary)',
          maxWidth: 240,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={segmentName}
      >
        {segmentName}
      </span>

      {/* Informational copy */}
      {gameMismatch ? (
        <span style={{ color: 'var(--warning-ink)', flex: 1 }}>
          — wrong game workspace — switch games before saving, or{' '}
          <button
            onClick={onExit}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              color: 'var(--warning-ink)',
              fontWeight: 600,
              fontSize: 'inherit',
              textDecoration: 'underline',
            }}
          >
            dismiss
          </button>
        </span>
      ) : (
        <span style={{ color: 'var(--text-secondary)', flex: 1 }}>
          — changes apply on Update · measures, order, and limit are not saved with the segment
        </span>
      )}

      {/* Exit button */}
      <button
        aria-label="Exit edit mode"
        title="Exit segment editing — returns save bar to create mode"
        onClick={onExit}
        style={{
          background: 'none',
          border: 'none',
          padding: '2px 4px',
          cursor: 'pointer',
          color: 'var(--text-muted)',
          fontSize: 14,
          lineHeight: 1,
          borderRadius: 'var(--radius-xs)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        ✕
      </button>
    </div>
  );
}
