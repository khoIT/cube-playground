/**
 * ToolCallChip — compact pill showing a tool invocation + status.
 * Click to expand and reveal the summary.
 */
import React, { useState } from 'react';
import { CheckCircle, XCircle, Loader, ChevronDown, ChevronRight } from 'lucide-react';
import { T, Icon } from '../../../shell/theme';

// No global `spin` keyframe exists in the app stylesheet, so inject our own
// (same pattern as TypingDots' chat-blink). Named chat-spin to avoid clashing
// with scoped module keyframes. Shared by ToolCallChip and ToolCallGroup.
const keyframes = `
@keyframes chat-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
`;

let styleInjected = false;
export function injectChatSpinKeyframes() {
  if (styleInjected || typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.textContent = keyframes;
  document.head.appendChild(style);
  styleInjected = true;
}

interface ToolCallChipProps {
  name: string;
  status: 'pending' | 'ok' | 'error';
  ms?: number;
  summary?: string;
}

const STATUS_COLOR: Record<ToolCallChipProps['status'], string> = {
  pending: 'var(--shell-text-faint)',
  ok: 'var(--shell-success)',
  error: 'var(--shell-danger)',
};

export function ToolCallChip({ name, status, ms, summary }: ToolCallChipProps) {
  const [expanded, setExpanded] = useState(false);
  const color = STATUS_COLOR[status];
  injectChatSpinKeyframes();

  return (
    <div
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        maxWidth: '100%',
        border: `1px solid var(--shell-border)`,
        borderRadius: 8,
        overflow: 'hidden',
        fontFamily: T.fMono,
        fontSize: 12,
      }}
    >
      {/* Pill row */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 10px',
          background: 'var(--surface-subtle)',
          border: 'none',
          cursor: 'pointer',
          fontFamily: T.fMono,
          fontSize: 12,
          color: 'var(--shell-text-secondary)',
          textAlign: 'left',
        }}
        aria-expanded={expanded}
      >
        {status === 'pending' && (
          <span style={{ color, animation: 'chat-spin 1s linear infinite', display: 'inline-flex' }}>
            <Icon icon={Loader} size={13} color={color} />
          </span>
        )}
        {status === 'ok' && <Icon icon={CheckCircle} size={13} color={color} />}
        {status === 'error' && <Icon icon={XCircle} size={13} color={color} />}

        <span style={{ color: 'var(--shell-text-emphasis)' }}>{name}</span>

        {ms !== undefined && (
          <span style={{ color: 'var(--shell-text-faint)', fontSize: 11 }}>{ms}ms</span>
        )}

        {summary && (
          <Icon
            icon={expanded ? ChevronDown : ChevronRight}
            size={12}
            color={'var(--shell-text-faint)'}
            style={{ marginLeft: 'auto' }}
          />
        )}
      </button>

      {/* Expandable summary */}
      {expanded && summary && (
        <div
          style={{
            padding: '6px 10px',
            background: 'var(--surface-raised)',
            borderTop: `1px solid var(--shell-bg-subtle)`,
            color: 'var(--shell-text-muted)',
            fontFamily: T.fMono,
            fontSize: 12,
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {summary}
        </div>
      )}
    </div>
  );
}
