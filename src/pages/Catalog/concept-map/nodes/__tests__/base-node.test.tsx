/**
 * BaseNode tests — per-kind trust footer (read-only for fields, trust badge for
 * metric/term/segment) and focus/dim flags surfaced as aria/data attributes.
 *
 * Wrapped in ReactFlowProvider because the node's edge <Handle>s read the
 * reactflow store. We render the node directly (not a full canvas), so no node
 * measurement / geometry is asserted — that lives in build-layout tests.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ReactFlowProvider } from 'reactflow';

import { BaseNode } from '../base-node';
import type { ConceptNode } from '../../concept-node';

function renderNode(
  node: ConceptNode,
  opts?: { focused?: boolean; dimmed?: boolean; onActivate?: () => void },
) {
  const data = {
    node,
    focused: opts?.focused ?? false,
    dimmed: opts?.dimmed ?? false,
    onActivate: opts?.onActivate,
  };
  // BaseNode only consumes `data`; relax the NodeProps signature for the test.
  const Node = BaseNode as unknown as (p: { data: typeof data }) => JSX.Element;
  return render(
    <MemoryRouter>
      <ReactFlowProvider>
        <Node data={data} />
      </ReactFlowProvider>
    </MemoryRouter>,
  );
}

describe('BaseNode', () => {
  it('renders a field node with mono sublabel and a read-only tag (no trust badge)', () => {
    renderNode({ kind: 'field', ref: 'data_model/mf_users.dau', label: 'DAU', sublabel: 'mf_users.dau' });
    expect(screen.getByText('DAU')).toBeTruthy();
    expect(screen.getByText('mf_users.dau')).toBeTruthy();
    expect(screen.getByText('read-only')).toBeTruthy();
    expect(screen.queryByText(/certified/i)).toBeNull();
  });

  it('renders a metric node with its trust badge', () => {
    renderNode({ kind: 'metric', ref: 'business_metrics/dau', label: 'DAU', trust: 'certified' });
    expect(screen.getByText(/certified/i)).toBeTruthy();
    expect(screen.queryByText('read-only')).toBeNull();
  });

  it('renders a term node with a draft badge', () => {
    renderNode({ kind: 'term', ref: 'glossary/active-user', label: 'Active User', trust: 'draft' });
    expect(screen.getByText('draft')).toBeTruthy();
  });

  it('renders an app-segment node as certified', () => {
    renderNode({ kind: 'appSegment', ref: 'segments/whales', label: 'Whales', trust: 'certified' });
    expect(screen.getByText(/certified/i)).toBeTruthy();
  });

  it('exposes focus + dim state via attributes', () => {
    renderNode(
      { kind: 'metric', ref: 'business_metrics/dau', label: 'DAU', trust: 'certified' },
      { focused: true },
    );
    const card = screen.getByRole('button', { name: 'metric DAU' });
    expect(card.getAttribute('aria-pressed')).toBe('true');
    expect(card.getAttribute('data-focused')).toBe('true');
  });

  it('activates on Enter/Space for keyboard parity', () => {
    const onActivate = vi.fn();
    renderNode({ kind: 'metric', ref: 'business_metrics/dau', label: 'DAU', trust: 'certified' }, { onActivate });
    const card = screen.getByRole('button', { name: 'metric DAU' });
    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: ' ' });
    expect(onActivate).toHaveBeenCalledTimes(2);
  });
});
