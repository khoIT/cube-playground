/**
 * Phase-06 cite-token rendering tests.
 *
 * Covers:
 *   - parseCiteTokens: splitting raw strings into text/cite segments
 *   - CiteToken component: renders safe http/https links, rejects bad protocols
 *   - AssistantMessage: end-to-end rendering of {{cite:url|title}} tokens inside
 *     the existing markdown pipeline (field-chip + glossary pipeline preserved)
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { parseCiteTokens } from '../components/cite-token';
import { CiteToken } from '../components/cite-token';
import { AssistantMessage } from '../components/assistant-message';

function wrap(node: React.ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

// ---------------------------------------------------------------------------
// parseCiteTokens
// ---------------------------------------------------------------------------

describe('parseCiteTokens — token splitting', () => {
  it('returns a single text segment when no cite tokens are present', () => {
    const result = parseCiteTokens('No citations here.');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ kind: 'text', text: 'No citations here.' });
  });

  it('parses a single cite token', () => {
    const result = parseCiteTokens('See {{cite:https://example.com|Example Site}} for more.');
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ kind: 'text', text: 'See ' });
    expect(result[1]).toEqual({ kind: 'cite', url: 'https://example.com', title: 'Example Site' });
    expect(result[2]).toEqual({ kind: 'text', text: ' for more.' });
  });

  it('parses multiple cite tokens in one string', () => {
    const result = parseCiteTokens(
      '{{cite:https://a.com|Alpha}}{{cite:https://b.com|Beta}}',
    );
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ kind: 'cite', url: 'https://a.com', title: 'Alpha' });
    expect(result[1]).toEqual({ kind: 'cite', url: 'https://b.com', title: 'Beta' });
  });

  it('trims whitespace from title', () => {
    const result = parseCiteTokens('{{cite:https://x.com|  My Title  }}');
    const cite = result.find((s) => s.kind === 'cite');
    expect(cite?.kind === 'cite' && cite.title).toBe('My Title');
  });

  it('returns empty array for empty string', () => {
    expect(parseCiteTokens('')).toHaveLength(0);
  });

  it('does not match malformed tokens missing the pipe separator', () => {
    const result = parseCiteTokens('{{cite:https://example.com}}');
    // No pipe → regex does not match → whole string is text
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('text');
  });

  it('handles http (non-https) URLs', () => {
    const result = parseCiteTokens('{{cite:http://insecure.com|Insecure}}');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ kind: 'cite', url: 'http://insecure.com', title: 'Insecure' });
  });
});

// ---------------------------------------------------------------------------
// CiteToken component
// ---------------------------------------------------------------------------

describe('CiteToken — rendering', () => {
  it('renders an anchor with target=_blank and rel=noopener noreferrer', () => {
    const { container } = wrap(<CiteToken url="https://example.com" title="Example" />);
    const a = container.querySelector('a');
    expect(a).not.toBeNull();
    expect(a!.getAttribute('href')).toBe('https://example.com/');
    expect(a!.getAttribute('target')).toBe('_blank');
    expect(a!.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a!.getAttribute('title')).toBe('Example');
  });

  it('renders superscript [src] label inside the link', () => {
    const { container } = wrap(<CiteToken url="https://example.com" title="Example" />);
    const sup = container.querySelector('sup');
    expect(sup).not.toBeNull();
    expect(sup!.textContent).toContain('[src]');
  });

  it('renders [?] fallback for javascript: URL (unsafe protocol rejected)', () => {
    const { container } = wrap(
      // eslint-disable-next-line no-script-url
      <CiteToken url="javascript:alert(1)" title="XSS" />,
    );
    const a = container.querySelector('a');
    expect(a).toBeNull(); // no link rendered
    const sup = container.querySelector('sup');
    expect(sup!.textContent).toContain('[?]');
  });

  it('renders [?] fallback for data: URL', () => {
    const { container } = wrap(
      <CiteToken url="data:text/html,<h1>XSS</h1>" title="Bad" />,
    );
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('sup')!.textContent).toContain('[?]');
  });

  it('renders [?] fallback for a completely invalid URL', () => {
    const { container } = wrap(<CiteToken url="not a url at all" title="Bad" />);
    expect(container.querySelector('a')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AssistantMessage end-to-end: cite tokens in text sections
// ---------------------------------------------------------------------------

describe('AssistantMessage — cite token rendering', () => {
  it('renders a cite token as a superscript link', () => {
    const sections = [
      {
        type: 'text' as const,
        text: 'DAU dropped last week {{cite:https://docs.example.com/dau|DAU Definition}}.',
      },
    ];
    const { container } = wrap(<AssistantMessage sections={sections} />);
    const links = Array.from(container.querySelectorAll('a'));
    const citeLink = links.find((a) => a.getAttribute('href')?.includes('docs.example.com'));
    expect(citeLink).not.toBeUndefined();
    expect(citeLink!.getAttribute('target')).toBe('_blank');
    expect(citeLink!.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('leaves plain text around the cite token intact', () => {
    const sections = [
      {
        type: 'text' as const,
        text: 'Revenue fell {{cite:https://example.com|Source}} by 10%.',
      },
    ];
    const { container } = wrap(<AssistantMessage sections={sections} />);
    expect(container.textContent).toContain('Revenue fell');
    expect(container.textContent).toContain('by 10%.');
  });

  it('renders field chips and cite tokens in the same text without conflict', () => {
    const sections = [
      {
        type: 'text' as const,
        text: 'See {{field:players.dau}} for details {{cite:https://wiki.example.com|Wiki}}.',
      },
    ];
    const { container } = wrap(<AssistantMessage sections={sections} />);
    // Field chip link
    const links = Array.from(container.querySelectorAll('a'));
    const chipLink = links.find((a) =>
      a.getAttribute('href')?.includes('/catalog/data-model'),
    );
    expect(chipLink).not.toBeUndefined();
    // Cite link
    const citeLink = links.find((a) => a.getAttribute('href')?.includes('wiki.example.com'));
    expect(citeLink).not.toBeUndefined();
  });

  it('renders multiple cite tokens in one paragraph', () => {
    const sections = [
      {
        type: 'text' as const,
        text: 'Source A {{cite:https://a.com/page|A}} and source B {{cite:https://b.com/page|B}}.',
      },
    ];
    const { container } = wrap(<AssistantMessage sections={sections} />);
    const links = Array.from(container.querySelectorAll('a'));
    const citeLinks = links.filter((a) => {
      const href = a.getAttribute('href') ?? '';
      return href.startsWith('https://a.com') || href.startsWith('https://b.com');
    });
    expect(citeLinks.length).toBeGreaterThanOrEqual(2);
  });

  it('leaves text unchanged when no cite tokens are present', () => {
    const sections = [{ type: 'text' as const, text: 'No sources needed here.' }];
    const { container } = wrap(<AssistantMessage sections={sections} />);
    const sups = container.querySelectorAll('sup');
    expect(sups).toHaveLength(0);
    expect(container.textContent).toContain('No sources needed here.');
  });
});
