/**
 * AssistantMessage — renders a discriminated union of response sections.
 *
 * Section types:
 *   text         — plain text paragraph
 *   reasoning    — collapsible ReasoningTrace
 *   tool_call    — pending ToolCallChip (no result yet)
 *   tool_result  — ToolCallChip with status + ms + summary (merged with matching tool_call)
 *   query_artifact — QueryArtifactCard
 */
import React from 'react';
import { Bot } from 'lucide-react';
import { T, Icon } from '../../../shell/theme';
import { ReasoningTrace } from './reasoning-trace';
import { ToolCallChip } from './tool-call-chip';
import { QueryArtifactCard } from './query-artifact-card';
import { AssistantChartSection } from './assistant-chart-section';
import type { QueryArtifact, ChartArtifact } from '../../../api/chat-sse-client';

// ---------------------------------------------------------------------------
// Section types
// ---------------------------------------------------------------------------

export interface TextSection {
  type: 'text';
  text: string;
}

export interface ReasoningSection {
  type: 'reasoning';
  text: string;
}

export interface ToolCallSection {
  type: 'tool_call';
  id: string;
  name: string;
  status: 'pending' | 'ok' | 'error';
  ms?: number;
  summary?: string;
}

export interface ToolResultSection {
  type: 'tool_result';
  id: string;
  ok: boolean;
  ms: number;
  summary: string;
}

export interface QueryArtifactSection {
  type: 'query_artifact';
  artifact: QueryArtifact;
}

export interface ChartSection {
  type: 'chart';
  artifact: ChartArtifact;
}

export type AssistantSection =
  | TextSection
  | ReasoningSection
  | ToolCallSection
  | ToolResultSection
  | QueryArtifactSection
  | ChartSection;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface AssistantMessageProps {
  sections: AssistantSection[];
}

export function AssistantMessage({ sections }: AssistantMessageProps) {
  // Merge tool_result into its matching tool_call so we render one chip per call.
  const merged = mergeToolSections(sections);

  return (
    <div style={{ padding: '4px 16px' }}>
      {/* Agent header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          marginBottom: 6,
        }}
      >
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            background: T.brandSoft,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Icon icon={Bot} size={14} color={T.brand} />
        </div>
        <span
          style={{
            fontFamily: T.fSans,
            fontSize: 12,
            fontWeight: 600,
            color: T.n600,
            letterSpacing: '0.03em',
            textTransform: 'uppercase',
          }}
        >
          Assistant
        </span>
      </div>

      {/* Sections */}
      <div style={{ paddingLeft: 31 }}>
        {merged.map((section, i) => (
          <SectionRenderer key={i} section={section} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Merge helper — pairs each tool_result with its tool_call
// ---------------------------------------------------------------------------

function mergeToolSections(sections: AssistantSection[]): AssistantSection[] {
  // Build a map of tool_call id → index so we can patch in result data.
  const callIndexById = new Map<string, number>();
  const output: AssistantSection[] = [];

  for (const section of sections) {
    if (section.type === 'tool_call') {
      callIndexById.set(section.id, output.length);
      output.push({ ...section });
    } else if (section.type === 'tool_result') {
      const idx = callIndexById.get(section.id);
      if (idx !== undefined) {
        // Patch the existing tool_call entry.
        const existing = output[idx] as ToolCallSection;
        output[idx] = {
          ...existing,
          status: section.ok ? 'ok' : 'error',
          ms: section.ms,
          summary: section.summary,
        };
      }
      // Don't push a separate tool_result row — it's absorbed into the chip.
    } else {
      output.push(section);
    }
  }
  return output;
}

// ---------------------------------------------------------------------------
// Per-section renderer
// ---------------------------------------------------------------------------

function SectionRenderer({ section }: { section: AssistantSection }) {
  switch (section.type) {
    case 'text':
      return (
        <p
          style={{
            margin: '0 0 8px',
            fontFamily: T.fSans,
            fontSize: 14,
            color: T.n800,
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {section.text}
        </p>
      );

    case 'reasoning':
      return <ReasoningTrace text={section.text} />;

    case 'tool_call':
      return (
        <div style={{ marginBottom: 6 }}>
          <ToolCallChip
            name={section.name}
            status={section.status}
            ms={section.ms}
            summary={section.summary}
          />
        </div>
      );

    case 'query_artifact':
      return <QueryArtifactCard artifact={section.artifact} />;

    case 'chart':
      return <AssistantChartSection artifact={section.artifact} />;

    default:
      return null;
  }
}
