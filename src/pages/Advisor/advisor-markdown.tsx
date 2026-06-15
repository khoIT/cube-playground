/**
 * AdvisorMarkdown — a lean, token-styled GFM renderer for the advisor's spoken
 * output (Drive narration, run replay). The agent answers in markdown — headers,
 * tables, bold, lists — so rendering it raw (pre-wrap) shows literal `###` and
 * `| … |` pipes. This turns that into readable prose with the design tokens.
 *
 * Deliberately NOT reusing Chat's AssistantMessage: that one is coupled to the
 * chat citation-token pipeline. The advisor narration has no citation tokens, so
 * a plain ReactMarkdown + remark-gfm with token styling is the right size.
 */

import React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const REMARK_PLUGINS = [remarkGfm];

const COMPONENTS: Components = {
  h1: ({ children }) => <h3 style={H_STYLE}>{children}</h3>,
  h2: ({ children }) => <h3 style={H_STYLE}>{children}</h3>,
  h3: ({ children }) => <h4 style={{ ...H_STYLE, fontSize: 13.5 }}>{children}</h4>,
  h4: ({ children }) => <h4 style={{ ...H_STYLE, fontSize: 13 }}>{children}</h4>,
  p: ({ children }) => <p style={{ margin: '0 0 10px', lineHeight: 1.55 }}>{children}</p>,
  ul: ({ children }) => <ul style={{ margin: '0 0 10px', paddingLeft: 20, lineHeight: 1.55 }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: '0 0 10px', paddingLeft: 20, lineHeight: 1.55 }}>{children}</ol>,
  li: ({ children }) => <li style={{ marginBottom: 3 }}>{children}</li>,
  strong: ({ children }) => <strong style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{children}</strong>,
  em: ({ children }) => <em style={{ fontStyle: 'italic' }}>{children}</em>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" style={{ color: 'var(--brand)', fontWeight: 600 }}>
      {children}
    </a>
  ),
  hr: () => <hr style={{ border: 'none', borderTop: '1px solid var(--border-card)', margin: '12px 0' }} />,
  blockquote: ({ children }) => (
    <blockquote
      style={{
        margin: '0 0 10px',
        padding: '4px 12px',
        borderLeft: '3px solid var(--border-strong)',
        color: 'var(--text-secondary)',
      }}
    >
      {children}
    </blockquote>
  ),
  code: ({ children }) => (
    <code
      style={{
        fontFamily: 'var(--font-mono, ui-monospace, monospace)',
        fontSize: '0.92em',
        background: 'var(--bg-muted)',
        borderRadius: 'var(--radius-sm, 4px)',
        padding: '1px 5px',
      }}
    >
      {children}
    </code>
  ),
  table: ({ children }) => (
    <div style={{ overflowX: 'auto', margin: '0 0 12px' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5 }}>{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th
      style={{
        textAlign: 'left',
        padding: '6px 10px',
        borderBottom: '1px solid var(--border-strong)',
        background: 'var(--bg-muted)',
        fontWeight: 700,
        color: 'var(--text-primary)',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border-card)', verticalAlign: 'top' }}>
      {children}
    </td>
  ),
};

const H_STYLE: React.CSSProperties = {
  fontSize: 14.5,
  fontWeight: 700,
  margin: '14px 0 6px',
  color: 'var(--text-primary)',
  lineHeight: 1.3,
};

/**
 * Render advisor markdown. Memoized on the source string so re-renders driven by
 * sibling state (cost ticks, activity rows) don't re-parse the markdown tree.
 */
export const AdvisorMarkdown = React.memo(function AdvisorMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS}>
      {children}
    </ReactMarkdown>
  );
});
