/**
 * Shared NL-override input present in all three triage views. v1 has no
 * backend NL endpoint, so this is a controlled, visually-present input whose
 * submit is disabled with a "coming soon" tooltip — we render it honest rather
 * than faking an agent response. When a real endpoint ships, wire onAsk.
 */
import { ReactElement, useState } from 'react';
import styled from 'styled-components';

const Wrap = styled.form`
  display: flex;
  gap: 10px;
  align-items: center;
`;
const Input = styled.input`
  flex: 1;
  height: 38px;
  padding: 0 12px;
  border: 1px solid var(--border-card);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 13px;
  &:focus {
    outline: none;
    border-color: var(--brand);
  }
`;
const Btn = styled.button`
  background: var(--brand);
  color: var(--text-on-brand);
  border: none;
  border-radius: var(--radius-sm);
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 600;
  padding: 9px 18px;
  cursor: pointer;
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

interface Props {
  placeholder?: string;
  submitLabel?: string;
  /** When provided, the box becomes live; otherwise submit is disabled. */
  onAsk?: (text: string) => void;
}

export function AskAgentBox({ placeholder, submitLabel = 'Ask', onAsk }: Props): ReactElement {
  const [text, setText] = useState('');
  const enabled = Boolean(onAsk);

  return (
    <Wrap
      onSubmit={(e) => {
        e.preventDefault();
        if (!enabled || !text.trim()) return;
        onAsk?.(text.trim());
        setText('');
      }}
    >
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder ?? 'Tell the agent…  e.g. “ignore the test_ tables” or “user_id is the join key”'}
        aria-label="Ask the agent"
      />
      <Btn type="submit" disabled={!enabled || !text.trim()} title={enabled ? undefined : 'Natural-language overrides are coming soon'}>
        {submitLabel}
      </Btn>
    </Wrap>
  );
}
