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
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { T } from '../../../shell/theme';
import { useTheme } from '../../../theme/use-theme';
import cubeLogoLight from '../../../assets/brand/cube-logo-light.png';
import cubeLogoDark from '../../../assets/brand/cube-logo-dark.png';
import { ReasoningTrace } from './reasoning-trace';
import { ToolCallChip } from './tool-call-chip';
import { ToolCallGroup } from './tool-call-group';
import { CachedResponseBadge } from './cached-response-badge';
import { QueryArtifactCard } from './query-artifact-card';
import { AssistantChartSection } from './assistant-chart-section';
import { FieldChip } from './field-chip';
import { CiteToken, parseCiteTokens } from './cite-token';
import { useGlossaryLinker, type LinkedSegment } from './use-glossary-linker';
import { resolveConceptHref } from '../../Catalog/glossary/resolve-concept';
import { ConceptChip } from '../../../components/concept-chip/concept-chip';
import { ConceptHoverCard } from '../../../components/concept-hover-card/concept-hover-card';
import type { GlossaryTerm } from '../../../api/glossary-client';
import { FollowupChips } from './followup-chips';
import { DisambigChips } from './disambig-chips';
import type { DisambigOptionsPayload } from '../../../stores/chat-stream-store-actions';
import { suggestFollowups, type FollowupChip } from '../services/followup-suggester';
import type { QueryArtifact, ChartArtifact } from '../../../api/chat-sse-client';

// Short local-time formatter for the assistant header timestamp.
// Mirrors user-message styling (HH:MM 24h, no seconds).
function formatTurnTs(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * Field-chip token (phase-02). Format LOCKED:
 *   {{field:<cube>.<member>}}
 * Cube + member are dot-separated identifiers matching catalog meta names.
 * Token is intentionally absent from markdown/HTML and current message
 * corpus to avoid collision (verified during phase-02 design).
 */
const FIELD_TOKEN_REGEX = /\{\{field:([A-Za-z_][\w.]*\.[A-Za-z_][\w]*)\}\}/g;

const INLINE_CODE_STYLE: React.CSSProperties = {
  fontFamily: T.fMono,
  fontSize: '0.92em',
  padding: '0 4px',
  borderRadius: 3,
  background: 'var(--shell-brand-soft)',
  color: 'var(--shell-text)',
};

/**
 * Splits a raw string into FieldChips + CiteTokens + plain-text spans, and
 * runs the glossary linker over each remaining text chunk. Applied to every
 * string leaf inside the markdown tree so all inline tokens keep working
 * regardless of which block-level element wraps them.
 *
 * Pipeline per leaf string:
 *   1. Split on {{cite:url|title}} → CiteToken nodes or plain sub-strings
 *   2. Split each plain sub-string on {{field:cube.member}} → FieldChip nodes
 *   3. Run glossary linker over the remaining plain text chunks
 */
function renderTextLeaf(
  text: string,
  link: (text: string) => LinkedSegment[],
  termsById: Map<string, GlossaryTerm>,
  keyPrefix: string,
): React.ReactNode[] {
  const out: React.ReactNode[] = [];

  // Step 1: split on cite tokens first so field-chip regex doesn't match inside URLs.
  const citeSegments = parseCiteTokens(text);

  citeSegments.forEach((seg, segIdx) => {
    const segKey = `${keyPrefix}-cs${segIdx}`;
    if (seg.kind === 'cite') {
      out.push(<CiteToken key={segKey} url={seg.url} title={seg.title} />);
      return;
    }

    // Step 2: split the plain text segment on field tokens.
    const plainText = seg.text;
    let last = 0;
    let match: RegExpExecArray | null;
    FIELD_TOKEN_REGEX.lastIndex = 0;
    while ((match = FIELD_TOKEN_REGEX.exec(plainText)) !== null) {
      if (match.index > last) {
        pushGlossaryChunks(out, plainText.slice(last, match.index), link, termsById, `${segKey}-t-${last}`);
      }
      const fqn = match[1];
      out.push(<FieldChip key={`${segKey}-f-${match.index}`} fqn={fqn} />);
      last = FIELD_TOKEN_REGEX.lastIndex;
    }
    if (last < plainText.length) {
      pushGlossaryChunks(out, plainText.slice(last), link, termsById, `${segKey}-t-${last}`);
    }
  });

  return out;
}

function pushGlossaryChunks(
  out: React.ReactNode[],
  text: string,
  link: (text: string) => LinkedSegment[],
  termsById: Map<string, GlossaryTerm>,
  keyPrefix: string,
): void {
  const segments = link(text);
  if (segments.length === 0) {
    out.push(<React.Fragment key={keyPrefix}>{text}</React.Fragment>);
    return;
  }
  segments.forEach((seg, i) => {
    if (seg.kind === 'term') {
      const resolvable = {
        id: seg.termId ?? '',
        primaryCatalogId: seg.primaryCatalogId ?? null,
        defaultFilter: seg.defaultFilter ?? null,
        defaultMeasureRef: seg.defaultMeasureRef ?? null,
      };
      const href = resolveConceptHref(resolvable);
      const fullTerm = termsById.get(seg.termId ?? '');
      const chip = (
        <ConceptChip
          key={`${keyPrefix}-g-${i}`}
          kind="concept"
          label={seg.text}
          to={href}
        />
      );
      // Trust is intentionally omitted from the inline chip to keep the chat
      // prose uncluttered — the hover-card header surfaces the trust badge.
      // Wrap in hover-card when the full term is available — provides definition
      // + typed actions on hover without a separate tooltip component.
      if (fullTerm) {
        out.push(
          <ConceptHoverCard key={`${keyPrefix}-hc-${i}`} term={fullTerm}>
            {chip}
          </ConceptHoverCard>,
        );
      } else {
        out.push(chip);
      }
    } else {
      out.push(<React.Fragment key={`${keyPrefix}-p-${i}`}>{seg.text}</React.Fragment>);
    }
  });
}

/**
 * Walks react-markdown's `children` and rewrites string nodes through the
 * field-chip + glossary pipeline. Non-string nodes (already-rendered React
 * elements from nested markdown) pass through untouched.
 */
function transformLeaves(
  children: React.ReactNode,
  link: (text: string) => LinkedSegment[],
  termsById: Map<string, GlossaryTerm>,
): React.ReactNode {
  const arr = React.Children.toArray(children);
  return arr.flatMap((child, i) => {
    if (typeof child === 'string') return renderTextLeaf(child, link, termsById, `c${i}`);
    return [child];
  });
}

function buildMarkdownComponents(
  link: (text: string) => LinkedSegment[],
  termsById: Map<string, GlossaryTerm>,
): Components {
  const wrap = (children: React.ReactNode) => transformLeaves(children, link, termsById);
  return {
    p: ({ children }) => <p style={P_STYLE}>{wrap(children)}</p>,
    strong: ({ children }) => <strong>{wrap(children)}</strong>,
    em: ({ children }) => <em>{wrap(children)}</em>,
    code: ({ className, children }) => {
      // react-markdown@9 maps fenced code → <pre><code class="language-…">
      // and inline code → <code> with no className. Distinguish by className
      // presence; fenced blocks render via the `pre` override so this branch
      // covers only the inline case.
      if (className) {
        return <code className={className}>{children}</code>;
      }
      return <code style={INLINE_CODE_STYLE}>{wrap(children)}</code>;
    },
    pre: ({ children }) => <pre style={PRE_STYLE}>{children}</pre>,
    ul: ({ children }) => <ul style={LIST_STYLE}>{children}</ul>,
    ol: ({ children }) => <ol style={LIST_STYLE}>{children}</ol>,
    li: ({ children }) => <li style={LI_STYLE}>{wrap(children)}</li>,
    h1: ({ children }) => <h3 style={H_STYLE}>{wrap(children)}</h3>,
    h2: ({ children }) => <h3 style={H_STYLE}>{wrap(children)}</h3>,
    h3: ({ children }) => <h4 style={H_STYLE}>{wrap(children)}</h4>,
    h4: ({ children }) => <h4 style={H_STYLE}>{wrap(children)}</h4>,
    h5: ({ children }) => <h5 style={H_STYLE}>{wrap(children)}</h5>,
    h6: ({ children }) => <h6 style={H_STYLE}>{wrap(children)}</h6>,
    blockquote: ({ children }) => <blockquote style={BLOCKQUOTE_STYLE}>{children}</blockquote>,
    hr: () => <hr style={HR_STYLE} />,
    a: ({ href, children }) => (
      <a href={href} target="_blank" rel="noopener noreferrer" style={A_STYLE}>
        {wrap(children)}
      </a>
    ),
    table: ({ children }) => (
      <div style={TABLE_WRAPPER_STYLE}>
        <table style={TABLE_STYLE}>{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead style={THEAD_STYLE}>{children}</thead>,
    tbody: ({ children }) => <tbody>{children}</tbody>,
    tr: ({ children }) => <tr>{children}</tr>,
    th: ({ children }) => <th style={TH_STYLE}>{wrap(children)}</th>,
    td: ({ children }) => <td style={TD_STYLE}>{wrap(children)}</td>,
  };
}

const P_STYLE: React.CSSProperties = {
  margin: '0 0 8px',
  fontFamily: T.fSans,
  fontSize: 14,
  color: 'var(--shell-text-emphasis)',
  lineHeight: 1.6,
  wordBreak: 'break-word',
};

const LIST_STYLE: React.CSSProperties = {
  margin: '0 0 8px',
  paddingLeft: 20,
  fontFamily: T.fSans,
  fontSize: 14,
  color: 'var(--shell-text-emphasis)',
  lineHeight: 1.6,
};

const LI_STYLE: React.CSSProperties = { marginBottom: 2 };

const H_STYLE: React.CSSProperties = {
  margin: '12px 0 6px',
  fontFamily: T.fSans,
  fontWeight: 600,
  color: 'var(--shell-text)',
  lineHeight: 1.3,
};

const BLOCKQUOTE_STYLE: React.CSSProperties = {
  margin: '0 0 8px',
  // Notice/clarification callout: a slightly different warm recessed fill +
  // rounded block so it stands apart from the surrounding cream message body.
  padding: '8px 14px',
  background: 'var(--bg-muted)',
  borderLeft: `3px solid var(--shell-brand)`,
  borderRadius: 8,
  color: 'var(--shell-text-secondary)',
  fontStyle: 'italic',
};

const HR_STYLE: React.CSSProperties = {
  border: 'none',
  borderTop: `1px solid var(--shell-border)`,
  margin: '12px 0',
};

const A_STYLE: React.CSSProperties = {
  color: 'var(--shell-brand)',
  textDecoration: 'underline',
  textUnderlineOffset: 2,
};

const PRE_STYLE: React.CSSProperties = {
  margin: '0 0 8px',
  padding: 10,
  borderRadius: 6,
  background: 'var(--shell-bg-subtle)',
  color: 'var(--shell-text)',
  fontFamily: T.fMono,
  fontSize: 12,
  lineHeight: 1.5,
  overflowX: 'auto',
};

const TABLE_WRAPPER_STYLE: React.CSSProperties = {
  margin: '0 0 8px',
  overflowX: 'auto',
};

const TABLE_STYLE: React.CSSProperties = {
  borderCollapse: 'collapse',
  fontFamily: T.fSans,
  fontSize: 13,
  color: 'var(--shell-text-emphasis)',
  minWidth: '100%',
};

const THEAD_STYLE: React.CSSProperties = {
  background: 'var(--shell-bg-subtle)',
};

const TH_STYLE: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 10px',
  border: `1px solid var(--shell-border)`,
  fontWeight: 600,
  color: 'var(--shell-text)',
  whiteSpace: 'nowrap',
};

const TD_STYLE: React.CSSProperties = {
  padding: '6px 10px',
  border: `1px solid var(--shell-border)`,
  verticalAlign: 'top',
};

const REMARK_PLUGINS = [remarkGfm];

function TextParagraph({ text }: { text: string }) {
  const { link, terms } = useGlossaryLinker();
  // Build a fast id → GlossaryTerm lookup so ConceptHoverCard can receive a
  // full term object without an extra fetch. Rebuilt only when `terms` changes.
  const termsById = React.useMemo(() => {
    const m = new Map<string, GlossaryTerm>();
    for (const t of terms) m.set(t.id, t);
    return m;
  }, [terms]);
  // Memoize the components map against both link and termsById so we don't
  // churn react-markdown's renderer on every keystroke.
  const components = React.useMemo(
    () => buildMarkdownComponents(link, termsById),
    [link, termsById],
  );
  return (
    <div style={MARKDOWN_ROOT_STYLE}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

const MARKDOWN_ROOT_STYLE: React.CSSProperties = {
  fontFamily: T.fSans,
  fontSize: 14,
  color: 'var(--shell-text-emphasis)',
  lineHeight: 1.6,
};

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
  /** ISO timestamp of the turn — rendered next to "Cube" in the header. */
  ts?: string;
  /** True when this turn was served from the response cache (vs live LLM). */
  cacheHit?: boolean;
  /** Freshness of cached payload — set only when cacheHit=true. */
  cacheFreshness?: 'refreshed' | 'stale' | null;
  /**
   * When true, render the suggested follow-up chip row below the message.
   * Set only on the last settled assistant message (no streaming after).
   */
  showFollowups?: boolean;
  /** Pick handler — chip text should be prefilled + sent (phase-04). */
  onFollowupPick?: (text: string) => void;
  /**
   * Server-side disambiguation options the agent surfaced for this turn.
   * Rendered as clickable pills below the message; click resolves the slot
   * for the rest of the session via kv_cache memory.
   */
  disambigOptions?: DisambigOptionsPayload | null;
  /** Pick handler for a disambig chip — sends pinText as the next user turn. */
  onDisambigPick?: (pinText: string) => void;
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

function AssistantMessageImpl({
  sections,
  ts,
  cacheHit,
  cacheFreshness,
  showFollowups,
  onFollowupPick,
  disambigOptions,
  onDisambigPick,
}: AssistantMessageProps) {
  // Merge tool_result into its matching tool_call so we render one chip per call.
  const merged = mergeToolSections(sections);
  const { theme } = useTheme();
  // Dark theme → light logo (visible on dark bg), light theme → dark logo.
  const logoSrc = theme === 'dark' ? cubeLogoLight : cubeLogoDark;

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
        <img
          src={logoSrc}
          alt=""
          aria-hidden
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            display: 'block',
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontFamily: T.fSans,
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--shell-text-muted)',
            letterSpacing: '0.03em',
            textTransform: 'uppercase',
          }}
        >
          Cube
        </span>
        {cacheHit && <CachedResponseBadge freshness={cacheFreshness} />}
        {ts && (
          <span
            style={{
              fontFamily: T.fSans,
              fontSize: 11,
              color: 'var(--shell-text-faint)',
              marginLeft: cacheHit ? 0 : undefined,
            }}
            title={ts}
          >
            · {formatTurnTs(ts)}
          </span>
        )}
      </div>

      {/* Sections */}
      <div style={{ paddingLeft: 31 }}>
        {groupToolCallRuns(merged).map((unit, i) =>
          unit.kind === 'tool_run' ? (
            unit.calls.length === 1 ? (
              <SectionRenderer key={i} section={unit.calls[0]} />
            ) : (
              <ToolCallGroup key={i} calls={unit.calls} />
            )
          ) : (
            <SectionRenderer key={i} section={unit.section} />
          ),
        )}
        {disambigOptions && disambigOptions.options.length > 0 ? (
          <DisambigChips
            prompt={disambigOptions.prompt}
            slot={disambigOptions.slot}
            options={disambigOptions.options}
            onPick={(pinText) => onDisambigPick?.(pinText)}
          />
        ) : null}
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

/**
 * Memoized so committed turns don't re-render — and re-parse their full
 * markdown via ReactMarkdown — on every streamed token of the live turn. In a
 * long session the un-memoized cost grows with history length and saturates
 * the main thread, making the "Stop generating" button (and the whole UI)
 * unresponsive. Committed messages pass referentially-stable props (stable
 * `sections` ref, `showFollowups=false` while streaming, useCallback handlers),
 * so the shallow compare holds; only the live `__streaming__` message — whose
 * `sections` array rebuilds each render — re-renders.
 */
export const AssistantMessage = React.memo(AssistantMessageImpl);

// ---------------------------------------------------------------------------
// Render-unit grouping — collapse consecutive tool calls into one disclosure
// ---------------------------------------------------------------------------

type RenderUnit =
  | { kind: 'section'; section: AssistantSection }
  | { kind: 'tool_run'; calls: ToolCallSection[] };

/**
 * Collapses consecutive tool_call sections into a single `tool_run` unit so a
 * burst of 10+ calls renders as one collapsed ToolCallGroup instead of a chip
 * stack that pushes the answer off-screen. A lone call keeps its plain chip —
 * it's already compact and one fewer click to inspect.
 */
function groupToolCallRuns(sections: AssistantSection[]): RenderUnit[] {
  const units: RenderUnit[] = [];
  for (const section of sections) {
    if (section.type === 'tool_call') {
      const last = units[units.length - 1];
      if (last?.kind === 'tool_run') last.calls.push(section);
      else units.push({ kind: 'tool_run', calls: [section] });
    } else {
      units.push({ kind: 'section', section });
    }
  }
  return units;
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
