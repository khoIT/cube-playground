/**
 * Three-button segmented filter for the glossary index toolbar.
 * Drives the index page's optional `?status=` query — `null` means All.
 */

import React from 'react';
import styled from 'styled-components';
import type { GlossaryStatus } from '../../../api/glossary-client';

interface Props {
  value: GlossaryStatus | null;
  onChange: (next: GlossaryStatus | null) => void;
  labelAll: string;
  labelDraft: string;
  labelOfficial: string;
}

const Group = styled.div`
  display: inline-flex;
  border: 1px solid var(--border-card);
  border-radius: var(--radius-pill, 999px);
  background: var(--bg-app);
  overflow: hidden;
`;

const Pill = styled.button<{ $active: boolean }>`
  border: none;
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 500;
  padding: 4px 14px;
  background: ${(p) => (p.$active ? 'var(--brand-soft)' : 'transparent')};
  color: ${(p) => (p.$active ? 'var(--brand)' : 'var(--text-secondary)')};

  &:hover {
    background: ${(p) => (p.$active ? 'var(--brand-soft)' : 'var(--bg-subtle, rgba(0,0,0,0.04))')};
  }
`;

export function GlossaryStatusFilter({
  value,
  onChange,
  labelAll,
  labelDraft,
  labelOfficial,
}: Props) {
  return (
    <Group role="group" aria-label="Filter by status">
      <Pill type="button" $active={value === null} aria-pressed={value === null} onClick={() => onChange(null)}>
        {labelAll}
      </Pill>
      <Pill type="button" $active={value === 'draft'} aria-pressed={value === 'draft'} onClick={() => onChange('draft')}>
        {labelDraft}
      </Pill>
      <Pill type="button" $active={value === 'official'} aria-pressed={value === 'official'} onClick={() => onChange('official')}>
        {labelOfficial}
      </Pill>
    </Group>
  );
}
