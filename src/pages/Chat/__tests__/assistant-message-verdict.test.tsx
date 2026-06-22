import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AssistantMessage, type AssistantSection } from '../components/assistant-message';

function wrap(node: React.ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

describe('AssistantMessage verdict lead block', () => {
  it('renders the verdict headline + rationale as a lead block', () => {
    const sections: AssistantSection[] = [
      { type: 'verdict', headline: 'Payer conversion is the bottleneck.', rationale: 'Payer rate is 1.8%.' },
      { type: 'text', text: 'Supporting detail follows.' },
    ];
    const { container } = wrap(<AssistantMessage sections={sections} />);
    expect(container.textContent).toContain('Verdict');
    expect(container.textContent).toContain('Payer conversion is the bottleneck.');
    expect(container.textContent).toContain('Payer rate is 1.8%.');
    expect(container.textContent).toContain('Supporting detail follows.');
  });

  it('renders headline without a rationale when none is given', () => {
    const sections: AssistantSection[] = [
      { type: 'verdict', headline: 'DAU is flat week-over-week.' },
    ];
    const { container } = wrap(<AssistantMessage sections={sections} />);
    expect(container.textContent).toContain('DAU is flat week-over-week.');
  });

  it('shows no verdict block when no verdict section is present', () => {
    const { container } = wrap(
      <AssistantMessage sections={[{ type: 'text', text: 'Just a plain answer.' }]} />,
    );
    expect(container.textContent).not.toContain('Verdict');
    expect(container.textContent).toContain('Just a plain answer.');
  });

  it('keeps the last verdict when more than one is emitted', () => {
    const sections: AssistantSection[] = [
      { type: 'verdict', headline: 'First take.' },
      { type: 'verdict', headline: 'Refined take.' },
    ];
    const { container } = wrap(<AssistantMessage sections={sections} />);
    expect(container.textContent).toContain('Refined take.');
    expect(container.textContent).not.toContain('First take.');
  });
});
