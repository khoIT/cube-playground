/**
 * Two-button segmented pill toggling a glossary term between Draft and Official.
 * The parent owns the term's status state and decides whether to call the API
 * here (edit mode) or defer until a higher-level Save action (create mode).
 */

import React from 'react';
import styled from 'styled-components';
import type { GlossaryStatus } from '../../../api/glossary-client';

interface Props {
  status: GlossaryStatus;
  onChange: (next: GlossaryStatus) => void;
  disabled?: boolean;
  labelDraft: string;
  labelOfficial: string;
}

const Group = styled.div<{ $disabled?: boolean }>`
  display: inline-flex;
  border: 1px solid var(--border-card);
  border-radius: var(--radius-pill, 999px);
  background: var(--bg-app);
  overflow: hidden;
  opacity: ${(p) => (p.$disabled ? 0.6 : 1)};
  pointer-events: ${(p) => (p.$disabled ? 'none' : 'auto')};
`;

const Pill = styled.button<{ $active: boolean; $variant: 'draft' | 'official' }>`
  border: none;
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 500;
  padding: 4px 12px;
  background: ${(p) =>
    p.$active
      ? p.$variant === 'official'
        ? 'var(--brand)'
        : 'var(--bg-muted)'
      : 'transparent'};
  color: ${(p) =>
    p.$active
      ? p.$variant === 'official'
        ? 'var(--brand-on, white)'
        : 'var(--text-primary)'
      : 'var(--text-secondary)'};

  &:hover {
    background: ${(p) =>
      p.$active
        ? p.$variant === 'official'
          ? 'var(--brand)'
          : 'var(--bg-muted)'
        : 'var(--bg-subtle, rgba(0,0,0,0.04))'};
  }
`;

export function GlossaryStatusToggle({
  status,
  onChange,
  disabled,
  labelDraft,
  labelOfficial,
}: Props) {
  return (
    <Group role="group" aria-label="Status" $disabled={disabled}>
      <Pill
        type="button"
        $active={status === 'draft'}
        $variant="draft"
        aria-pressed={status === 'draft'}
        onClick={() => status !== 'draft' && onChange('draft')}
      >
        {labelDraft}
      </Pill>
      <Pill
        type="button"
        $active={status === 'official'}
        $variant="official"
        aria-pressed={status === 'official'}
        onClick={() => status !== 'official' && onChange('official')}
      >
        {labelOfficial}
      </Pill>
    </Group>
  );
}
