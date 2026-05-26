/**
 * Settings → Chat tab. Single control today: default disambiguation mode
 * (targeted vs aggressive). The chat panel chip uses this as its initial
 * value but may be overridden per-session; the engine confidence threshold
 * stays on the server.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { SectionCard, SectionHead, SectionTitle, SectionHint } from './section-card';
import { ChatModeRadioGroup } from './chat-mode-radio-group';
import { useChatDisambiguationMode, type ChatDisambiguationMode } from './use-chat-disambiguation-mode';
import { ChatRememberedDefaultsList } from './chat-remembered-defaults-list';
import { ChatMemorySection } from './chat-memory-section';

export function ChatPreferencesSection() {
  const { t } = useTranslation();
  const { mode, setMode } = useChatDisambiguationMode();

  const options: Array<{ value: ChatDisambiguationMode; title: string; description: string }> = [
    {
      value: 'targeted',
      title: t('settings.chat.mode.targeted.title', { defaultValue: 'Targeted ask' }),
      description: t('settings.chat.mode.targeted.desc', {
        defaultValue: 'Always ask one focused clarification when the query is ambiguous.',
      }),
    },
    {
      value: 'aggressive',
      title: t('settings.chat.mode.aggressive.title', { defaultValue: 'Aggressive auto-resolve' }),
      description: t('settings.chat.mode.aggressive.desc', {
        defaultValue: 'Auto-resolve confident interpretations; ask only on truly ambiguous queries.',
      }),
    },
  ];

  return (
    <>
      <SectionCard>
        <SectionHead>
          <div>
            <SectionTitle>{t('settings.chat.title', { defaultValue: 'Chat assistant' })}</SectionTitle>
            <SectionHint>
              {t('settings.chat.subtitle', {
                defaultValue:
                  'How the chat assistant handles ambiguous analytical questions before opening a Cube query.',
              })}
            </SectionHint>
          </div>
        </SectionHead>
        <ChatModeRadioGroup
          value={mode}
          onChange={setMode}
          options={options}
          groupLabel={t('settings.chat.modeGroup', { defaultValue: 'Disambiguation mode' })}
        />
      </SectionCard>

      <SectionCard style={{ marginTop: 16 }}>
        <SectionHead>
          <div>
            <SectionTitle>
              {t('settings.chat.rememberedDefaults.title', { defaultValue: 'Remembered defaults' })}
            </SectionTitle>
            <SectionHint>
              {t('settings.chat.rememberedDefaults.subtitle', {
                defaultValue:
                  'Slots the chat assistant has learned from your past sessions. Clear any to be asked again next time.',
              })}
            </SectionHint>
          </div>
        </SectionHead>
        <ChatRememberedDefaultsList />
      </SectionCard>

      <ChatMemorySection />
    </>
  );
}
