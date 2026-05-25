/**
 * TurnDetail — expandable card for a single turn in the triage UI.
 * Sub-sections live in dedicated files to stay under 200 LOC:
 *   - turn-llm-calls-section.tsx
 *   - turn-tool-invocations-section.tsx
 *   - raw-events-accordion.tsx
 */
import React, { useState } from 'react';
import { T } from '../../shell/theme';
import { useDebugTurn } from './use-debug-api';
import type { DebugTurn } from './use-debug-api';
import { LegacyTurnBadge } from './legacy-turn-badge';
import { RawEventsAccordion } from './raw-events-accordion';
import { LlmCallsSection } from './turn-llm-calls-section';
import { ToolInvocationsSection } from './turn-tool-invocations-section';

// Langfuse deep-link: VITE_LANGFUSE_HOST set at build time; undefined means hidden.
const LANGFUSE_HOST = (import.meta as Record<string, any>).env?.VITE_LANGFUSE_HOST as string | undefined;

const S = {
  card: { border: `1px solid ${T.n200}`, borderRadius: 8, marginBottom: 8, overflow: 'hidden' } as React.CSSProperties,
  header: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '8px 12px', background: T.surfaceMuted,
    cursor: 'pointer', userSelect: 'none' as const, fontSize: 12,
  } as React.CSSProperties,
  body: { padding: '10px 14px' } as React.CSSProperties,
  sectionLabel: {
    fontSize: 11, fontWeight: 700, letterSpacing: '0.05em',
    textTransform: 'uppercase' as const, color: T.n500, marginBottom: 6, marginTop: 12,
  } as React.CSSProperties,
  pre: {
    fontFamily: T.fMono, fontSize: 11, whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-all' as const, maxHeight: 300, overflowY: 'auto' as const,
    background: T.surfaceSubtle, padding: '8px 10px', borderRadius: 4,
    border: `1px solid ${T.n200}`,
  } as React.CSSProperties,
  outlineBtn: {
    fontSize: 11, padding: '2px 8px', border: `1px solid ${T.n300}`,
    borderRadius: 4, background: T.surfaceSubtle, color: T.n600, cursor: 'pointer',
  } as React.CSSProperties,
  langfuseBtn: {
    fontSize: 11, padding: '2px 8px', border: `1px solid ${T.brandBorder}`,
    borderRadius: 4, background: T.brandSoft, color: T.brand,
    cursor: 'pointer', textDecoration: 'none', display: 'inline-block',
  } as React.CSSProperties,
};

interface TurnDetailProps {
  turn: DebugTurn;
  index: number;
}

export function TurnDetail({ turn, index }: TurnDetailProps) {
  const [expanded, setExpanded] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const { data, isLoading, error } = useDebugTurn(expanded ? turn.id : null);

  const isAssistant = turn.role === 'assistant';
  const langfuseUrl = LANGFUSE_HOST ? `${LANGFUSE_HOST}/trace/${turn.id}` : null;

  return (
    <div style={S.card}>
      <div
        style={{ ...S.header, cursor: isAssistant ? 'pointer' : 'default' }}
        onClick={() => isAssistant && setExpanded((v) => !v)}
      >
        <span style={{ color: T.n400, fontFamily: T.fMono, fontSize: 11, minWidth: 24 }}>#{index + 1}</span>
        <span style={{ fontWeight: 600, color: isAssistant ? T.brand : T.n700, flex: 1 }}>
          {turn.role === 'user' ? 'User' : 'Assistant'}
        </span>
        {turn.legacy && <LegacyTurnBadge />}
        <span style={{ color: T.n400, fontSize: 11 }}>{new Date(turn.createdAt).toLocaleString()}</span>
        {langfuseUrl && isAssistant && (
          <a
            href={langfuseUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={S.langfuseBtn}
            onClick={(e) => e.stopPropagation()}
          >
            Open in Langfuse
          </a>
        )}
        {isAssistant && <span style={{ color: T.n400, fontSize: 10 }}>{expanded ? '▲' : '▼'}</span>}
      </div>

      {/* User turn: always show text inline */}
      {!isAssistant && (
        <div style={{ ...S.body, fontFamily: T.fSans, fontSize: 12, color: T.n800 }}>
          {turn.text || <span style={{ color: T.n400 }}>(no text)</span>}
        </div>
      )}

      {/* Assistant turn expanded body */}
      {isAssistant && expanded && (
        <div style={S.body}>
          {turn.legacy ? (
            <div style={{ color: T.n500, fontSize: 12, padding: '8px 0' }}>
              No per-step observability data captured for this turn — predates the observability feature.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <div style={S.sectionLabel}>Prompt</div>
                <button style={S.outlineBtn} onClick={() => setShowPrompt((v) => !v)}>
                  {showPrompt ? 'Collapse' : 'Expand'}
                </button>
              </div>
              {showPrompt && <pre style={S.pre}>{turn.text || '(no content)'}</pre>}

              {isLoading && <div style={{ color: T.n400, fontSize: 11, marginTop: 8 }}>Loading turn detail…</div>}
              {error && <div style={{ color: T.red500, fontSize: 11, marginTop: 8 }}>Error: {error}</div>}

              {data && (
                <>
                  <div style={S.sectionLabel}>LLM Calls ({data.llmCalls.length})</div>
                  <LlmCallsSection calls={data.llmCalls} />

                  <div style={S.sectionLabel}>Tool Invocations ({data.toolInvocations.length})</div>
                  <ToolInvocationsSection invocations={data.toolInvocations} />
                </>
              )}

              <div style={S.sectionLabel}>Raw SDK Events</div>
              <RawEventsAccordion turnId={turn.id} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
