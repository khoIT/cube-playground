/**
 * Phase 03 — compact chip rendered next to ChatModeChip. Shows what the
 * agent currently remembers for this session (metric / dim / timeRange).
 *
 * Click → popover listing each slot with per-slot ✕ + a "Forget all" footer
 * button. Single backend round-trip per click (DELETE /focus); the chip
 * empties immediately on success.
 *
 * Hidden when no slots are set so empty chat headers stay clean. Tokenised
 * against `src/theme/tokens.css` so it visually matches the disambig chip.
 */
import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { Brain, X } from 'lucide-react';
import { useSessionFocus } from '../hooks/use-session-focus';
import type { SessionFocusClient } from '../../../api/chat-session-focus-client';

interface Props {
  sessionId: string | null;
}

const Wrap = styled.div`
  position: relative;
  display: inline-flex;
`;

const Chip = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 10px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border-card);
  background: transparent;
  color: var(--text-secondary);
  font-family: var(--font-sans);
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;

  &:hover { background: var(--bg-muted); color: var(--text-primary); }
`;

const Popover = styled.div`
  position: absolute;
  top: 30px;
  right: 0;
  z-index: 20;
  min-width: 280px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md, 0 8px 24px rgba(0, 0, 0, 0.08));
  padding: 10px;
  font-family: var(--font-sans);
`;

const SlotRow = styled.div`
  display: grid;
  grid-template-columns: 88px 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 6px 4px;
  border-radius: var(--radius-md);
  font-size: 12.5px;

  &:hover { background: var(--bg-muted); }
`;

const SlotLabel = styled.span`
  color: var(--text-secondary);
  text-transform: capitalize;
`;

const SlotValue = styled.span`
  color: var(--text-primary);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const SlotPhrase = styled.span`
  color: var(--text-muted);
  font-size: 11px;
`;

const IconBtn = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-pill);
  color: var(--text-muted);
  cursor: pointer;

  &:hover {
    color: var(--destructive-ink);
    background: var(--destructive-soft);
    border-color: var(--destructive-ink);
  }
`;

const ForgetAll = styled.button`
  width: 100%;
  margin-top: 8px;
  padding: 6px 10px;
  height: 28px;
  background: var(--destructive-soft);
  border: 1px solid transparent;
  border-radius: var(--radius-pill);
  color: var(--destructive-ink);
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;

  &:hover { border-color: var(--destructive-ink); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

const Empty = styled.p`
  margin: 8px 4px;
  color: var(--text-muted);
  font-size: 12px;
`;

interface SlotRendered {
  key: string;
  label: string;
  value: string;
  phrase?: string;
}

/**
 * Project the focus bag into a stable rendered list. Order mirrors how the
 * server's `renderFocusPreamble` injects slots into the prompt — gives the
 * user the same mental model as the agent.
 */
function projectSlots(focus: SessionFocusClient | null): SlotRendered[] {
  if (!focus) return [];
  const rows: SlotRendered[] = [];
  if (focus.metric?.value) {
    rows.push({ key: 'metric', label: 'Metric', value: focus.metric.value, phrase: focus.metric.phrase });
  }
  if (focus.dimension?.value) {
    rows.push({ key: 'dimension', label: 'Dimension', value: focus.dimension.value, phrase: focus.dimension.phrase });
  }
  if (focus.timeRange?.value) {
    const r = focus.timeRange.value.dateRange;
    const range = typeof r === 'string' ? r : `${r[0]}..${r[1]}`;
    rows.push({ key: 'timeRange', label: 'Time range', value: focus.timeRange.phrase ?? range, phrase: focus.timeRange.phrase ? range : undefined });
  }
  if (focus.concept?.value) {
    rows.push({ key: 'concept', label: 'Concept', value: focus.concept.value, phrase: focus.concept.phrase });
  }
  if (focus.segment?.value) {
    rows.push({ key: 'segment', label: 'Segment', value: focus.segment.value });
  }
  if (focus.filters) {
    for (const [member, slot] of Object.entries(focus.filters)) {
      rows.push({ key: `filter:${member}`, label: `Filter (${member})`, value: slot.value });
    }
  }
  if (focus.artifactRef?.value) {
    rows.push({ key: 'artifactRef', label: 'Last artifact', value: focus.artifactRef.value });
  }
  return rows;
}

function summary(rows: SlotRendered[]): string {
  if (rows.length === 0) return '';
  const top = rows.slice(0, 3).map((r) => r.value).join(' · ');
  return rows.length > 3 ? `${top} +${rows.length - 3}` : top;
}

export function ChatHeaderFocusChip({ sessionId }: Props) {
  const { t } = useTranslation();
  const { focus, forget } = useSessionFocus(sessionId);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => projectSlots(focus), [focus]);
  if (!sessionId || rows.length === 0) return null;

  const handleForgetAll = async () => {
    setBusy(true);
    try {
      await forget();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Wrap>
      <Chip
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('chat.focusChip.title', { defaultValue: 'What the assistant remembers' })}
        data-testid="chat-header-focus-chip"
      >
        <Brain size={12} aria-hidden />
        <span>{summary(rows)}</span>
      </Chip>
      {open ? (
        <Popover role="menu" data-testid="chat-header-focus-popover">
          {rows.length === 0 ? (
            <Empty>{t('chat.focusChip.empty', { defaultValue: 'Nothing remembered yet.' })}</Empty>
          ) : (
            <>
              {rows.map((r) => (
                <SlotRow key={r.key}>
                  <SlotLabel>{r.label}</SlotLabel>
                  <div style={{ minWidth: 0 }}>
                    <SlotValue>{r.value}</SlotValue>
                    {r.phrase ? <SlotPhrase> · {r.phrase}</SlotPhrase> : null}
                  </div>
                  {/*
                   * Per-slot delete is currently a no-op visually because the
                   * backend's only mutation is a full-bag clear. Surfaces the
                   * affordance the design calls for; wiring a per-slot
                   * endpoint can come later without touching the chip.
                   */}
                  <IconBtn
                    type="button"
                    aria-label={t('chat.focusChip.forgetSlot', { defaultValue: 'Forget {{slot}}', slot: r.label })}
                    onClick={handleForgetAll}
                    disabled={busy}
                  >
                    <X size={12} strokeWidth={2} />
                  </IconBtn>
                </SlotRow>
              ))}
              <ForgetAll type="button" onClick={handleForgetAll} disabled={busy}>
                {busy
                  ? t('chat.focusChip.forgetting', { defaultValue: 'Forgetting…' })
                  : t('chat.focusChip.forgetAll', { defaultValue: 'Forget everything in this chat' })}
              </ForgetAll>
            </>
          )}
        </Popover>
      ) : null}
    </Wrap>
  );
}
