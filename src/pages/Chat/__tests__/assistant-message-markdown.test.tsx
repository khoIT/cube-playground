import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AssistantMessage } from '../components/assistant-message';
import { _resetGlossaryCache } from '../components/use-glossary-linker';

function wrap(node: React.ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

beforeEach(() => {
  _resetGlossaryCache();
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ terms: [] }),
  } as unknown as Response);
  vi.stubGlobal('fetch', fetchMock);
});

describe('AssistantMessage inline markdown rendering', () => {
  it('renders **value** as <strong> instead of raw asterisks', () => {
    const sections = [
      {
        type: 'text' as const,
        text: 'baseline in the **16,500–18,700** range through early May',
      },
    ];
    const { container } = wrap(<AssistantMessage sections={sections} />);
    const strongs = Array.from(container.querySelectorAll('strong')).map(
      (el) => el.textContent,
    );
    expect(strongs).toContain('16,500–18,700');
    expect(container.textContent).not.toContain('**');
  });

  it('renders the full reported blob with two bold runs', () => {
    const blob =
      'DAU for Ballistar over the last 30 days shows a baseline in the ' +
      '**16,500–18,700** range through early-to-mid May, with a sharp spike ' +
      'to **~27,600 on May 16** (roughly +60% above baseline).';
    const { container } = wrap(
      <AssistantMessage sections={[{ type: 'text', text: blob }]} />,
    );
    const strongs = Array.from(container.querySelectorAll('strong')).map(
      (el) => el.textContent,
    );
    expect(strongs).toEqual(['16,500–18,700', '~27,600 on May 16']);
    expect(container.textContent).not.toContain('**');
  });

  it('renders `code` and *italic* alongside bold', () => {
    const { container } = wrap(
      <AssistantMessage
        sections={[
          {
            type: 'text',
            text: 'use `players.dau` measure with **D7 retention** and *trend* analysis',
          },
        ]}
      />,
    );
    expect(container.querySelector('code')?.textContent).toBe('players.dau');
    expect(container.querySelector('strong')?.textContent).toBe('D7 retention');
    expect(container.querySelector('em')?.textContent).toBe('trend');
  });

  it('still wraps {{field:cube.member}} tokens when interleaved with bold', () => {
    const { container } = wrap(
      <AssistantMessage
        sections={[
          {
            type: 'text',
            text: 'spike on **May 16** for {{field:players.dau}}',
          },
        ]}
      />,
    );
    const links = Array.from(container.querySelectorAll('a')).map((a) =>
      a.getAttribute('href'),
    );
    expect(links).toContain('/catalog/data-model?focus=players.dau');
    expect(container.querySelector('strong')?.textContent).toBe('May 16');
  });
});
