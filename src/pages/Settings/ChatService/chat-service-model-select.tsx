/**
 * ChatServiceModelSelect — dropdown to pick a per-request model override.
 * "Server default" (empty option) means no X-Model header is sent.
 * Allowlist mirrors chat-service config.allowedModels.
 */

import React from 'react';
import styled from 'styled-components';

export const CHAT_MODELS = [
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
  'claude-opus-4-6',
  'claude-opus-4-7',
] as const;

interface ChatServiceModelSelectProps {
  value: string | null;
  onChange: (model: string | null) => void;
}

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const Label = styled.label`
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-primary);
`;

const Select = styled.select`
  height: 34px;
  padding: 0 10px;
  background: var(--bg-input, var(--bg-muted));
  border: 1px solid var(--border-card);
  border-radius: var(--radius-card);
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 13px;
  cursor: pointer;
  max-width: 320px;

  &:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 1px;
  }
`;

const Hint = styled.p`
  margin: 0;
  font-size: 11.5px;
  color: var(--text-muted);
  line-height: 1.45;
`;

export function ChatServiceModelSelect({ value, onChange }: ChatServiceModelSelectProps) {
  return (
    <Wrapper>
      <Label htmlFor="chat-model-select">Default model</Label>
      <Select
        id="chat-model-select"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">Server default</option>
        {CHAT_MODELS.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </Select>
      <Hint>
        Overrides the server default for every /turn request. Changes apply from the next
        message you send.
      </Hint>
    </Wrapper>
  );
}
