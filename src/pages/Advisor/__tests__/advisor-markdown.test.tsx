/**
 * AdvisorMarkdown turns the agent's spoken markdown into real elements — the
 * regression guard is that `### heading`, GFM tables, and `**bold**` render as
 * DOM nodes, not literal `#`/`|`/`*` characters in the text.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AdvisorMarkdown } from '../advisor-markdown';

describe('AdvisorMarkdown', () => {
  it('renders a heading as a heading element, not raw "###"', () => {
    render(<AdvisorMarkdown>{'### The target\nbody'}</AdvisorMarkdown>);
    const heading = screen.getByText('The target');
    expect(heading.tagName).toMatch(/^H\d$/);
    expect(heading.textContent).not.toContain('#');
  });

  it('renders a GFM table as a <table> with header cells', () => {
    const md = ['| Field | Value |', '|---|---|', '| **Cohort** | Payers |'].join('\n');
    const { container } = render(<AdvisorMarkdown>{md}</AdvisorMarkdown>);
    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelector('th')?.textContent).toBe('Field');
    // The pipe characters must not survive as literal text.
    expect(container.textContent).not.toContain('|');
  });

  it('renders **bold** as <strong>, not literal asterisks', () => {
    const { container } = render(<AdvisorMarkdown>{'Recent payers **pulling back**'}</AdvisorMarkdown>);
    expect(container.querySelector('strong')?.textContent).toBe('pulling back');
    expect(container.textContent).not.toContain('*');
  });
});
