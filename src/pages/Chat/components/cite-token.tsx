/**
 * CiteToken — renders an inline footnote superscript for {{cite:url|title}} tokens
 * emitted by the assistant when web search is enabled (phase-06).
 *
 * Security: href is sanitised to http/https only; link opens in a new tab with
 * rel="noopener noreferrer" so the cited page cannot navigate the current window.
 *
 * Design tokens: uses var(--brand), var(--brand-soft), var(--font-sans) — no raw hex.
 */
import React from 'react';
import { T } from '../../../shell/theme';

interface Props {
  url: string;
  title: string;
}

/** Allow only http/https URLs — rejects javascript:, data:, etc. */
function sanitiseHref(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.href;
    }
    return null;
  } catch {
    return null;
  }
}

export function CiteToken({ url, title }: Props) {
  const safeHref = sanitiseHref(url);
  if (!safeHref) {
    // Malformed URL — render as plain text so nothing navigates.
    return (
      <sup style={SUP_STYLE} title={title}>
        [?]
      </sup>
    );
  }
  return (
    <a
      href={safeHref}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      style={LINK_STYLE}
    >
      <sup style={SUP_STYLE}>[src]</sup>
    </a>
  );
}

const SUP_STYLE: React.CSSProperties = {
  fontFamily: T.fSans,
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.02em',
  color: T.brand,
  verticalAlign: 'super',
  lineHeight: 1,
  cursor: 'pointer',
};

const LINK_STYLE: React.CSSProperties = {
  textDecoration: 'none',
  color: 'inherit',
};

// ---------------------------------------------------------------------------
// Token parsing utilities (shared with the assistant-message renderer)
// ---------------------------------------------------------------------------

/**
 * Regex matching {{cite:url|title}} tokens.
 * - url: any non-whitespace, non-| characters
 * - title: any characters up to }}
 *
 * Format is intentionally absent from markdown/HTML corpora to avoid collision.
 */
export const CITE_TOKEN_REGEX = /\{\{cite:([^\s|{}]+)\|([^{}]+)\}\}/g;

export interface CiteSegment {
  kind: 'cite';
  url: string;
  title: string;
}

export interface TextSegment {
  kind: 'text';
  text: string;
}

export type CiteParseResult = CiteSegment | TextSegment;

/**
 * Split a raw string into alternating text and cite segments.
 * Used by the assistant-message renderer to splice CiteToken nodes
 * into the existing field-chip + glossary pipeline.
 */
export function parseCiteTokens(text: string): CiteParseResult[] {
  const results: CiteParseResult[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  CITE_TOKEN_REGEX.lastIndex = 0;
  while ((match = CITE_TOKEN_REGEX.exec(text)) !== null) {
    if (match.index > last) {
      results.push({ kind: 'text', text: text.slice(last, match.index) });
    }
    results.push({ kind: 'cite', url: match[1], title: match[2].trim() });
    last = CITE_TOKEN_REGEX.lastIndex;
  }
  if (last < text.length) {
    results.push({ kind: 'text', text: text.slice(last) });
  }
  return results;
}
