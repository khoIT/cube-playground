/**
 * CsOwnerChip — compact assignee badge for care cases.
 *
 * Visual contract:
 *   - "owned by <name>" when a case has an assignee.
 *   - Brand tint  (--brand-soft / --brand-hover) when the assignee is the
 *     current user ("own" case) — draws the eye to cases the agent claimed.
 *   - Muted tint  (--muted-soft / --muted-ink) when assigned to someone else —
 *     legible as context without competing for attention.
 *   - Nothing rendered when assignee is null (unowned case).
 *
 * Tokens only; no raw hex.
 */

import type { CSSProperties } from 'react';

interface CsOwnerChipProps {
  /** Assignee username/email from the case record; null/undefined = unowned. */
  assignee: string | null | undefined;
  /** The current user's identity string (username ?? email). */
  me: string | null | undefined;
  /** Additional style overrides for layout (e.g. marginLeft). */
  style?: CSSProperties;
}

export function CsOwnerChip({ assignee, me, style }: CsOwnerChipProps) {
  if (!assignee) return null;

  const isOwn = !!me && assignee === me;

  const chipStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 10.5,
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: 'var(--radius-full)',
    whiteSpace: 'nowrap',
    fontFamily: 'var(--font-sans)',
    // Brand tint for own cases; muted for others — token pairs adapt in dark mode.
    background: isOwn ? 'var(--brand-soft)' : 'var(--muted-soft)',
    color: isOwn ? 'var(--brand-hover)' : 'var(--muted-ink)',
    ...style,
  };

  return (
    <span style={chipStyle} title={`Assigned to ${assignee}`}>
      {isOwn ? 'You' : assignee}
    </span>
  );
}
