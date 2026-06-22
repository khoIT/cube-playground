/**
 * AssistantMessage — renders a discriminated union of response sections.
 *
 * Section types:
 *   text         — plain text paragraph
 *   reasoning    — lifted to a collapsible disclosure on the agent header row
 *   tool_call    — pending ToolCallChip (no result yet)
 *   tool_result  — ToolCallChip with status + ms + summary (merged with matching tool_call)
 *   query_artifact — QueryArtifactCard
 */
import React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronDown, ChevronRight, Brain } from 'lucide-react';
import { T, Icon } from '../../../shell/theme';
import { useTheme } from '../../../theme/use-theme';
import cubeLogoLight from '../../../assets/brand/cube-logo-light.png';
import cubeLogoDark from '../../../assets/brand/cube-logo-dark.png';
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
import type { SegmentProposalPayload } from '../../../api/segment-proposal';
import { SegmentProposalCard } from './segment-proposal-card';
import { deriveTurnScope } from './derive-turn-scope';

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
  seen: Set<string>,
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
        pushGlossaryChunks(out, plainText.slice(last, match.index), link, termsById, `${segKey}-t-${last}`, seen);
      }
      const fqn = match[1];
      out.push(<FieldChip key={`${segKey}-f-${match.index}`} fqn={fqn} />);
      last = FIELD_TOKEN_REGEX.lastIndex;
    }
    if (last < plainText.length) {
      pushGlossaryChunks(out, plainText.slice(last), link, termsById, `${segKey}-t-${last}`, seen);
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
  seen: Set<string>,
): void {
  const segments = link(text);
  if (segments.length === 0) {
    out.push(<React.Fragment key={keyPrefix}>{text}</React.Fragment>);
    return;
  }
  segments.forEach((seg, i) => {
    // First-occurrence-wins: chip a term only the first time it appears in this
    // message; later mentions render as plain text. A dozen repeated `churn` /
    // `DAU` chips in one answer is visual noise — the first link is enough to
    // reach the definition.
    if (seg.kind === 'term' && seg.termId && seen.has(seg.termId)) {
      out.push(<React.Fragment key={`${keyPrefix}-p-${i}`}>{seg.text}</React.Fragment>);
      return;
    }
    if (seg.kind === 'term') {
      if (seg.termId) seen.add(seg.termId);
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
          tone="brand"
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
  seen: Set<string>,
): React.ReactNode {
  const arr = React.Children.toArray(children);
  return arr.flatMap((child, i) => {
    if (typeof child === 'string') return renderTextLeaf(child, link, termsById, `c${i}`, seen);
    return [child];
  });
}

function buildMarkdownComponents(
  link: (text: string) => LinkedSegment[],
  termsById: Map<string, GlossaryTerm>,
  seen: Set<string>,
): Components {
  const wrap = (children: React.ReactNode) => transformLeaves(children, link, termsById, seen);
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
  // Per-render dedup scope for glossary chips: reset before each render pass so
  // first-occurrence-wins is recomputed deterministically. A stable ref keeps
  // the same Set instance inside the memoized components closure; clearing it
  // each render means react-markdown repopulates it in document order.
  const seenRef = React.useRef<Set<string>>();
  if (!seenRef.current) seenRef.current = new Set();
  seenRef.current.clear();
  // Memoize the components map against both link and termsById so we don't
  // churn react-markdown's renderer on every keystroke.
  const components = React.useMemo(
    () => buildMarkdownComponents(link, termsById, seenRef.current!),
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

export interface VerdictSection {
  type: 'verdict';
  headline: string;
  rationale?: string;
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

export interface SegmentProposalSection {
  type: 'segment_proposal';
  proposal: SegmentProposalPayload;
}

export type AssistantSection =
  | TextSection
  | ReasoningSection
  | VerdictSection
  | ToolCallSection
  | ToolResultSection
  | QueryArtifactSection
  | ChartSection
  | SegmentProposalSection;

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
  /** pinText of the option already picked on a reloaded turn — highlights that
   *  chip while keeping all of them clickable. */
  disambigSelectedPinText?: string | null;
  /** Pick handler for a disambig chip — sends pinText as the next user turn. */
  onDisambigPick?: (pinText: string) => void;
  /** Side-panel surface uses the tighter gutter — must match UserMessage so the
   *  question heading and the reply share one left rail. */
  compact?: boolean;
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
  disambigSelectedPinText,
  onDisambigPick,
  compact,
}: AssistantMessageProps) {
  // Merge tool_result into its matching tool_call so we render one chip per call.
  const merged = mergeToolSections(sections);
  const { theme } = useTheme();
  // Dark theme → light logo (visible on dark bg), light theme → dark logo.
  const logoSrc = theme === 'dark' ? cubeLogoLight : cubeLogoDark;

  // Reasoning is lifted out of the body and shown as a compact disclosure on the
  // right of the agent header row (collapsed by default). All reasoning blocks
  // in the turn collapse into one trace; the body renders everything else.
  const [reasoningOpen, setReasoningOpen] = React.useState(false);
  const reasoningText = merged
    .filter((s): s is ReasoningSection => s.type === 'reasoning')
    .map((s) => s.text)
    .join('\n\n')
    .trim();
  // Verdict is lifted out of the body and rendered as the lead block at the top
  // of the answer (the last one wins if the model emitted more than once). Like
  // reasoning, it never reaches the body section loop.
  const verdict = merged
    .filter((s): s is VerdictSection => s.type === 'verdict')
    .at(-1);
  const bodyUnits = merged.filter((s) => s.type !== 'reasoning' && s.type !== 'verdict');

  const followupChips: FollowupChip[] = showFollowups
    ? suggestFollowups(extractFollowupContext(bodyUnits))
    : [];

  // Per-turn scope badge: the members + date window this answer actually
  // queried, derived from its own query artifact(s). Anchored under the question
  // so scanning history shows what each turn was about. Null (no data-backed
  // artifact) → no badge.
  const turnScope = deriveTurnScope(
    bodyUnits
      .filter((s): s is QueryArtifactSection => s.type === 'query_artifact')
      .map((s) => s.artifact),
  );

  // Explicit options (engine disambiguation or agent-authored choices) take
  // precedence over the heuristic followup row.
  const hasExplicitOptions = !!disambigOptions && disambigOptions.options.length > 0;

  // Hanging indent for the reply body: the question heading and the CUBE byline
  // hang at the outer gutter while everything the agent returns is nudged right
  // to align under the "Cube" wordmark (logo 24 + 7 gap). This visually peels
  // each question off the answer block beneath it. Off on the narrow side panel
  // (compact) where the extra indent would eat scarce horizontal room.
  const bodyIndent = compact ? 0 : 31;

  return (
    // Horizontal gutter matches UserMessage (16 compact / 24 full) so the reply
    // shares the question's left rail. Top padding 0 keeps the "Cube" header
    // tucked under its question; the user heading's bottom padding is the gap.
    <div style={{ padding: compact ? '0 16px 8px' : '0 24px 14px' }}>
      {/* Answer block — the CUBE reply sits flush beneath its question heading;
          no rail or card, the agent header + spacing carry the separation. */}
      <div>
        {/* Per-turn scope badge — anchored under the question, above the byline. */}
        {turnScope && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 7,
              marginBottom: compact ? 8 : 10,
              fontFamily: T.fSans,
              fontSize: 12,
              color: 'var(--shell-text-muted)',
            }}
          >
            <span style={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, fontSize: 11, color: 'var(--shell-text-secondary)' }}>
              Scope
            </span>
            {turnScope.members.map((m) => (
              <code
                key={m}
                style={{
                  fontFamily: T.fMono,
                  fontSize: 11,
                  color: 'var(--shell-text-secondary)',
                  background: 'var(--bg-muted)',
                  border: '1px solid var(--border-card)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '1px 7px',
                }}
              >
                {m}
              </code>
            ))}
            {turnScope.hiddenMemberCount > 0 && (
              <>
                <span style={{ fontWeight: 700, opacity: 0.85 }}>·</span>
                <span>+{turnScope.hiddenMemberCount} fields</span>
              </>
            )}
            {turnScope.dateRange && (
              <>
                <span style={{ fontWeight: 700, opacity: 0.85 }}>·</span>
                <span>{turnScope.dateRange}</span>
              </>
            )}
            {turnScope.extraArtifacts > 0 && (
              <>
                <span style={{ fontWeight: 700, opacity: 0.85 }}>·</span>
                <span
                  title={`This answer includes ${turnScope.extraArtifacts} more chart${turnScope.extraArtifacts > 1 ? 's' : ''} beyond the one summarized above`}
                  style={{ color: 'var(--shell-brand)', fontWeight: 600 }}
                >
                  +{turnScope.extraArtifacts} chart{turnScope.extraArtifacts > 1 ? 's' : ''}
                </span>
              </>
            )}
          </div>
        )}
        {/* Agent header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            marginBottom: compact ? 10 : 12,
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
        {/* Reasoning disclosure — right-aligned on the header row, collapsed by
            default; expands to a full-width panel below the header. */}
        {reasoningText && (
          <button
            type="button"
            onClick={() => setReasoningOpen((v) => !v)}
            aria-expanded={reasoningOpen}
            style={{
              marginLeft: 'auto',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '3px 9px',
              background: 'none',
              border: '1px solid var(--shell-border)',
              borderRadius: 'var(--radius-pill)',
              cursor: 'pointer',
              color: 'var(--shell-text-faint)',
              fontFamily: T.fSans,
              fontSize: 11.5,
              fontWeight: 500,
              letterSpacing: '0.02em',
            }}
          >
            <Icon icon={Brain} size={12} color={'var(--shell-text-faint)'} />
            <span>Reasoning</span>
            <Icon
              icon={reasoningOpen ? ChevronDown : ChevronRight}
              size={12}
              color={'var(--shell-text-faint)'}
            />
          </button>
        )}
      </div>

      {reasoningText && reasoningOpen && (
        <div
          style={{
            marginLeft: bodyIndent,
            marginBottom: 10,
            padding: '8px 12px',
            borderLeft: '2px solid var(--shell-border)',
            color: 'var(--shell-text-subtle)',
            fontFamily: T.fMono,
            fontSize: 12,
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {reasoningText}
        </div>
      )}

      {/* Sections — hung-indented under the "Cube" wordmark so the answer body
          reads as subordinate to the question heading + byline above it. */}
      <div style={{ marginLeft: bodyIndent }}>
        {/* Verdict lead block — the takeaway, above the supporting evidence. */}
        {verdict && (
          <div
            style={{
              border: '1px solid var(--border-strong)',
              borderLeft: '3px solid var(--shell-brand)',
              borderRadius: 'var(--radius-xl)',
              background: 'var(--surface-raised)',
              padding: compact ? '12px 14px' : '14px 18px',
              marginBottom: 16,
            }}
          >
            <div
              style={{
                fontFamily: T.fSans,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.09em',
                textTransform: 'uppercase',
                color: 'var(--shell-brand)',
                marginBottom: 8,
              }}
            >
              Verdict
            </div>
            <div
              style={{
                fontFamily: T.fSans,
                fontSize: compact ? 15 : 16,
                fontWeight: 700,
                lineHeight: 1.35,
                color: 'var(--shell-text)',
              }}
            >
              {verdict.headline}
            </div>
            {verdict.rationale && (
              <div
                style={{
                  fontFamily: T.fSans,
                  fontSize: 13,
                  lineHeight: 1.6,
                  color: 'var(--shell-text-muted)',
                  marginTop: 8,
                }}
              >
                {verdict.rationale}
              </div>
            )}
          </div>
        )}
        {groupChartRuns(groupToolCallRuns(bodyUnits)).map((group, i) =>
          group.kind === 'chart_grid' ? (
            <div
              key={i}
              style={{
                display: 'grid',
                // Two-up on the full page; the narrow side panel (compact) keeps
                // charts stacked. minmax(0,1fr) lets the chart's responsive width
                // shrink inside its track instead of overflowing the column.
                gridTemplateColumns: compact ? '1fr' : 'repeat(2, minmax(0, 1fr))',
                gap: 16,
                alignItems: 'start',
              }}
            >
              {group.units.map((u, j) => (
                <div
                  key={j}
                  // An odd trailing card spans both columns so it never sits as a
                  // lonely half-width tile beside an empty column.
                  style={
                    !compact && group.units.length % 2 === 1 && j === group.units.length - 1
                      ? { gridColumn: '1 / -1', minWidth: 0 }
                      : { minWidth: 0 }
                  }
                >
                  {renderRenderUnit(u, onFollowupPick, j)}
                </div>
              ))}
            </div>
          ) : (
            renderRenderUnit(group.unit, onFollowupPick, i)
          ),
        )}
        {disambigOptions && disambigOptions.options.length > 0 ? (
          <DisambigChips
            prompt={disambigOptions.prompt}
            slot={disambigOptions.slot}
            options={disambigOptions.options}
            selectedPinText={disambigSelectedPinText}
            onPick={(pinText) => onDisambigPick?.(pinText)}
          />
        ) : null}
        {/* Explicit options (engine disambiguation or agent-authored choices)
            take precedence: they're the actual next step the turn asked for, so
            the generic heuristic followups are suppressed while they're shown. */}
        {!hasExplicitOptions && showFollowups && followupChips.length > 0 ? (
          <FollowupChips
            chips={followupChips}
            onPick={(chip) => onFollowupPick?.(chip.text)}
          />
        ) : null}
        </div>
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
// Chart-run grouping — tile consecutive charts two-up
// ---------------------------------------------------------------------------

type LayoutGroup =
  | { kind: 'single'; unit: RenderUnit }
  | { kind: 'chart_grid'; units: RenderUnit[] };

/** A render unit whose visible body is a chart — a standalone chart section, or
 *  a query-artifact card that carries an embedded chart. Chartless artifacts
 *  (table-only / summary-only) and everything else are NOT chart-bearing. */
function isChartBearing(unit: RenderUnit): boolean {
  if (unit.kind !== 'section') return false;
  const s = unit.section;
  if (s.type === 'chart') return true;
  if (s.type === 'query_artifact') return !!s.artifact.chart;
  return false;
}

/**
 * Groups consecutive chart-bearing units into a grid run so the renderer can
 * tile them two-up. A run of one stays `single` (full width) — a lone chart
 * shouldn't render as a half-width tile. Non-chart units break the run and
 * render full width in their original order, so interleaved text/charts keep
 * their sequence.
 */
function groupChartRuns(units: RenderUnit[]): LayoutGroup[] {
  const out: LayoutGroup[] = [];
  let run: RenderUnit[] = [];
  const flush = () => {
    if (run.length === 0) return;
    if (run.length === 1) out.push({ kind: 'single', unit: run[0] });
    else out.push({ kind: 'chart_grid', units: run });
    run = [];
  };
  for (const u of units) {
    if (isChartBearing(u)) {
      run.push(u);
    } else {
      flush();
      out.push({ kind: 'single', unit: u });
    }
  }
  flush();
  return out;
}

/** Renders a single RenderUnit (tool run or section) — shared by the full-width
 *  and grid-cell paths so both stay in sync. */
function renderRenderUnit(
  unit: RenderUnit,
  onRefine: ((text: string) => void) | undefined,
  key: React.Key,
): React.ReactElement {
  if (unit.kind === 'tool_run') {
    return unit.calls.length === 1 ? (
      <SectionRenderer key={key} section={unit.calls[0]} onRefine={onRefine} />
    ) : (
      <ToolCallGroup key={key} calls={unit.calls} />
    );
  }
  return <SectionRenderer key={key} section={unit.section} onRefine={onRefine} />;
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

function SectionRenderer({
  section,
  onRefine,
}: {
  section: AssistantSection;
  onRefine?: (text: string) => void;
}) {
  switch (section.type) {
    case 'text':
      return <TextParagraph text={section.text} />;

    // 'reasoning' is handled in the header and 'verdict' is rendered as the lead
    // block (both lifted out of bodyUnits), so neither reaches the body renderer.
    case 'reasoning':
    case 'verdict':
      return null;

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
      return <QueryArtifactCard artifact={section.artifact} onRefine={onRefine} />;

    case 'chart':
      return <AssistantChartSection artifact={section.artifact} />;

    case 'segment_proposal':
      return <SegmentProposalCard proposal={section.proposal} />;

    default:
      return null;
  }
}
