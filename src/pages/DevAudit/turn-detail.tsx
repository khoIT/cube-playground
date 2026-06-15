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
import { PermissionDecisionsSection } from './turn-permission-decisions-section';
import { TurnAnnotationToggle } from './turn-annotation-toggle';
import { TurnArtifactsSection, ArtifactCountBadge } from './turn-artifacts-section';

// Langfuse deep-link: VITE_LANGFUSE_HOST set at build time; undefined means hidden.
const LANGFUSE_HOST = (import.meta as Record<string, any>).env?.VITE_LANGFUSE_HOST as string | undefined;

const S = {
  card: { border: `1px solid var(--shell-border)`, borderRadius: 8, marginBottom: 8, overflow: 'hidden' } as React.CSSProperties,
  header: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '8px 12px', background: 'var(--surface-muted)',
    cursor: 'pointer', userSelect: 'none' as const, fontSize: 12,
  } as React.CSSProperties,
  body: { padding: '10px 14px' } as React.CSSProperties,
  sectionLabel: {
    fontSize: 11, fontWeight: 700, letterSpacing: '0.05em',
    textTransform: 'uppercase' as const, color: 'var(--shell-text-subtle)', marginBottom: 6, marginTop: 12,
  } as React.CSSProperties,
  pre: {
    fontFamily: T.fMono, fontSize: 11, whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-all' as const, maxHeight: 300, overflowY: 'auto' as const,
    background: 'var(--surface-subtle)', padding: '8px 10px', borderRadius: 4,
    border: `1px solid var(--shell-border)`,
  } as React.CSSProperties,
  outlineBtn: {
    fontSize: 11, padding: '2px 8px', border: `1px solid var(--shell-border-strong)`,
    borderRadius: 4, background: 'var(--surface-subtle)', color: 'var(--shell-text-muted)', cursor: 'pointer',
  } as React.CSSProperties,
  langfuseBtn: {
    fontSize: 11, padding: '2px 8px', border: `1px solid var(--shell-brand-border)`,
    borderRadius: 4, background: 'var(--shell-brand-soft)', color: 'var(--shell-brand)',
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
  const stats = isAssistant ? formatTurnStats(turn) : null;

  return (
    // id="turn-{id}" enables hash navigation from search results
    <div id={`turn-${turn.id}`} style={S.card}>
      <div
        style={{ ...S.header, cursor: isAssistant ? 'pointer' : 'default' }}
        onClick={() => isAssistant && setExpanded((v) => !v)}
      >
        <span style={{ color: 'var(--shell-text-faint)', fontFamily: T.fMono, fontSize: 11, minWidth: 24 }}>#{index + 1}</span>
        <span style={{ fontWeight: 600, color: isAssistant ? 'var(--shell-brand)' : 'var(--shell-text-secondary)', flex: 1 }}>
          {turn.role === 'user' ? 'User' : 'Assistant'}
        </span>
        {turn.legacy && <LegacyTurnBadge />}
        {turn.cacheHit && <CacheHitBadge originalTurnId={turn.originalTurnId} originalSessionId={turn.originalSessionId} />}
        {isAssistant && <ArtifactCountBadge count={turn.artifacts?.length ?? 0} />}
        {stats && (
          <span
            style={{ color: 'var(--shell-text-subtle)', fontFamily: T.fMono, fontSize: 11 }}
            title="aggregate from final SDK result message · cache%: cache_read/(cache_read+cache_creation) · io: output/input ratio"
          >
            {stats}
          </span>
        )}
        <span style={{ color: 'var(--shell-text-faint)', fontSize: 11 }}>{new Date(turn.createdAt).toLocaleString()}</span>
        {/* Phase-04: annotation toggle — available once turn detail is expanded */}
        {isAssistant && data && (
          <TurnAnnotationToggle turnId={turn.id} initial={data.annotation ?? null} />
        )}
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
        {isAssistant && <span style={{ color: 'var(--shell-text-faint)', fontSize: 10 }}>{expanded ? '▲' : '▼'}</span>}
      </div>

      {/* User turn: always show text inline */}
      {!isAssistant && (
        <div style={{ ...S.body, fontFamily: T.fSans, fontSize: 12, color: 'var(--shell-text-emphasis)' }}>
          {turn.text || <span style={{ color: 'var(--shell-text-faint)' }}>(no text)</span>}
        </div>
      )}

      {/* Assistant turn expanded body */}
      {isAssistant && expanded && (
        <div style={S.body}>
          {/* Artifacts first — independent of observability rows, so legacy
              turns with persisted artifacts_json still show them. */}
          <TurnArtifactsSection artifacts={turn.artifacts} />
          {turn.legacy ? (
            <div style={{ color: 'var(--shell-text-subtle)', fontSize: 12, padding: '8px 0' }}>
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

              {isLoading && <div style={{ color: 'var(--shell-text-faint)', fontSize: 11, marginTop: 8 }}>Loading turn detail…</div>}
              {error && <div style={{ color: 'var(--shell-danger)', fontSize: 11, marginTop: 8 }}>Error: {error}</div>}

              {data && (
                <>
                  <div style={S.sectionLabel}>LLM Calls ({data.llmCalls.length})</div>
                  <LlmCallsSection calls={data.llmCalls} />

                  <div style={S.sectionLabel}>Tool Invocations ({data.toolInvocations.length})</div>
                  <ToolInvocationsSection invocations={data.toolInvocations} />

                  {data.permissionDecisions.length > 0 && (
                    <>
                      <div style={S.sectionLabel}>
                        Permission Decisions ({data.permissionDecisions.length})
                      </div>
                      <PermissionDecisionsSection decisions={data.permissionDecisions} />
                    </>
                  )}
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

// ---------------------------------------------------------------------------
// Phase-06: Cache hit badge
// ---------------------------------------------------------------------------

interface CacheHitBadgeProps {
  originalTurnId: string | null;
  originalSessionId: string | null;
}

function CacheHitBadge({ originalTurnId, originalSessionId }: CacheHitBadgeProps) {
  const badgeStyle: React.CSSProperties = {
    fontSize: 10,
    padding: '1px 6px',
    border: `1px solid var(--shell-brand)`,
    borderRadius: 4,
    background: 'var(--shell-brand-soft)',
    color: 'var(--shell-brand)',
    fontWeight: 600,
    letterSpacing: '0.04em',
    whiteSpace: 'nowrap',
    textDecoration: 'none',
    display: 'inline-block',
  };

  if (originalTurnId && originalSessionId) {
    const href = `/dev/chat-audit/sessions/${encodeURIComponent(originalSessionId)}#turn-${encodeURIComponent(originalTurnId)}`;
    return (
      <a href={href} style={badgeStyle} title={`Cache hit — replayed from turn ${originalTurnId}`} onClick={(e) => e.stopPropagation()}>
        Cache hit
      </a>
    );
  }

  return (
    <span style={badgeStyle} title="Cache hit — original turn unavailable">
      Cache hit
    </span>
  );
}

function formatTokens(n: number | null): string | null {
  if (n == null) return null;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/**
 * Compact header strip: "1.2k in · 480 out · $0.018 · 342ms · sonnet · cache 73% · io 0.4x".
 * Returns null when there's nothing useful to show (e.g. user turn or legacy).
 *
 * Phase-03 additions:
 *   cache N% = cache_read / (cache_read + cache_creation) * 100 — omitted when denominator is 0
 *   io X.Xx  = output / input — omitted when input is 0 or null
 */
function formatTurnStats(turn: DebugTurn): string | null {
  const parts: string[] = [];
  const ti = formatTokens(turn.inputTokens);
  const to = formatTokens(turn.outputTokens);
  if (ti) parts.push(`${ti} in`);
  if (to) parts.push(`${to} out`);
  if (turn.costUsd != null) parts.push(`$${turn.costUsd.toFixed(4)}`);
  if (turn.durationMs != null) parts.push(`${turn.durationMs}ms`);
  if (turn.model) parts.push(turn.model.split('-').slice(-2, -1)[0] || turn.model);

  // Phase-03: cache hit ratio — only when at least one cache column is non-null and denominator > 0
  const cr = turn.cacheReadTokens;
  const cc = turn.cacheCreationTokens;
  if (cr != null && cc != null && (cr + cc) > 0) {
    parts.push(`cache ${Math.round((cr / (cr + cc)) * 100)}%`);
  }

  // Phase-03: I/O token ratio — only when input is non-null and positive
  const rawIn = turn.inputTokens;
  const rawOut = turn.outputTokens;
  if (rawIn != null && rawOut != null && rawIn > 0) {
    parts.push(`io ${(rawOut / rawIn).toFixed(1)}x`);
  }

  return parts.length > 0 ? parts.join(' · ') : null;
}
