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
import { Link } from 'react-router-dom';
import { T, Icon } from '../../../shell/theme';
import { ReasoningTrace } from './reasoning-trace';
import { ToolCallChip } from './tool-call-chip';
import { QueryArtifactCard } from './query-artifact-card';
import { AssistantChartSection } from './assistant-chart-section';
import { FieldChip } from './field-chip';
import { useGlossaryLinker, type LinkedSegment } from './use-glossary-linker';
import { resolveGlossaryHref } from '../../Catalog/glossary/resolve-glossary-link';
import { FollowupChips } from './followup-chips';
import { suggestFollowups, type FollowupChip } from '../services/followup-suggester';
import type { QueryArtifact, ChartArtifact } from '../../../api/chat-sse-client';

/**
 * Field-chip token (phase-02). Format LOCKED:
 *   {{field:<cube>.<member>}}
 * Cube + member are dot-separated identifiers matching catalog meta names.
 * Token is intentionally absent from markdown/HTML and current message
 * corpus to avoid collision (verified during phase-02 design).
 */
const FIELD_TOKEN_REGEX = /\{\{field:([A-Za-z_][\w.]*\.[A-Za-z_][\w]*)\}\}/g;

/**
 * Renders an assistant text section: splits on `{{field:cube.member}}` tokens
 * into <FieldChip/>s, then runs the remaining plain text through the
 * glossary linker to wrap known business terms.
 */
function useRenderedText(text: string): React.ReactNode {
  const { link } = useGlossaryLinker();
  if (!text.includes('{{field:')) return renderWithGlossary(text, link);
  const out: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  FIELD_TOKEN_REGEX.lastIndex = 0;
  while ((match = FIELD_TOKEN_REGEX.exec(text)) !== null) {
    if (match.index > last) {
      out.push(<React.Fragment key={`t-${last}`}>{renderWithGlossary(text.slice(last, match.index), link)}</React.Fragment>);
    }
    const fqn = match[1];
    out.push(<FieldChip key={`${fqn}-${match.index}`} fqn={fqn} />);
    last = FIELD_TOKEN_REGEX.lastIndex;
  }
  if (last < text.length) {
    out.push(<React.Fragment key={`t-${last}`}>{renderWithGlossary(text.slice(last), link)}</React.Fragment>);
  }
  return out;
}

function TextParagraph({ text }: { text: string }) {
  const rendered = useRenderedText(text);
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
      {rendered}
    </p>
  );
}

function renderWithGlossary(text: string, link: (text: string) => LinkedSegment[]): React.ReactNode {
  const segments = link(text);
  if (segments.length === 0) return text;
  return segments.map((seg, i) =>
    seg.kind === 'term' ? (
      <Link
        key={`g-${i}`}
        to={resolveGlossaryHref({
          id: seg.termId ?? '',
          primaryCatalogId: seg.primaryCatalogId ?? null,
        })}
        title={`Glossary: ${seg.termId}`}
        style={{ color: T.brand, textDecoration: 'underline dotted', textUnderlineOffset: 2 }}
      >
        {seg.text}
      </Link>
    ) : (
      <React.Fragment key={`p-${i}`}>{seg.text}</React.Fragment>
    ),
  );
}

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
  /**
   * When true, render the suggested follow-up chip row below the message.
   * Set only on the last settled assistant message (no streaming after).
   */
  showFollowups?: boolean;
  /** Pick handler — chip text should be prefilled + sent (phase-04). */
  onFollowupPick?: (text: string) => void;
}

function extractFollowupContext(sections: ReadonlyArray<AssistantSection>): {
  cubes: string[];
  tools: string[];
} {
  const cubes = new Set<string>();
  const tools = new Set<string>();
  for (const s of sections) {
    if (s.type === 'tool_call') {
      tools.add(s.name);
    } else if (s.type === 'query_artifact') {
      // sourceRef.id may itself be a cube prefix (e.g. `players.dau`) or a
      // catalog metric id (`business_metrics/<slug>`). Both shapes are
      // useful for rule firing — keep the segment before `.`.
      const refId = s.artifact.sourceRef?.id;
      if (typeof refId === 'string') {
        const head = refId.includes('.') ? refId.split('.')[0] : refId;
        if (head) cubes.add(head);
      }
      // Also harvest cubes from the embedded query shape when present —
      // most query_artifacts carry `query.measures` / `query.dimensions`
      // as `cube.field` strings.
      const q = s.artifact.query as { measures?: unknown; dimensions?: unknown } | undefined;
      for (const arr of [q?.measures, q?.dimensions]) {
        if (Array.isArray(arr)) {
          for (const m of arr) {
            if (typeof m === 'string' && m.includes('.')) cubes.add(m.split('.')[0]);
          }
        }
      }
    }
  }
  return { cubes: Array.from(cubes), tools: Array.from(tools) };
}

export function AssistantMessage({ sections, showFollowups, onFollowupPick }: AssistantMessageProps) {
  // Merge tool_result into its matching tool_call so we render one chip per call.
  const merged = mergeToolSections(sections);

  const followupChips: FollowupChip[] = showFollowups
    ? suggestFollowups(extractFollowupContext(merged))
    : [];

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
        {showFollowups && followupChips.length > 0 ? (
          <FollowupChips
            chips={followupChips}
            onPick={(chip) => onFollowupPick?.(chip.text)}
          />
        ) : null}
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
      return <TextParagraph text={section.text} />;

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
