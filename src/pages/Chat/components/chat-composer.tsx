/**
 * ChatComposer — auto-sizing textarea input for chat turns.
 *
 * Keyboard shortcuts:
 *   Enter          → submit (unless Shift held)
 *   Shift+Enter    → newline
 *   Cmd/Ctrl+Enter → submit
 *   Esc            → blur
 *
 * Props:
 *   value / onChange   — controlled value
 *   onSubmit           — called when user commits the message
 *   disabled           — grey-out during streaming
 *   compact            — tighter sizing for panel / rail mode
 *   placeholder        — defaults to "Ask anything about your data…"
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { Send } from 'lucide-react';
import { T, Icon } from '../../../shell/theme';

interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  compact?: boolean;
  placeholder?: string;
}

/** Minimum / maximum textarea heights (px). */
const MIN_HEIGHT = 24;
const MAX_HEIGHT = 240;

export function ChatComposer({
  value,
  onChange,
  onSubmit,
  disabled,
  compact,
  placeholder = 'Ask anything about your data…',
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
        if (value.trim() && !disabled) {
          onSubmit();
        }
      }
    },
    [value, disabled, onSubmit],
  );

  const canSubmit = value.trim().length > 0 && !disabled;
  const fontSize = compact ? 13 : 14;
  const paddingV = compact ? 6 : 10;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        borderTop: `1px solid ${T.n200}`,
        background: T.surface,
        padding: compact ? '8px 12px' : '12px 16px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 8,
          border: `1px solid ${T.n300}`,
          borderRadius: 10,
          background: disabled ? T.surfaceMuted : T.surface,
          padding: `${paddingV}px 12px`,
          transition: 'border-color 0.15s',
        }}
        onFocus={() => {/* focus styling handled via CSS-in-style below */}}
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
            flex: 1,
            resize: 'none',
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontFamily: T.fSans,
            fontSize,
            color: T.n900,
            lineHeight: 1.5,
            minHeight: MIN_HEIGHT,
            maxHeight: MAX_HEIGHT,
            overflowY: 'auto',
            padding: 0,
            /* placeholder color via ::placeholder — not directly settable in inline style */
          }}
          aria-label="Chat message"
        />

        {/* Send button */}
        <button
          type="button"
          onClick={() => { if (canSubmit) onSubmit(); }}
          disabled={!canSubmit}
          aria-label="Send message"
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: compact ? 28 : 32,
            height: compact ? 28 : 32,
            borderRadius: 8,
            border: 'none',
            cursor: canSubmit ? 'pointer' : 'default',
            background: canSubmit ? T.brand : T.n200,
            transition: 'background 0.15s',
          }}
        >
          <Icon icon={Send} size={compact ? 13 : 15} color={canSubmit ? '#fff' : T.n400} />
        </button>
      </div>

      {/* Keyboard hint */}
      {!compact && (
        <div
          style={{
            marginTop: 4,
            fontFamily: T.fSans,
            fontSize: 11,
            color: T.n400,
            textAlign: 'right',
          }}
        >
          Enter to send · Shift+Enter for newline
        </div>
      )}
    </div>
  );
}
