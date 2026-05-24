import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AssistantMessage } from '../components/assistant-message';

function wrap(node: React.ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

describe('AssistantMessage field-chip rendering', () => {
  it('wraps {{field:cube.member}} tokens in clickable chips', () => {
    const sections = [
      {
        type: 'text' as const,
        text: 'DAU is computed from {{field:players.dau}} and {{field:players.mau}}.',
      },
    ];
    const { container } = wrap(<AssistantMessage sections={sections} />);
    const links = Array.from(container.querySelectorAll('a'));
    const hrefs = links.map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(
      expect.arrayContaining([
        '/catalog/schema?focus=players.dau',
        '/catalog/schema?focus=players.mau',
      ]),
    );
    expect(container.textContent).toContain('DAU is computed from');
  });

  it('leaves plain text untouched when no tokens are present', () => {
    const { container } = wrap(
      <AssistantMessage sections={[{ type: 'text', text: 'No field chips here.' }]} />,
    );
    expect(container.querySelectorAll('a').length).toBe(0);
    expect(container.textContent).toContain('No field chips here.');
  });

  it('does NOT match malformed tokens', () => {
    const { container } = wrap(
      <AssistantMessage
        sections={[{ type: 'text', text: 'broken {{field:nope}} and {{field:cube..}} stay text' }]}
      />,
    );
    expect(container.querySelectorAll('a').length).toBe(0);
  });
});
