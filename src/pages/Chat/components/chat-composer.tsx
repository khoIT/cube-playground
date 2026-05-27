/**
 * ChatComposer — auto-sizing chat input shared by the full-page thread, the
 * side panel, and the chat home hero.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────┐
 *   │ <textarea>                                       │
 *   │ [Web Search ⃝] [DeepThink ⃝] [Bypass cache] <> [↑] │
 *   └──────────────────────────────────────────────────┘
 *
 * Keyboard:
 *   Enter             → submit (unless Shift held)
 *   Shift+Enter       → newline
 *   Cmd/Ctrl+Enter    → submit
 *   Esc               → blur
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { T, Icon } from '../../../shell/theme';
import { ComposerToolToggle } from './composer-tool-toggle';

interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  /** Tighter sizing for the side panel. */
  compact?: boolean;
  placeholder?: string;
  /** Web search toggle: when ON sends X-Web-Search: 1 per turn. */
  webSearch?: boolean;
  onToggleWebSearch?: () => void;
  /**
   * Research mode toggle: when ON sends X-Research-Mode: 1 per turn,
   * enabling extended timeout (subject to env master flags on chat-service).
   */
  deepResearch?: boolean;
  onToggleDeepResearch?: () => void;
  /**
   * Phase-06: bypass cache toggle. When true, sends X-Bypass-Cache: 1 on the
   * next turn to force a fresh LLM call. Off by default.
   */
  bypassCache?: boolean;
  onToggleBypassCache?: () => void;
}

const MIN_HEIGHT = 24;
const MAX_HEIGHT = 200;

export function ChatComposer({
  value,
  onChange,
  onSubmit,
  disabled,
  compact,
  placeholder = 'What do you want to know?',
  webSearch,
  onToggleWebSearch,
  deepResearch,
  onToggleDeepResearch,
  bypassCache,
  onToggleBypassCache,
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [localWebSearch, setLocalWebSearch] = useState(false);
  const [localDeepResearch, setLocalDeepResearch] = useState(false);
  const ws = webSearch ?? localWebSearch;
  const toggleWs = onToggleWebSearch ?? (() => setLocalWebSearch((v) => !v));
  const dr = deepResearch ?? localDeepResearch;
  const toggleDr = onToggleDeepResearch ?? (() => setLocalDeepResearch((v) => !v));

  // Auto-resize textarea to fit content, clamped to [MIN_HEIGHT, MAX_HEIGHT].
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const clamped = Math.min(Math.max(el.scrollHeight, MIN_HEIGHT), MAX_HEIGHT);
    el.style.height = `${clamped}px`;
  }, [value]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.currentTarget.blur();
        return;
      }
      const isSubmitCombo = (e.metaKey || e.ctrlKey) && e.key === 'Enter';
      const isEnterOnly = e.key === 'Enter' && !e.shiftKey;
      if (isSubmitCombo || isEnterOnly) {
        e.preventDefault();
        if (value.trim() && !disabled) onSubmit();
      }
    },
    [value, disabled, onSubmit],
  );

  const canSubmit = value.trim().length > 0 && !disabled;
  const fontSize = compact ? 14 : 15;
  const radius = compact ? 12 : 14;
  const padBlock = compact ? 12 : 18;
  const padInline = compact ? 14 : 18;
  const sendSize = compact ? 28 : 32;

  return (
    <div
      style={{
        width: '100%',
        border: `1px solid ${T.n300}`,
        borderRadius: radius,
        background: disabled ? T.surfaceMuted : compact ? T.sidebar : T.surface,
        padding: `${padBlock}px ${padInline}px`,
        display: 'flex',
        flexDirection: 'column',
        gap: compact ? 10 : 14,
        boxSizing: 'border-box',
      }}
    >
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={placeholder}
        rows={1}
        style={{
          width: '100%',
          border: 'none', outline: 'none', resize: 'none',
          background: 'transparent',
          fontFamily: T.fSans, fontSize, color: T.n900,
          lineHeight: 1.5, padding: 0,
          minHeight: MIN_HEIGHT, maxHeight: MAX_HEIGHT,
          overflowY: 'auto',
        }}
        aria-label="Ask Cube"
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 12 : 16 }}>
        <ComposerToolToggle
          active={ws}
          onToggle={toggleWs}
          label="Web Search"
          title={ws ? 'Web Search: On' : 'Web Search: Off'}
          compact={compact}
        />
        <ComposerToolToggle
          active={dr}
          onToggle={toggleDr}
          label="DeepThink"
          title={dr ? 'DeepThink: On' : 'DeepThink: Off'}
          compact={compact}
        />
        {onToggleBypassCache != null && (
          <button
            type="button"
            onClick={onToggleBypassCache}
            title="Bypass response cache — forces a fresh LLM call even on cache hit"
            style={{
              fontSize: compact ? 10 : 11,
              padding: '2px 8px',
              border: `1px solid ${bypassCache ? T.brand : T.n300}`,
              borderRadius: 4,
              background: bypassCache ? T.brandSoft : 'transparent',
              color: bypassCache ? T.brand : T.n500,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Bypass cache
          </button>
        )}
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => { if (canSubmit) onSubmit(); }}
          disabled={!canSubmit}
          aria-label="Send message"
          style={{
            width: sendSize, height: sendSize, borderRadius: sendSize / 2,
            border: 'none',
            background: canSubmit ? T.n900 : T.n300,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: canSubmit ? 'pointer' : 'default',
            transition: 'background 0.15s',
          }}
        >
          <Icon icon={ArrowUp} size={compact ? 14 : 16} color="#fff" />
        </button>
      </div>
    </div>
  );
}
