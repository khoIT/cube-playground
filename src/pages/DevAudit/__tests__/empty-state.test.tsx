/**
 * Tests for EmptyState component:
 * - renders title
 * - renders description when provided
 * - renders icon when provided
 * - renders href CTA as <a>
 * - renders onClick CTA as <button>
 * - omits CTA when not provided
 * - uses custom testId
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmptyState } from '../empty-state';

describe('EmptyState', () => {
  it('renders the title', () => {
    render(<EmptyState title="No sessions yet." />);
    expect(screen.getByText('No sessions yet.')).toBeTruthy();
  });

  it('renders description when provided', () => {
    render(<EmptyState title="Empty" description="Start a chat." />);
    expect(screen.getByText('Start a chat.')).toBeTruthy();
  });

  it('omits description element when not provided', () => {
    const { container } = render(<EmptyState title="Empty" />);
    const ps = container.querySelectorAll('p');
    // Only the title paragraph, no description paragraph
    expect(ps).toHaveLength(1);
  });

  it('renders icon when provided', () => {
    render(<EmptyState title="Empty" icon={<span data-testid="my-icon">X</span>} />);
    expect(screen.getByTestId('my-icon')).toBeTruthy();
  });

  it('renders href CTA as an anchor tag', () => {
    render(<EmptyState title="Empty" cta={{ label: 'Go here', href: '#/somewhere' }} />);
    const link = screen.getByRole('link', { name: 'Go here' });
    expect(link.getAttribute('href')).toBe('#/somewhere');
  });

  it('renders onClick CTA as a button', () => {
    const handler = vi.fn();
    render(<EmptyState title="Empty" cta={{ label: 'Click me', onClick: handler }} />);
    const btn = screen.getByRole('button', { name: 'Click me' });
    fireEvent.click(btn);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('renders no CTA element when cta is not provided', () => {
    render(<EmptyState title="Empty" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('uses custom testId', () => {
    render(<EmptyState title="Empty" testId="my-custom-empty" />);
    expect(screen.getByTestId('my-custom-empty')).toBeTruthy();
  });

  it('defaults testId to empty-state', () => {
    render(<EmptyState title="Default" />);
    expect(screen.getByTestId('empty-state')).toBeTruthy();
  });
});
