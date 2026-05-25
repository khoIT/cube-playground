/**
 * ChatServiceTab — settings panel for chat-service runtime controls.
 *
 * Controls (in order):
 *   1. Default model selector
 *   2. Bypass response cache toggle
 *   3. Clear cache for current game button
 *   4. Show debug links toggle
 *   5. Raw SDK events default-expanded toggle
 *
 * All state persisted to localStorage via useChatServiceSettings (debounced 250ms).
 */

import React from 'react';
import styled from 'styled-components';
import { useActiveGameId } from '../../../components/Header/use-game-context';
import { SectionCard, SectionHead, SectionTitle, SectionHint } from '../section-card';
import { useChatServiceSettings } from './use-chat-service-settings';
import { ChatServiceModelSelect } from './chat-service-model-select';
import { ChatServiceCacheControls } from './chat-service-cache-controls';

// ---------------------------------------------------------------------------
// Styled primitives (matching existing settings tab visual style)
// ---------------------------------------------------------------------------

const Stack = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0;
`;

const Divider = styled.hr`
  margin: 20px 0;
  border: none;
  border-top: 1px solid var(--border-card);
`;

const ToggleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border-card);

  &:last-child {
    border-bottom: none;
    padding-bottom: 0;
  }
`;

const ToggleLabel = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const ToggleTitle = styled.span`
  font-size: 13.5px;
  font-weight: 500;
  color: var(--text-primary);
`;

const ToggleHint = styled.span`
  font-size: 11.5px;
  color: var(--text-muted);
  line-height: 1.4;
`;

const Toggle = styled.button<{ $on: boolean }>`
  flex-shrink: 0;
  width: 40px;
  height: 22px;
  border-radius: 11px;
  border: none;
  background: ${(p) => (p.$on ? 'var(--brand)' : 'var(--border-strong)')};
  cursor: pointer;
  position: relative;
  transition: background-color 150ms ease;

  &::after {
    content: '';
    position: absolute;
    top: 3px;
    left: ${(p) => (p.$on ? '21px' : '3px')};
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: white;
    transition: left 150ms ease;
  }

  &:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
  }
`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ChatServiceTab() {
  const [settings, patch] = useChatServiceSettings();
  const gameId = useActiveGameId();

  return (
    <SectionCard>
      <SectionHead>
        <div>
          <SectionTitle>Chat Service</SectionTitle>
          <SectionHint>
            Runtime controls for the chat assistant. Changes apply immediately from the next
            message sent — no page reload required.
          </SectionHint>
        </div>
      </SectionHead>

      <Stack>
        {/* 1. Default model */}
        <ChatServiceModelSelect
          value={settings.defaultModel}
          onChange={(model) => patch({ defaultModel: model })}
        />

        <Divider />

        {/* 2 + 3. Cache controls (bypass toggle + clear button) */}
        <ChatServiceCacheControls
          bypassCache={settings.bypassCache}
          onBypassChange={(val) => patch({ bypassCache: val })}
          gameId={gameId ?? null}
        />

        {/* 4. Show debug links */}
        <ToggleRow>
          <ToggleLabel>
            <ToggleTitle>Show debug links on chat page</ToggleTitle>
            <ToggleHint>
              Displays a "Debug" link next to each chat session that opens the
              turn-level audit view at /dev/chat-audit/:sessionId.
            </ToggleHint>
          </ToggleLabel>
          <Toggle
            $on={settings.showDebugLinks}
            type="button"
            role="switch"
            aria-checked={settings.showDebugLinks}
            aria-label="Show debug links on chat page"
            onClick={() => patch({ showDebugLinks: !settings.showDebugLinks })}
          />
        </ToggleRow>

        {/* 5. Raw events default-expanded */}
        <ToggleRow>
          <ToggleLabel>
            <ToggleTitle>Raw SDK events expanded by default</ToggleTitle>
            <ToggleHint>
              Opens the raw SDK events accordion automatically when viewing a turn in the
              chat-audit page — saves a click during debugging.
            </ToggleHint>
          </ToggleLabel>
          <Toggle
            $on={settings.rawEventsDefaultExpanded}
            type="button"
            role="switch"
            aria-checked={settings.rawEventsDefaultExpanded}
            aria-label="Raw SDK events expanded by default"
            onClick={() => patch({ rawEventsDefaultExpanded: !settings.rawEventsDefaultExpanded })}
          />
        </ToggleRow>
      </Stack>
    </SectionCard>
  );
}
