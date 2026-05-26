/**
 * Settings → Chat "Session memory" section (Phase 03).
 *
 * Shows what the agent currently remembers for the active session and gives
 * the user a single button to clear both layers — session focus + SDK resume
 * id — atomically via DELETE /api/chat/sessions/:id/focus.
 *
 * Adjacent to ChatRememberedDefaultsList (cross-session prefs). The two
 * sections are deliberately separate so the "forget" semantics stay obvious:
 *   - per-row defaults → cross-session (this game, every chat)
 *   - "current session" block → just this chat, both layers
 */
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { Trash2 } from 'lucide-react';
import { useActiveChatSession } from '../../shell/chat-overlay/use-active-chat-session';
import { useSessionFocus } from '../Chat/hooks/use-session-focus';
import { SectionCard, SectionHead, SectionTitle, SectionHint } from './section-card';
import type { SessionFocusClient } from '../../api/chat-session-focus-client';

const ListWrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
`;

const Row = styled.div`
  display: grid;
  grid-template-columns: 140px 1fr;
  align-items: center;
  gap: 16px;
  padding: 10px 12px;
  background: var(--bg-muted);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-md);
  font-family: var(--font-sans);
  font-size: 13px;
`;

const SlotLabel = styled.span`
  color: var(--text-secondary);
  font-weight: 500;
`;

const ValueLabel = styled.span`
  color: var(--text-primary);
`;

const Phrase = styled.span`
  color: var(--text-muted);
  margin-left: 6px;
  font-size: 12px;
`;

const ForgetAllButton = styled.button`
  align-self: flex-start;
  margin-top: 14px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 14px;
  background: var(--destructive-soft);
  border: 1px solid transparent;
  border-radius: var(--radius-pill);
  color: var(--destructive-ink);
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;

  &:hover { border-color: var(--destructive-ink); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

const Empty = styled.p`
  margin: 0;
  padding: 14px 0;
  color: var(--text-muted);
  font-family: var(--font-sans);
  font-size: 13px;
  text-align: center;
`;

const ResumeChip = styled.span`
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 10px;
  margin-top: 8px;
  border-radius: var(--radius-pill);
  background: var(--info-soft);
  color: var(--info-ink);
  font-size: 11px;
  font-weight: 600;
`;

interface SlotProjection {
  key: string;
  label: string;
  value: string;
  phrase?: string;
}

function flatten(focus: SessionFocusClient | null): SlotProjection[] {
  if (!focus) return [];
  const rows: SlotProjection[] = [];
  if (focus.skill?.value) rows.push({ key: 'skill', label: 'Skill', value: focus.skill.value });
  if (focus.intent?.value) rows.push({ key: 'intent', label: 'Intent', value: focus.intent.value });
  if (focus.concept?.value) rows.push({ key: 'concept', label: 'Concept', value: focus.concept.value, phrase: focus.concept.phrase });
  if (focus.metric?.value) rows.push({ key: 'metric', label: 'Metric', value: focus.metric.value, phrase: focus.metric.phrase });
  if (focus.dimension?.value) rows.push({ key: 'dimension', label: 'Dimension', value: focus.dimension.value, phrase: focus.dimension.phrase });
  if (focus.timeRange?.value) {
    const r = focus.timeRange.value.dateRange;
    const range = typeof r === 'string' ? r : `${r[0]}..${r[1]}`;
    rows.push({ key: 'timeRange', label: 'Time range', value: focus.timeRange.phrase ?? range, phrase: focus.timeRange.phrase ? range : undefined });
  }
  if (focus.segment?.value) rows.push({ key: 'segment', label: 'Segment', value: focus.segment.value });
  if (focus.entity?.value) rows.push({ key: 'entity', label: 'Entity', value: `${focus.entity.value.cube}.${focus.entity.value.pk}` });
  if (focus.artifactRef?.value) rows.push({ key: 'artifactRef', label: 'Last artifact', value: focus.artifactRef.value });
  if (focus.filters) {
    for (const [member, slot] of Object.entries(focus.filters)) {
      rows.push({ key: `filter:${member}`, label: `Filter (${member})`, value: slot.value });
    }
  }
  return rows;
}

export function ChatMemorySection() {
  const { t } = useTranslation();
  const [activeSessionId] = useActiveChatSession();
  const { focus, loading, hasSdkResume, forget } = useSessionFocus(activeSessionId);
  const rows = flatten(focus);

  const handleForget = () => {
    const ok = window.confirm(
      t('settings.chat.sessionMemory.forgetAllConfirm', {
        defaultValue: 'Clear everything the assistant remembers for this chat?',
      }),
    );
    if (!ok) return;
    void forget();
  };

  return (
    <SectionCard style={{ marginTop: 16 }}>
      <SectionHead>
        <div>
          <SectionTitle>
            {t('settings.chat.sessionMemory.title', { defaultValue: 'Current session memory' })}
          </SectionTitle>
          <SectionHint>
            {t('settings.chat.sessionMemory.subtitle', {
              defaultValue: 'Slots the assistant is carrying across turns in the active chat. Clear to start fresh without losing your message history.',
            })}
          </SectionHint>
        </div>
      </SectionHead>

      {!activeSessionId ? (
        <Empty data-testid="chat-memory-no-session">
          {t('settings.chat.sessionMemory.noSession', {
            defaultValue: 'Open a chat to inspect its session memory here.',
          })}
        </Empty>
      ) : loading ? (
        <Empty>{t('common.loading', { defaultValue: 'Loading…' })}</Empty>
      ) : rows.length === 0 && !hasSdkResume ? (
        <Empty data-testid="chat-memory-empty">
          {t('settings.chat.sessionMemory.empty', {
            defaultValue: 'Nothing remembered yet in this chat.',
          })}
        </Empty>
      ) : (
        <>
          <ListWrap>
            {rows.map((r) => (
              <Row key={r.key} data-testid="chat-memory-row">
                <SlotLabel>{r.label}</SlotLabel>
                <span>
                  <ValueLabel>{r.value}</ValueLabel>
                  {r.phrase ? <Phrase>from "{r.phrase}"</Phrase> : null}
                </span>
              </Row>
            ))}
          </ListWrap>
          {hasSdkResume ? (
            <ResumeChip data-testid="chat-memory-resume-chip">
              {t('settings.chat.sessionMemory.resumeActive', {
                defaultValue: 'SDK thread resume active',
              })}
            </ResumeChip>
          ) : null}
          <ForgetAllButton
            type="button"
            onClick={handleForget}
            data-testid="chat-memory-forget-all"
          >
            <Trash2 size={13} strokeWidth={2} />
            {t('settings.chat.sessionMemory.forgetAll', { defaultValue: 'Forget everything in this chat' })}
          </ForgetAllButton>
        </>
      )}
    </SectionCard>
  );
}
