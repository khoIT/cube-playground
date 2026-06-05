/**
 * Tool-call grouping — a run of 2+ tool calls must collapse into a single
 * ToolCallGroup disclosure (so long agent turns don't push the answer
 * off-screen while streaming), expandable afterwards to review each call.
 * A lone tool call keeps its plain chip.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AssistantMessage, type AssistantSection } from '../components/assistant-message';
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

function toolCall(
  id: string,
  name: string,
  status: 'pending' | 'ok' | 'error' = 'ok',
): AssistantSection {
  return { type: 'tool_call', id, name, status, ms: 120, summary: `${name} summary` };
}

describe('AssistantMessage tool-call grouping', () => {
  it('collapses a run of tool calls into one disclosure, expandable to chips', () => {
    const sections: AssistantSection[] = [
      toolCall('t1', 'resolve_query_terms'),
      toolCall('t2', 'preview_cube_query'),
      toolCall('t3', 'get_cube_meta', 'error'),
      { type: 'text', text: 'Here is the answer.' },
    ];
    const { container, getByText } = wrap(<AssistantMessage sections={sections} />);

    // Collapsed by default: header with count, no individual chip names.
    expect(container.textContent).toContain('Tool calls (3)');
    expect(container.textContent).toContain('1 failed');
    expect(container.textContent).not.toContain('resolve_query_terms');
    // Answer text is still rendered alongside the collapsed group.
    expect(container.textContent).toContain('Here is the answer.');

    // Expanding reveals every chip for review.
    fireEvent.click(getByText('Tool calls (3)'));
    expect(container.textContent).toContain('resolve_query_terms');
    expect(container.textContent).toContain('preview_cube_query');
    expect(container.textContent).toContain('get_cube_meta');
  });

  it('shows the running tool name in the collapsed header while pending', () => {
    const sections: AssistantSection[] = [
      toolCall('t1', 'resolve_query_terms'),
      { type: 'tool_call', id: 't2', name: 'preview_cube_query', status: 'pending' },
    ];
    const { container } = wrap(<AssistantMessage sections={sections} />);
    expect(container.textContent).toContain('Tool calls (2)');
    // Live activity stays visible without expanding.
    expect(container.textContent).toContain('preview_cube_query');
    // Settled siblings stay hidden until expanded.
    expect(container.textContent).not.toContain('resolve_query_terms');
  });

  it('renders a lone tool call as a plain chip, not a group', () => {
    const sections: AssistantSection[] = [toolCall('t1', 'disambiguate_query')];
    const { container } = wrap(<AssistantMessage sections={sections} />);
    expect(container.textContent).toContain('disambiguate_query');
    expect(container.textContent).not.toContain('Tool calls (');
  });
});
