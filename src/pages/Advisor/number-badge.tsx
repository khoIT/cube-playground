/**
 * NumberBadge — the user-facing half of the HYBRID provenance gate.
 *
 * A number the agent spoke but did not source from a tool is "exploratory"; a
 * number a tool produced (provenanced) is "validated". The hand-off button is
 * gated on having no exploratory numbers left in the required fields.
 */
import React from 'react';
import { Pill } from './advisor-primitives';

export function NumberBadge({
  variant,
  onClick,
}: {
  variant: 'exploratory' | 'validated';
  onClick?: () => void;
}) {
  if (variant === 'validated') {
    return (
      <Pill bg="var(--success-soft)" ink="var(--success-ink)" title="Verified from a tool result" onClick={onClick}>
        ✓ validated
      </Pill>
    );
  }
  return (
    <Pill bg="var(--warning-soft)" ink="var(--warning-ink)" title="The agent's estimate — not yet sourced from a tool">
      ~ exploratory
    </Pill>
  );
}
