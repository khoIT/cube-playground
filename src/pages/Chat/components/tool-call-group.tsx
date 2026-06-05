/**
 * ToolCallGroup — collapsible disclosure wrapping a run of tool-call chips.
 *
 * Long agent turns fire 10+ tool calls; rendering each as a standalone chip
 * pushes the streaming answer off-screen and, once the turn settles, leaves a
 * tall stack with no compact way to review the calls. This collapses a
 * consecutive run into a single ReasoningTrace-style header (collapsed by
 * default). While a call is pending the header shows a spinner + the running
 * tool's name so live activity stays visible without the stack growing;
 * afterwards it shows an ok/error/duration recap. Expanding reveals the
 * individual ToolCallChips.
 */
import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Loader, Wrench, XCircle } from 'lucide-react';
import { T, Icon } from '../../../shell/theme';
import { ToolCallChip, injectChatSpinKeyframes } from './tool-call-chip';
import type { ToolCallSection } from './assistant-message';

interface ToolCallGroupProps {
  calls: ToolCallSection[];
}

/** "850ms" under a second, "4.2s" above — matches chip-level ms display. */
function formatTotalMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function ToolCallGroup({ calls }: ToolCallGroupProps) {
  const [open, setOpen] = useState(false);
  injectChatSpinKeyframes();

  const pending = calls.find((c) => c.status === 'pending');
  const errorCount = calls.filter((c) => c.status === 'error').length;
  const totalMs = calls.reduce((sum, c) => sum + (c.ms ?? 0), 0);

  return (
    <div
      style={{
        borderLeft: `2px solid ${T.n200}`,
        marginLeft: 2,
        marginTop: 4,
        marginBottom: 4,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          padding: '3px 10px',
          maxWidth: '100%',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: T.n400,
          fontFamily: T.fSans,
          fontSize: 12,
          fontWeight: 500,
          letterSpacing: '0.02em',
        }}
        aria-expanded={open}
      >
        <Icon icon={Wrench} size={12} color={T.n400} />
        <span>Tool calls ({calls.length})</span>
        {pending ? (
          <>
            <span
              style={{ animation: 'chat-spin 1s linear infinite', display: 'inline-flex' }}
            >
              <Icon icon={Loader} size={12} color={T.n400} />
            </span>
            <span
              style={{
                fontFamily: T.fMono,
                fontWeight: 400,
                color: T.n500,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: 260,
              }}
            >
              {pending.name}
            </span>
          </>
        ) : (
          <>
            {errorCount > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: T.red500 }}>
                <Icon icon={XCircle} size={12} color={T.red500} />
                {errorCount} failed
              </span>
            )}
            {totalMs > 0 && (
              <span style={{ fontWeight: 400, color: T.n400 }}>· {formatTotalMs(totalMs)}</span>
            )}
          </>
        )}
        <Icon icon={open ? ChevronDown : ChevronRight} size={12} color={T.n400} />
      </button>

      {open && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 6,
            padding: '4px 10px 8px',
          }}
        >
          {calls.map((c) => (
            <ToolCallChip
              key={c.id}
              name={c.name}
              status={c.status}
              ms={c.ms}
              summary={c.summary}
            />
          ))}
        </div>
      )}
    </div>
  );
}
